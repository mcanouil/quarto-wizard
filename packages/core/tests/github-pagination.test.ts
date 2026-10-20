import { beforeEach, describe, expect, it, vi } from "vitest";
import { proxyFetch } from "../src/proxy/index.js";
import { resolveLatestTag } from "../src/github/latest.js";
import { resolveVersion } from "../src/github/resolve.js";

vi.mock("../src/proxy/index.js", () => ({
	proxyFetch: vi.fn(),
}));

const API = "https://api.github.com/repos/owner/repo";

function tag(name: string) {
	return {
		name,
		commit: { sha: `sha-${name}` },
		zipball_url: `${API}/zipball/${name}`,
		tarball_url: `${API}/tarball/${name}`,
	};
}

/**
 * Serve the tags endpoint as numbered pages, with a Link header on every page
 * but the last, and an empty releases endpoint.
 */
function serveTagPages(pages: string[][]): void {
	vi.mocked(proxyFetch).mockImplementation(async (input) => {
		const url = new URL(String(input));
		if (url.pathname.endsWith("/releases")) {
			return Response.json([]);
		}
		const number = Number(url.searchParams.get("page") ?? "1");
		const headers = new Headers();
		if (number < pages.length) {
			headers.set("link", `<${API}/tags?per_page=100&page=${number + 1}>; rel="next"`);
		}
		return Response.json((pages[number - 1] ?? []).map(tag), { headers });
	});
}

function requestedUrls(): string[] {
	return vi.mocked(proxyFetch).mock.calls.map((call) => String(call[0]));
}

describe("GitHub pagination", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("finds the highest version on a later page of tags", async () => {
		serveTagPages([["v9.0.0", "v8.0.0"], ["v10.0.0"]]);

		const latest = await resolveLatestTag("owner", "repo");

		expect(latest?.tagName).toBe("v10.0.0");
	});

	it("finds a pinned tag on a later page", async () => {
		serveTagPages([["v2.0.0"], ["v0.1.0"]]);

		const resolved = await resolveVersion("owner", "repo", { type: "tag", tag: "v0.1.0" });

		expect(resolved.tagName).toBe("v0.1.0");
	});

	it("asks for 100 items a page", async () => {
		serveTagPages([["v1.0.0"]]);

		await resolveLatestTag("owner", "repo");

		expect(requestedUrls()).toEqual(
			expect.arrayContaining([`${API}/releases?per_page=100`, `${API}/tags?per_page=100`]),
		);
	});

	it("reads at most three pages of tags", async () => {
		serveTagPages([["v1.0.0"], ["v2.0.0"], ["v3.0.0"], ["v4.0.0"]]);

		const latest = await resolveLatestTag("owner", "repo");

		expect(latest?.tagName).toBe("v3.0.0");
		expect(requestedUrls().filter((url) => url.includes("/tags"))).toHaveLength(3);
	});
});
