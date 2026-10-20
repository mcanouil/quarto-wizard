import { beforeEach, describe, expect, it, vi } from "vitest";
import { CancellationError, NetworkError, RateLimitError, SamlSsoError } from "../src/errors.js";
import { fetchJson, fetchJsonPages } from "../src/registry/http.js";
import { proxyFetch } from "../src/proxy/index.js";

vi.mock("../src/proxy/index.js", () => ({
	proxyFetch: vi.fn(),
}));

describe("registry http retry behavior", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("retries a transient network error and succeeds", async () => {
		const mockedProxyFetch = vi.mocked(proxyFetch);
		mockedProxyFetch.mockRejectedValueOnce(new NetworkError("temporary failure")).mockResolvedValueOnce(
			new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);

		const result = await fetchJson<{ ok: boolean }>("https://example.com/registry.json", {
			retries: 1,
			retryDelay: 1,
		});

		expect(result).toEqual({ ok: true });
		expect(mockedProxyFetch).toHaveBeenCalledTimes(2);
	});

	it("throws SamlSsoError when response has X-GitHub-SSO header with url", async () => {
		const samlUrl = "https://github.com/orgs/myorg/sso?authorization_request=abc";
		vi.mocked(proxyFetch).mockResolvedValueOnce(
			new Response("Forbidden", {
				status: 403,
				headers: { "x-github-sso": `required; url=${samlUrl}` },
			}),
		);

		await expect(fetchJson("https://example.com/api", { retries: 0 })).rejects.toBeInstanceOf(SamlSsoError);
	});

	it("includes the correct authorizationUrl from the X-GitHub-SSO header", async () => {
		const samlUrl = "https://github.com/orgs/myorg/sso?authorization_request=abc";
		vi.mocked(proxyFetch).mockResolvedValueOnce(
			new Response("Forbidden", {
				status: 403,
				headers: { "x-github-sso": `required; url=${samlUrl}` },
			}),
		);

		const error = await fetchJson("https://example.com/api", { retries: 0 }).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(SamlSsoError);
		expect((error as SamlSsoError).authorizationUrl).toBe(samlUrl);
	});

	it("throws plain NetworkError for 403 without X-GitHub-SSO header", async () => {
		vi.mocked(proxyFetch).mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));

		const error = await fetchJson("https://example.com/api", { retries: 0 }).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(NetworkError);
		expect(error).not.toBeInstanceOf(SamlSsoError);
		expect((error as NetworkError).statusCode).toBe(403);
	});

	it("throws plain NetworkError for 403 with X-GitHub-SSO header missing url", async () => {
		vi.mocked(proxyFetch).mockResolvedValueOnce(
			new Response("Forbidden", {
				status: 403,
				headers: { "x-github-sso": "required" },
			}),
		);

		const error = await fetchJson("https://example.com/api", { retries: 0 }).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(NetworkError);
		expect(error).not.toBeInstanceOf(SamlSsoError);
	});

	// Forged SAML header on a 500 must not downgrade the response to
	// non-retryable. SamlSsoError hardcodes statusCode=403, so the SAML check
	// must be scoped to 403 responses only; otherwise a 5xx could be turned
	// into a permanent failure.
	it("does not treat 500 with X-GitHub-SSO header as SAML", async () => {
		const samlUrl = "https://github.com/orgs/myorg/sso?authorization_request=abc";
		vi.mocked(proxyFetch).mockResolvedValueOnce(
			new Response("Server Error", {
				status: 500,
				headers: { "x-github-sso": `required; url=${samlUrl}` },
			}),
		);

		const error = await fetchJson("https://example.com/api", { retries: 0 }).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(NetworkError);
		expect(error).not.toBeInstanceOf(SamlSsoError);
		expect((error as NetworkError).statusCode).toBe(500);
	});

	// Defence-in-depth: an attacker-controlled response must not be able to
	// point the extension at javascript:, file:, or non-github.com URLs.
	it("throws plain NetworkError when SAML header url= is a javascript: URL", async () => {
		vi.mocked(proxyFetch).mockResolvedValueOnce(
			new Response("Forbidden", {
				status: 403,
				headers: { "x-github-sso": "required; url=javascript:alert(1)" },
			}),
		);

		const error = await fetchJson("https://example.com/api", { retries: 0 }).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(NetworkError);
		expect(error).not.toBeInstanceOf(SamlSsoError);
	});

	it("throws plain NetworkError when SAML header url= points at a non-github.com host", async () => {
		vi.mocked(proxyFetch).mockResolvedValueOnce(
			new Response("Forbidden", {
				status: 403,
				headers: { "x-github-sso": "required; url=https://evil.example/sso" },
			}),
		);

		const error = await fetchJson("https://example.com/api", { retries: 0 }).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(NetworkError);
		expect(error).not.toBeInstanceOf(SamlSsoError);
	});

	// SamlSsoError is a 403 and 403 is not retryable, so a single request is
	// made even when retries > 0. This locks in the behaviour so a future
	// change to isRetryableError cannot silently start amplifying SAML 403s.
	it("does not retry SamlSsoError responses", async () => {
		const samlUrl = "https://github.com/orgs/myorg/sso?authorization_request=abc";
		const mockedProxyFetch = vi.mocked(proxyFetch);
		mockedProxyFetch.mockResolvedValue(
			new Response("Forbidden", {
				status: 403,
				headers: { "x-github-sso": `required; url=${samlUrl}` },
			}),
		);

		await expect(fetchJson("https://example.com/api", { retries: 3, retryDelay: 1 })).rejects.toBeInstanceOf(
			SamlSsoError,
		);
		expect(mockedProxyFetch).toHaveBeenCalledTimes(1);
	});

	it("throws RateLimitError for a 403 with no requests left", async () => {
		vi.mocked(proxyFetch).mockResolvedValueOnce(
			new Response("Forbidden", { status: 403, headers: { "x-ratelimit-remaining": "0" } }),
		);

		const error = await fetchJson("https://example.com/api", { retries: 0 }).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(RateLimitError);
		expect((error as RateLimitError).statusCode).toBe(403);
	});

	it("throws RateLimitError for a 403 that asks to retry later", async () => {
		vi.mocked(proxyFetch).mockResolvedValueOnce(
			new Response("Forbidden", { status: 403, headers: { "retry-after": "60", "x-ratelimit-remaining": "42" } }),
		);

		const error = await fetchJson("https://example.com/api", { retries: 0 }).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(RateLimitError);
	});

	it("throws RateLimitError for a 403 whose message names a secondary rate limit", async () => {
		vi.mocked(proxyFetch).mockResolvedValueOnce(
			new Response(JSON.stringify({ message: "You have exceeded a secondary rate limit." }), {
				status: 403,
				headers: { "x-ratelimit-remaining": "4999" },
			}),
		);

		const error = await fetchJson("https://example.com/api", { retries: 0 }).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(RateLimitError);
	});

	it("throws RateLimitError for every 429", async () => {
		vi.mocked(proxyFetch).mockResolvedValueOnce(new Response("Too Many Requests", { status: 429 }));

		const error = await fetchJson("https://example.com/api", { retries: 0 }).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(RateLimitError);
		expect((error as RateLimitError).statusCode).toBe(429);
	});

	it("keeps a denied 403 apart from a rate limit", async () => {
		vi.mocked(proxyFetch).mockResolvedValueOnce(
			new Response(JSON.stringify({ message: "Resource not accessible by personal access token" }), {
				status: 403,
				headers: { "x-ratelimit-remaining": "4999" },
			}),
		);

		const error = await fetchJson("https://example.com/api", { retries: 0 }).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(NetworkError);
		expect(error).not.toBeInstanceOf(RateLimitError);
		expect((error as NetworkError).statusCode).toBe(403);
	});

	it("does not treat a 500 with rate limit headers as a rate limit", async () => {
		vi.mocked(proxyFetch).mockResolvedValueOnce(
			new Response("Server Error", { status: 500, headers: { "x-ratelimit-remaining": "0" } }),
		);

		const error = await fetchJson("https://example.com/api", { retries: 0 }).catch((e: unknown) => e);
		expect(error).not.toBeInstanceOf(RateLimitError);
	});

	it("cancels while waiting for retry backoff", async () => {
		const mockedProxyFetch = vi.mocked(proxyFetch);
		mockedProxyFetch.mockRejectedValue(new NetworkError("transient error"));

		const controller = new AbortController();
		const request = fetchJson("https://example.com/registry.json", {
			retries: 3,
			retryDelay: 1000,
			signal: controller.signal,
		});

		await Promise.resolve();
		controller.abort();

		await expect(request).rejects.toBeInstanceOf(CancellationError);
		expect(mockedProxyFetch).toHaveBeenCalledTimes(1);
	});
});

describe("fetchJsonPages", () => {
	const base = "https://api.example.com/items";

	function page(items: number[], next?: string): Response {
		const headers: Record<string, string> = { "content-type": "application/json" };
		if (next) {
			headers.link = `<${next}>; rel="next", <${base}?page=9>; rel="last"`;
		}
		return new Response(JSON.stringify(items), { status: 200, headers });
	}

	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("follows the next link and joins every page", async () => {
		vi.mocked(proxyFetch)
			.mockResolvedValueOnce(page([1, 2], `${base}?page=2`))
			.mockResolvedValueOnce(page([3, 4], `${base}?page=3`))
			.mockResolvedValueOnce(page([5]));

		const items = await fetchJsonPages<number>(base, {}, 5);

		expect(items).toEqual([1, 2, 3, 4, 5]);
		expect(vi.mocked(proxyFetch).mock.calls.map((call) => call[0])).toEqual([base, `${base}?page=2`, `${base}?page=3`]);
	});

	it("stops at the page cap and keeps the pages it read", async () => {
		vi.mocked(proxyFetch)
			.mockResolvedValueOnce(page([1], `${base}?page=2`))
			.mockResolvedValueOnce(page([2], `${base}?page=3`))
			.mockResolvedValueOnce(page([3], `${base}?page=4`));

		const items = await fetchJsonPages<number>(base, {}, 2);

		expect(items).toEqual([1, 2]);
		expect(proxyFetch).toHaveBeenCalledTimes(2);
	});

	it("resolves a relative next link against the page it came from", async () => {
		vi.mocked(proxyFetch)
			.mockResolvedValueOnce(page([1], "?page=2"))
			.mockResolvedValueOnce(page([2]));

		const items = await fetchJsonPages<number>(base, {}, 5);

		expect(items).toEqual([1, 2]);
		expect(vi.mocked(proxyFetch).mock.calls[1]?.[0]).toBe(`${base}?page=2`);
	});

	it("does not follow a next link to another origin", async () => {
		vi.mocked(proxyFetch).mockResolvedValueOnce(page([1], "https://elsewhere.example.org/items?page=2"));

		const items = await fetchJsonPages<number>(base, {}, 5);

		expect(items).toEqual([1]);
		expect(proxyFetch).toHaveBeenCalledTimes(1);
	});

	it("stops when the user cancels between pages", async () => {
		const controller = new AbortController();
		vi.mocked(proxyFetch).mockImplementationOnce(async () => {
			controller.abort();
			return page([1], `${base}?page=2`);
		});

		await expect(fetchJsonPages<number>(base, { signal: controller.signal }, 5)).rejects.toBeInstanceOf(
			CancellationError,
		);
		expect(proxyFetch).toHaveBeenCalledTimes(1);
	});
});
