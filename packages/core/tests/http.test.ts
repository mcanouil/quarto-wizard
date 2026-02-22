import { beforeEach, describe, expect, it, vi } from "vitest";
import { CancellationError, NetworkError } from "../src/errors.js";
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
