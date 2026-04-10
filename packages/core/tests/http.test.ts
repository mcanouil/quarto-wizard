import { beforeEach, describe, expect, it, vi } from "vitest";
import { CancellationError, NetworkError, SamlSsoError } from "../src/errors.js";
import { fetchJson } from "../src/registry/http.js";
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
		mockedProxyFetch
			.mockRejectedValueOnce(new NetworkError("temporary failure"))
			.mockResolvedValueOnce(
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
		vi.mocked(proxyFetch).mockResolvedValueOnce(
			new Response("Forbidden", { status: 403 }),
		);

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
