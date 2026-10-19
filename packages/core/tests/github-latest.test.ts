import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/github/releases.js", async () => {
	const actual = await vi.importActual<typeof import("../src/github/releases.js")>("../src/github/releases.js");
	return {
		...actual,
		fetchReleases: vi.fn().mockResolvedValue([]),
		fetchTags: vi.fn().mockResolvedValue([]),
	};
});

import { fetchReleases, fetchTags, type GitHubRelease, type GitHubTag } from "../src/github/releases.js";
import { normaliseVersion, resolveLatestTag } from "../src/github/latest.js";

function release(tagName: string, prerelease = false): GitHubRelease {
	return {
		tagName,
		name: tagName,
		zipballUrl: `https://api.github.com/repos/owner/repo/zipball/${tagName}`,
		tarballUrl: `https://api.github.com/repos/owner/repo/tarball/${tagName}`,
		htmlUrl: `https://github.com/owner/repo/releases/tag/${tagName}`,
		publishedAt: "2026-01-01T00:00:00Z",
		prerelease,
		draft: false,
	};
}

function tag(name: string): GitHubTag {
	return {
		name,
		sha: "abc1234567890",
		zipballUrl: `https://api.github.com/repos/owner/repo/zipball/${name}`,
		tarballUrl: `https://api.github.com/repos/owner/repo/tarball/${name}`,
	};
}

describe("resolveLatestTag", () => {
	beforeEach(() => {
		vi.mocked(fetchReleases).mockReset().mockResolvedValue([]);
		vi.mocked(fetchTags).mockReset().mockResolvedValue([]);
	});

	it("picks the highest version, not the latest release marker", async () => {
		vi.mocked(fetchReleases).mockResolvedValue([release("v1.2.0")]);
		vi.mocked(fetchTags).mockResolvedValue([tag("v1.3.0")]);

		const latest = await resolveLatestTag("owner", "repo", {});

		expect(latest?.tagName).toBe("v1.3.0");
		expect(latest?.version).toBe("1.3.0");
		expect(latest?.releaseUrl).toBeNull();
		expect(latest?.zipballUrl).toBe("https://api.github.com/repos/owner/repo/zipball/v1.3.0");
	});

	it("ignores prereleases for a stable install", async () => {
		vi.mocked(fetchTags).mockResolvedValue([tag("v2.0.0-beta.1"), tag("v1.4.0")]);

		const latest = await resolveLatestTag("owner", "repo", { currentVersion: "1.3.0" });

		expect(latest?.tagName).toBe("v1.4.0");
	});

	it("follows prereleases when installed version is a prerelease", async () => {
		vi.mocked(fetchTags).mockResolvedValue([tag("v1.9.0"), tag("v2.0.0-beta.2")]);

		const latest = await resolveLatestTag("owner", "repo", { currentVersion: "2.0.0-beta.1" });

		expect(latest?.tagName).toBe("v2.0.0-beta.2");
		expect(latest?.version).toBe("2.0.0-beta.2");
	});

	it("ignores tags that are not semantic versions", async () => {
		vi.mocked(fetchTags).mockResolvedValue([tag("latest"), tag("nightly"), tag("v1.0.0")]);

		const latest = await resolveLatestTag("owner", "repo", {});

		expect(latest?.tagName).toBe("v1.0.0");
	});

	it("returns null when no tag qualifies", async () => {
		vi.mocked(fetchReleases).mockResolvedValue([release("v3.0.0-rc.1", true)]);
		vi.mocked(fetchTags).mockResolvedValue([tag("nightly"), tag("v3.0.0-rc.1")]);

		const latest = await resolveLatestTag("owner", "repo", { currentVersion: "2.0.0" });

		expect(latest).toBeNull();
	});

	it("treats a release flagged as a prerelease on GitHub as a prerelease", async () => {
		vi.mocked(fetchReleases).mockResolvedValue([release("v2.0.0", true), release("v1.5.0")]);
		vi.mocked(fetchTags).mockResolvedValue([tag("v2.0.0"), tag("v1.5.0")]);

		const latest = await resolveLatestTag("owner", "repo", {});

		expect(latest?.tagName).toBe("v1.5.0");
		expect(latest?.releaseUrl).toBe("https://github.com/owner/repo/releases/tag/v1.5.0");
	});

	it("asks GitHub for prerelease releases so it can apply its own rule", async () => {
		await resolveLatestTag("owner", "repo", { currentVersion: "1.0.0" });

		expect(fetchReleases).toHaveBeenCalledTimes(1);
		expect(vi.mocked(fetchReleases).mock.calls[0]?.[2]).toMatchObject({ includePrereleases: true });
	});
});

describe("normaliseVersion", () => {
	it("strips a leading v and keeps prerelease identifiers", () => {
		expect(normaliseVersion("v2.0.0-beta.1")).toBe("2.0.0-beta.1");
		expect(normaliseVersion("1.2")).toBe("1.2.0");
	});

	it("returns null for a name that is not a version", () => {
		expect(normaliseVersion("nightly")).toBeNull();
		expect(normaliseVersion("")).toBeNull();
	});
});
