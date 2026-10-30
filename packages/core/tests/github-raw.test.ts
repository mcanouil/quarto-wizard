import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchRawFile } from "../src/github/raw.js";
import { proxyFetch } from "../src/proxy/index.js";

vi.mock("../src/proxy/index.js", () => ({
	proxyFetch: vi.fn(),
}));

function requestHeaders(): Record<string, string> {
	const init = vi.mocked(proxyFetch).mock.calls[0]?.[1];
	return (init?.headers ?? {}) as Record<string, string>;
}

describe("fetchRawFile", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("returns the file body", async () => {
		vi.mocked(proxyFetch).mockResolvedValueOnce(new Response("title: Sub\nversion: 0.4.0\n", { status: 200 }));

		const body = await fetchRawFile("owner", "repo", "v2.0.0", "sub/dir/_extension.yml");

		expect(body).toBe("title: Sub\nversion: 0.4.0\n");
		expect(vi.mocked(proxyFetch).mock.calls[0]?.[0]).toBe(
			"https://raw.githubusercontent.com/owner/repo/v2.0.0/sub/dir/_extension.yml",
		);
		expect(requestHeaders()["Authorization"]).toBeUndefined();
	});

	it("returns null on 404", async () => {
		vi.mocked(proxyFetch).mockResolvedValueOnce(new Response("404: Not Found", { status: 404 }));

		const body = await fetchRawFile("owner", "repo", "v2.0.0", "sub/dir/_extension.yml");

		expect(body).toBeNull();
	});

	it("sends the token when set", async () => {
		vi.mocked(proxyFetch).mockResolvedValueOnce(new Response("version: 1.0.0\n", { status: 200 }));

		await fetchRawFile("owner", "repo", "main", "sub/_extension.yml", {
			auth: { githubToken: "secret", httpHeaders: [] },
		});

		expect(requestHeaders()["Authorization"]).toBe("Bearer secret");
	});
});
