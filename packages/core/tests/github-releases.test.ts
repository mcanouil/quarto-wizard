import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReleases = [
	{
		tag_name: "v2.0.0",
		name: "Version 2.0.0",
		zipball_url: "https://api.github.com/repos/owner/repo/zipball/v2.0.0",
		tarball_url: "https://api.github.com/repos/owner/repo/tarball/v2.0.0",
		html_url: "https://github.com/owner/repo/releases/tag/v2.0.0",
		published_at: "2024-01-01T00:00:00Z",
		prerelease: false,
		draft: false,
	},
	{
		tag_name: "v1.0.0",
		name: "Version 1.0.0",
		zipball_url: "https://api.github.com/repos/owner/repo/zipball/v1.0.0",
		tarball_url: "https://api.github.com/repos/owner/repo/tarball/v1.0.0",
		html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
		published_at: "2023-01-01T00:00:00Z",
		prerelease: false,
		draft: false,
	},
];

const mockTags = [
	{
		name: "v2.0.0",
		commit: { sha: "abc123" },
		zipball_url: "https://api.github.com/repos/owner/repo/zipball/v2.0.0",
		tarball_url: "https://api.github.com/repos/owner/repo/tarball/v2.0.0",
	},
	{
		name: "v1.0.0",
		commit: { sha: "def456" },
		zipball_url: "https://api.github.com/repos/owner/repo/zipball/v1.0.0",
		tarball_url: "https://api.github.com/repos/owner/repo/tarball/v1.0.0",
	},
];

vi.mock("../src/registry/http.js", () => ({
	fetchJson: vi.fn().mockImplementation((url: string) => {
		if (url.includes("/releases")) {
			return Promise.resolve(mockReleases);
		}
		if (url.includes("/tags")) {
			return Promise.resolve(mockTags);
		}
		return Promise.reject(new Error("Unknown URL"));
	}),
}));

import { fetchReleases, fetchTags, getLatestRelease, resolveVersion, constructArchiveUrl } from "../src/github/releases.js";

describe("fetchReleases", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("fetches and parses releases", async () => {
		const releases = await fetchReleases("owner", "repo");

		expect(releases).toHaveLength(2);
		expect(releases[0]?.tagName).toBe("v2.0.0");
		expect(releases[0]?.name).toBe("Version 2.0.0");
		expect(releases[0]?.zipballUrl).toContain("zipball");
	});

	it("filters out drafts", async () => {
		const releases = await fetchReleases("owner", "repo");

		expect(releases.every((r) => !r.draft)).toBe(true);
	});
});

describe("fetchTags", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("fetches and parses tags", async () => {
		const tags = await fetchTags("owner", "repo");

		expect(tags).toHaveLength(2);
		expect(tags[0]?.name).toBe("v2.0.0");
		expect(tags[0]?.sha).toBe("abc123");
	});
});

describe("getLatestRelease", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns the first release", async () => {
		const release = await getLatestRelease("owner", "repo");

		expect(release).not.toBeNull();
		expect(release?.tagName).toBe("v2.0.0");
	});
});

describe("resolveVersion", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("resolves latest version", async () => {
		const result = await resolveVersion("owner", "repo", { type: "latest" });

		expect(result.tagName).toBe("v2.0.0");
		expect(result.zipballUrl).toContain("zipball");
	});

	it("resolves specific tag", async () => {
		const result = await resolveVersion("owner", "repo", {
			type: "tag",
			tag: "v1.0.0",
		});

		expect(result.tagName).toBe("v1.0.0");
	});

	it("resolves branch", async () => {
		const result = await resolveVersion("owner", "repo", {
			type: "branch",
			branch: "main",
		});

		expect(result.tagName).toBe("main");
		expect(result.zipballUrl).toContain("refs/heads/main");
	});

	it("throws for unknown tag", async () => {
		await expect(resolveVersion("owner", "repo", { type: "tag", tag: "v999.0.0" })).rejects.toThrow("not found");
	});

	it("resolves commit version", async () => {
		const result = await resolveVersion("owner", "repo", {
			type: "commit",
			commit: "abc1234567890",
		});

		expect(result.tagName).toBe("abc1234");
		expect(result.zipballUrl).toBe("https://github.com/owner/repo/archive/abc1234567890.zip");
		expect(result.tarballUrl).toBe("https://github.com/owner/repo/archive/abc1234567890.tar.gz");
		expect(result.commitSha).toBe("abc1234");
	});

	it("uses custom default branch when no releases/tags", async () => {
		vi.mocked(await import("../src/registry/http.js")).fetchJson.mockImplementation((url: string) => {
			if (url.includes("/releases")) return Promise.resolve([]);
			if (url.includes("/tags")) return Promise.resolve([]);
			return Promise.reject(new Error("Unknown URL"));
		});

		const result = await resolveVersion(
			"owner",
			"repo",
			{ type: "latest" },
			{ defaultBranch: "develop", latestCommit: "abc1234567890" }
		);

		expect(result.tagName).toBe("abc1234");
		expect(result.zipballUrl).toContain("refs/heads/develop");
		expect(result.commitSha).toBe("abc1234");
	});
});

describe("constructArchiveUrl", () => {
	it("constructs tag URL correctly", () => {
		const url = constructArchiveUrl("owner", "repo", "v1.0.0", "tag");
		expect(url).toBe("https://github.com/owner/repo/archive/refs/tags/v1.0.0.zip");
	});

	it("constructs tag URL with tarball format", () => {
		const url = constructArchiveUrl("owner", "repo", "v1.0.0", "tag", "tarball");
		expect(url).toBe("https://github.com/owner/repo/archive/refs/tags/v1.0.0.tar.gz");
	});

	it("constructs branch URL correctly", () => {
		const url = constructArchiveUrl("owner", "repo", "main", "branch");
		expect(url).toBe("https://github.com/owner/repo/archive/refs/heads/main.zip");
	});

	it("constructs branch URL with tarball format", () => {
		const url = constructArchiveUrl("owner", "repo", "develop", "branch", "tarball");
		expect(url).toBe("https://github.com/owner/repo/archive/refs/heads/develop.tar.gz");
	});

	it("constructs commit URL correctly", () => {
		const url = constructArchiveUrl("owner", "repo", "abc1234", "commit");
		expect(url).toBe("https://github.com/owner/repo/archive/abc1234.zip");
	});

	it("constructs commit URL with tarball format", () => {
		const url = constructArchiveUrl("owner", "repo", "abc1234567890", "commit", "tarball");
		expect(url).toBe("https://github.com/owner/repo/archive/abc1234567890.tar.gz");
	});
});
