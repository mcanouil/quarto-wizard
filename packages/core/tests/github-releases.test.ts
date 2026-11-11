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

// The list endpoints read their pages through `fetchJsonPages`, which answers
// here with the one page that the mocked `fetchJson` gives. Pagination itself is
// covered in `github-pagination.test.ts`.
vi.mock("../src/registry/http.js", () => {
	const fetchJson = vi.fn().mockImplementation((url: string) => {
		if (url.includes("/releases")) {
			return Promise.resolve(mockReleases);
		}
		if (url.includes("/tags")) {
			return Promise.resolve(mockTags);
		}
		// Mock branch validation endpoint
		if (url.includes("/branches/")) {
			return Promise.resolve({ name: "main", commit: { sha: "abc123" } });
		}
		// Mock latest commit of a branch
		if (url.includes("/commits?")) {
			return Promise.resolve([{ sha: "BEEF123456789beef123456789beef123456789b" }]);
		}
		// Mock commit validation endpoint
		if (url.includes("/commits/")) {
			return Promise.resolve({ sha: "abc1234567890", commit: { message: "test" } });
		}
		return Promise.reject(new Error("Unknown URL"));
	});
	return {
		fetchJson,
		fetchJsonPages: vi.fn((url: string, options: unknown) => fetchJson(url, options)),
		fetchRedirectLocation: vi.fn().mockRejectedValue(new Error("Unexpected redirect lookup")),
	};
});

import {
	compareCommits,
	fetchDefaultBranchHead,
	fetchLatestCommit,
	fetchReleases,
	fetchTags,
	constructArchiveUrl,
} from "../src/github/releases.js";
import { resolveVersion } from "../src/github/resolve.js";
import {
	AuthenticationError,
	CancellationError,
	NetworkError,
	RateLimitError,
	RepositoryNotFoundError,
	SamlSsoError,
} from "../src/errors.js";

/** Archive of a commit as `codeload.github.com` names it in the `archive/HEAD` redirect. */
function codeload(sha: string): string {
	return `https://codeload.github.com/owner/repo/tar.gz/${sha}`;
}

/** Answer the next `archive/HEAD` redirect lookup with a `Location`, or reject it with an error. */
async function mockRedirect(answer: string | Error) {
	const { fetchRedirectLocation } = vi.mocked(await import("../src/registry/http.js"));
	if (answer instanceof Error) {
		fetchRedirectLocation.mockRejectedValueOnce(answer);
	} else {
		fetchRedirectLocation.mockResolvedValueOnce(answer);
	}
	return fetchRedirectLocation;
}

/**
 * Build a `fetchJson` implementation for the endpoints `resolveVersion` reads.
 * The releases and the tags endpoints answer with an empty list unless a test
 * gives one. Any other endpoint rejects, so a test fails on an unexpected lookup.
 */
function githubApiMock(endpoints: { releases?: unknown[]; tags?: unknown[] }) {
	const { releases = [], tags = [] } = endpoints;
	return (url: string) => {
		if (url.includes("/releases")) return Promise.resolve(releases);
		if (url.includes("/tags")) return Promise.resolve(tags);
		return Promise.reject(new Error("Unknown URL"));
	};
}

describe("handleGitHubError SAML pass-through", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("re-throws SamlSsoError unchanged (does not convert to AuthenticationError)", async () => {
		const samlUrl = "https://github.com/orgs/myorg/sso?authorization_request=abc";
		const samlError = new SamlSsoError("HTTP 403: SAML SSO enforcement", { authorizationUrl: samlUrl });
		vi.mocked(await import("../src/registry/http.js")).fetchJson.mockRejectedValueOnce(samlError);

		const error = await fetchReleases("owner", "repo").catch((e: unknown) => e);
		expect(error).toBeInstanceOf(SamlSsoError);
		expect(error).not.toBeInstanceOf(AuthenticationError);
		expect((error as SamlSsoError).authorizationUrl).toBe(samlUrl);
	});

	it("re-throws RateLimitError unchanged (does not convert to AuthenticationError)", async () => {
		const rateLimit = new RateLimitError("HTTP 403: rate limit exceeded", { statusCode: 403 });
		vi.mocked(await import("../src/registry/http.js")).fetchJson.mockRejectedValueOnce(rateLimit);

		const error = await fetchReleases("owner", "repo").catch((e: unknown) => e);
		expect(error).toBe(rateLimit);
	});

	it("names a denied 403 as denied access, not as a rate limit", async () => {
		vi.mocked(await import("../src/registry/http.js")).fetchJson.mockRejectedValueOnce(
			new NetworkError("HTTP 403: Forbidden", { statusCode: 403 }),
		);

		const error = await fetchReleases("owner", "repo").catch((e: unknown) => e);
		expect(error).toBeInstanceOf(AuthenticationError);
		expect((error as Error).message).toContain("Access denied to owner/repo");
		expect((error as Error).message).not.toMatch(/rate limit/i);
	});

	it("names a 401 as a rejected token", async () => {
		vi.mocked(await import("../src/registry/http.js")).fetchJson.mockRejectedValueOnce(
			new NetworkError("HTTP 401: Unauthorized", { statusCode: 401 }),
		);

		const error = await fetchReleases("owner", "repo").catch((e: unknown) => e);
		expect(error).toBeInstanceOf(AuthenticationError);
		expect((error as Error).message).toContain("Authentication failed for owner/repo");
		expect((error as Error).message).not.toMatch(/rate limit/i);
	});
});

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

describe("fetchLatestCommit", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns the newest commit of the default branch", async () => {
		const { fetchJson } = vi.mocked(await import("../src/registry/http.js"));
		fetchJson.mockResolvedValueOnce([{ sha: "def5678901234" }]);

		const sha = await fetchLatestCommit("owner", "repo");

		expect(sha).toBe("def5678901234");
		expect(fetchJson.mock.calls[0]?.[0]).toBe("https://api.github.com/repos/owner/repo/commits?per_page=1");
	});

	it("keeps only the commits that change a path", async () => {
		const { fetchJson } = vi.mocked(await import("../src/registry/http.js"));
		fetchJson.mockResolvedValueOnce([{ sha: "def5678901234" }]);

		await fetchLatestCommit("owner", "repo", { path: "sub/dir" });

		expect(fetchJson.mock.calls[0]?.[0]).toBe(
			"https://api.github.com/repos/owner/repo/commits?per_page=1&path=sub%2Fdir",
		);
	});

	it("reads the commits of a ref", async () => {
		const { fetchJson } = vi.mocked(await import("../src/registry/http.js"));
		fetchJson.mockResolvedValueOnce([{ sha: "def5678901234" }]);

		await fetchLatestCommit("owner", "repo", { ref: "dev" });

		expect(fetchJson.mock.calls[0]?.[0]).toBe("https://api.github.com/repos/owner/repo/commits?per_page=1&sha=dev");
	});

	it("returns null for a repository without commits", async () => {
		vi.mocked(await import("../src/registry/http.js")).fetchJson.mockResolvedValueOnce([]);

		expect(await fetchLatestCommit("owner", "repo")).toBeNull();
	});

	it("keeps the HTTP status of a denied request as the cause", async () => {
		const forbidden = new NetworkError("HTTP 403: Forbidden", { statusCode: 403 });
		vi.mocked(await import("../src/registry/http.js")).fetchJson.mockRejectedValueOnce(forbidden);

		const error = await fetchLatestCommit("owner", "repo").catch((e: unknown) => e);

		expect(error).toBeInstanceOf(AuthenticationError);
		expect((error as AuthenticationError).cause).toBe(forbidden);
	});
});

describe("fetchDefaultBranchHead", () => {
	const SHA = "911b18ae14e559d8aaa1f7ba5e8305bd71b03a7e";

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns the sha of the codeload redirect", async () => {
		const fetchRedirectLocation = await mockRedirect(`https://codeload.github.com/owner/repo/tar.gz/${SHA}`);

		expect(await fetchDefaultBranchHead("owner", "repo")).toBe(SHA);
		expect(fetchRedirectLocation.mock.calls[0]?.[0]).toBe("https://github.com/owner/repo/archive/HEAD.tar.gz");
	});

	it("lower-cases the sha", async () => {
		await mockRedirect(`https://codeload.github.com/owner/repo/tar.gz/${SHA.toUpperCase()}`);

		expect(await fetchDefaultBranchHead("owner", "repo")).toBe(SHA);
	});

	it("accepts the signed token query of a private repository", async () => {
		await mockRedirect(`https://codeload.github.com/owner/repo/tar.gz/${SHA}?token=ABC`);

		expect(await fetchDefaultBranchHead("owner", "repo")).toBe(SHA);
	});

	it("sends the token to github.com", async () => {
		const fetchRedirectLocation = await mockRedirect(`https://codeload.github.com/owner/repo/tar.gz/${SHA}`);

		await fetchDefaultBranchHead("owner", "repo", { auth: { githubToken: "t", httpHeaders: [] } });

		expect(fetchRedirectLocation.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer t" });
	});

	it("follows the redirect of a renamed repository once", async () => {
		const fetchRedirectLocation = await mockRedirect("https://github.com/owner/new-repo/archive/HEAD.tar.gz");
		fetchRedirectLocation.mockResolvedValueOnce(`https://codeload.github.com/owner/new-repo/tar.gz/${SHA}`);

		expect(await fetchDefaultBranchHead("owner", "repo")).toBe(SHA);
		expect(fetchRedirectLocation.mock.calls[1]?.[0]).toBe("https://github.com/owner/new-repo/archive/HEAD.tar.gz");
	});

	it("rejects a redirect that holds no commit", async () => {
		await mockRedirect("https://codeload.github.com/owner/repo/tar.gz/refs/heads/main");

		const error = await fetchDefaultBranchHead("owner", "repo").catch((e: unknown) => e);

		expect(error).toBeInstanceOf(NetworkError);
		expect((error as NetworkError).message).toContain("owner/repo");
	});

	it("rejects a redirect to another host", async () => {
		await mockRedirect(`https://example.com/owner/repo/tar.gz/${SHA}`);

		const error = await fetchDefaultBranchHead("owner", "repo").catch((e: unknown) => e);

		expect(error).toBeInstanceOf(NetworkError);
		expect((error as NetworkError).message).toContain("owner/repo");
	});

	it("names the repository and keeps the status of a server error", async () => {
		await mockRedirect(new NetworkError("HTTP 502: Bad Gateway", { statusCode: 502 }));

		const error = await fetchDefaultBranchHead("owner", "repo").catch((e: unknown) => e);

		expect(error).toBeInstanceOf(NetworkError);
		expect((error as NetworkError).message).toContain("Cannot read the default branch head of owner/repo");
		expect((error as NetworkError).message).toContain("HTTP 502");
		expect((error as NetworkError).statusCode).toBe(502);
		expect((error as NetworkError).suggestion).toContain("proxy");
	});

	it("suggests checking a proxy when the redirect is unexpected", async () => {
		await mockRedirect("https://example.com/owner/repo/archive.tar.gz");

		const error = await fetchDefaultBranchHead("owner", "repo").catch((e: unknown) => e);

		expect((error as NetworkError).suggestion).toContain("proxy");
	});

	it("maps a 404 to RepositoryNotFoundError", async () => {
		await mockRedirect(new NetworkError("HTTP 404: Not Found", { statusCode: 404 }));

		await expect(fetchDefaultBranchHead("owner", "repo")).rejects.toBeInstanceOf(RepositoryNotFoundError);
	});

	it("asks the API whether SAML SSO blocks a token that gets a 404", async () => {
		const samlUrl = "https://github.com/orgs/acme/sso?authorization_request=abc";
		const { fetchJson } = vi.mocked(await import("../src/registry/http.js"));
		fetchJson.mockRejectedValueOnce(new SamlSsoError("HTTP 403: SAML SSO enforcement", { authorizationUrl: samlUrl }));
		await mockRedirect(new NetworkError("HTTP 404: Not Found", { statusCode: 404 }));

		const error = await fetchDefaultBranchHead("owner", "repo", { auth: { githubToken: "t", httpHeaders: [] } }).catch(
			(e: unknown) => e,
		);

		expect(error).toBeInstanceOf(SamlSsoError);
		expect(fetchJson.mock.calls[0]?.[0]).toBe("https://api.github.com/repos/owner/repo");
	});

	it("reports a 404 as not found when the API finds no SAML SSO block", async () => {
		const { fetchJson } = vi.mocked(await import("../src/registry/http.js"));
		fetchJson.mockRejectedValueOnce(new NetworkError("HTTP 404: Not Found", { statusCode: 404 }));
		await mockRedirect(new NetworkError("HTTP 404: Not Found", { statusCode: 404 }));

		await expect(
			fetchDefaultBranchHead("owner", "repo", { auth: { githubToken: "t", httpHeaders: [] } }),
		).rejects.toBeInstanceOf(RepositoryNotFoundError);
	});

	it("makes no API request for a 404 without a token", async () => {
		const { fetchJson } = vi.mocked(await import("../src/registry/http.js"));
		await mockRedirect(new NetworkError("HTTP 404: Not Found", { statusCode: 404 }));

		await expect(fetchDefaultBranchHead("owner", "repo")).rejects.toBeInstanceOf(RepositoryNotFoundError);
		expect(fetchJson).not.toHaveBeenCalled();
	});

	it("says that a 404 can come from a repository without a commit", async () => {
		await mockRedirect(new NetworkError("HTTP 404: Not Found", { statusCode: 404 }));

		const error = await fetchDefaultBranchHead("owner", "repo").catch((e: unknown) => e);

		expect((error as RepositoryNotFoundError).suggestion).toContain("at least one commit");
	});

	it("maps a 401 to AuthenticationError", async () => {
		await mockRedirect(new NetworkError("HTTP 401: Unauthorized", { statusCode: 401 }));

		await expect(fetchDefaultBranchHead("owner", "repo")).rejects.toBeInstanceOf(AuthenticationError);
	});

	it("rethrows a RateLimitError", async () => {
		await mockRedirect(new RateLimitError("HTTP 429: rate limit exceeded", { statusCode: 429 }));

		await expect(fetchDefaultBranchHead("owner", "repo")).rejects.toBeInstanceOf(RateLimitError);
	});
});

describe("compareCommits", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns the status of head against base", async () => {
		const { fetchJson } = vi.mocked(await import("../src/registry/http.js"));
		fetchJson.mockResolvedValueOnce({ status: "ahead" });

		const status = await compareCommits("owner", "repo", "def5678", "abc1234");

		expect(status).toBe("ahead");
		expect(fetchJson.mock.calls[0]?.[0]).toBe(
			"https://api.github.com/repos/owner/repo/compare/def5678...abc1234?per_page=1",
		);
	});
});

describe("resolveVersion", () => {
	const HEAD_SHA = "911b18ae14e559d8aaa1f7ba5e8305bd71b03a7e";

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
		expect(result.zipballUrl).toBe(
			"https://github.com/owner/repo/archive/beef123456789beef123456789beef123456789b.zip",
		);
		expect(result.tarballUrl).toBe(
			"https://github.com/owner/repo/archive/beef123456789beef123456789beef123456789b.tar.gz",
		);
		expect(result.commitSha).toBe("beef123456789beef123456789beef123456789b");
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
		expect(result.commitSha).toBe("abc1234567890");
	});

	it("downloads the default branch by its head commit when no releases/tags", async () => {
		const { fetchJson } = vi.mocked(await import("../src/registry/http.js"));
		fetchJson.mockImplementation(githubApiMock({}));
		await mockRedirect(codeload(HEAD_SHA));

		const result = await resolveVersion("owner", "repo", { type: "latest" });

		expect(result.tagName).toBe("911b18a");
		expect(result.zipballUrl).toBe(`https://github.com/owner/repo/archive/${HEAD_SHA}.zip`);
		expect(result.tarballUrl).toBe(`https://github.com/owner/repo/archive/${HEAD_SHA}.tar.gz`);
		expect(result.commitSha).toBe(HEAD_SHA);
		expect(result.fromTag).toBe(false);
		expect(fetchJson.mock.calls.some(([url]) => String(url).includes("/commits?"))).toBe(false);
	});

	it("fails when the default branch head cannot be read", async () => {
		const { fetchJson } = vi.mocked(await import("../src/registry/http.js"));
		fetchJson.mockImplementation(githubApiMock({}));
		await mockRedirect(new NetworkError("HTTP 404: Not Found", { statusCode: 404 }));

		await expect(resolveVersion("owner", "repo", { type: "latest" })).rejects.toBeInstanceOf(RepositoryNotFoundError);
	});

	it("propagates a SAML SSO error from the default branch head lookup", async () => {
		const samlUrl = "https://github.com/orgs/myorg/sso?authorization_request=abc";
		const { fetchJson } = vi.mocked(await import("../src/registry/http.js"));
		fetchJson.mockImplementation(githubApiMock({}));
		await mockRedirect(new SamlSsoError("HTTP 403: SAML SSO enforcement", { authorizationUrl: samlUrl }));

		await expect(resolveVersion("owner", "repo", { type: "latest" })).rejects.toBeInstanceOf(SamlSsoError);
	});

	it("propagates a cancellation from the default branch head lookup", async () => {
		const { fetchJson } = vi.mocked(await import("../src/registry/http.js"));
		fetchJson.mockImplementation(githubApiMock({}));
		await mockRedirect(new CancellationError());

		await expect(resolveVersion("owner", "repo", { type: "latest" })).rejects.toBeInstanceOf(CancellationError);
	});

	it("records the latest commit of a path at the head when no tag exists", async () => {
		const { fetchJson } = vi.mocked(await import("../src/registry/http.js"));
		const api = githubApiMock({});
		fetchJson.mockImplementation((url: string) =>
			url.endsWith(`/commits?per_page=1&sha=${HEAD_SHA}&path=sub%2Fdir`)
				? Promise.resolve([{ sha: "fed9876543210" }])
				: api(url),
		);
		await mockRedirect(codeload(HEAD_SHA));

		const result = await resolveVersion("owner", "repo", { type: "latest" }, { path: "sub/dir" });

		expect(result.tagName).toBe("fed9876");
		expect(result.commitSha).toBe("fed9876543210");
		expect(result.tarballUrl).toBe(`https://github.com/owner/repo/archive/${HEAD_SHA}.tar.gz`);
	});

	it("records the head when the latest commit of a path cannot be read", async () => {
		const { fetchJson } = vi.mocked(await import("../src/registry/http.js"));
		const api = githubApiMock({});
		fetchJson.mockImplementation((url: string) =>
			url.includes("/commits?") ? Promise.reject(new NetworkError("HTTP 500", { statusCode: 500 })) : api(url),
		);
		await mockRedirect(codeload(HEAD_SHA));

		const result = await resolveVersion("owner", "repo", { type: "latest" }, { path: "sub/dir" });

		expect(result.commitSha).toBe(HEAD_SHA);
		expect(result.tarballUrl).toBe(`https://github.com/owner/repo/archive/${HEAD_SHA}.tar.gz`);
	});

	it("does not look up the default branch when a release exists", async () => {
		const { fetchJson, fetchRedirectLocation } = vi.mocked(await import("../src/registry/http.js"));
		fetchJson.mockImplementation(githubApiMock({ releases: mockReleases }));

		const result = await resolveVersion("owner", "repo", { type: "latest" });

		expect(result.tagName).toBe("v2.0.0");
		expect(result.fromTag).toBe(true);
		expect(fetchRedirectLocation).not.toHaveBeenCalled();
	});

	it("downloads the default branch head by commit in branch mode, even when a release exists", async () => {
		const { fetchJson } = vi.mocked(await import("../src/registry/http.js"));
		fetchJson.mockImplementation(githubApiMock({ releases: mockReleases, tags: mockTags }));
		await mockRedirect(codeload(HEAD_SHA));

		const result = await resolveVersion("owner", "repo", { type: "latest" }, { track: "branch" });

		expect(result.zipballUrl).toBe(`https://github.com/owner/repo/archive/${HEAD_SHA}.zip`);
		expect(result.commitSha).toBe(HEAD_SHA);
		expect(result.fromTag).toBe(false);
		expect(fetchJson.mock.calls.some(([url]) => /\/(releases|tags)/.test(String(url)))).toBe(false);
	});

	it("looks up the head of an explicit branch for the path of a subdirectory", async () => {
		const { fetchJson } = vi.mocked(await import("../src/registry/http.js"));
		fetchJson.mockImplementation((url: string) => {
			if (url.includes("/branches/")) return Promise.resolve({ name: "dev" });
			if (url.endsWith("/commits?per_page=1&sha=dev&path=sub%2Fdir"))
				return Promise.resolve([{ sha: "fed9876543210" }]);
			return Promise.reject(new Error(`Unknown URL ${url}`));
		});

		const result = await resolveVersion("owner", "repo", { type: "branch", branch: "dev" }, { path: "sub/dir" });

		expect(result.tagName).toBe("dev");
		expect(result.tarballUrl).toBe("https://github.com/owner/repo/archive/fed9876543210.tar.gz");
		expect(result.commitSha).toBe("fed9876543210");
	});

	it("propagates a rate limit from the default branch head lookup in branch mode", async () => {
		await mockRedirect(new RateLimitError("HTTP 429: rate limit exceeded", { statusCode: 429 }));

		await expect(resolveVersion("owner", "repo", { type: "latest" }, { track: "branch" })).rejects.toBeInstanceOf(
			RateLimitError,
		);
	});

	it("does not read the default branch head for an explicit branch", async () => {
		const { fetchJson, fetchRedirectLocation } = vi.mocked(await import("../src/registry/http.js"));
		fetchJson.mockImplementation((url: string) => {
			if (url.includes("/branches/")) return Promise.resolve({ name: "dev" });
			if (url.includes("/commits?")) return Promise.resolve([{ sha: "fed9876543210" }]);
			return Promise.reject(new Error(`Unknown URL ${url}`));
		});

		await resolveVersion("owner", "repo", { type: "branch", branch: "dev" });

		expect(fetchRedirectLocation).not.toHaveBeenCalled();
	});

	it("falls back to the archive of an explicit branch when its head lookup fails", async () => {
		const { fetchJson } = vi.mocked(await import("../src/registry/http.js"));
		fetchJson.mockImplementation((url: string) => {
			if (url.includes("/branches/")) return Promise.resolve({ name: "dev" });
			if (url.includes("/commits?")) return Promise.reject(new NetworkError("HTTP 500", { statusCode: 500 }));
			return Promise.reject(new Error(`Unknown URL ${url}`));
		});

		const result = await resolveVersion("owner", "repo", { type: "branch", branch: "dev" });

		expect(result.tagName).toBe("dev");
		expect(result.zipballUrl).toBe("https://github.com/owner/repo/archive/refs/heads/dev.zip");
		expect(result.commitSha).toBeUndefined();
	});

	it("propagates a SAML SSO error from the head lookup of an explicit branch", async () => {
		const samlUrl = "https://github.com/orgs/myorg/sso?authorization_request=abc";
		const { fetchJson } = vi.mocked(await import("../src/registry/http.js"));
		fetchJson.mockImplementation((url: string) => {
			if (url.includes("/branches/")) return Promise.resolve({ name: "dev" });
			if (url.includes("/commits?"))
				return Promise.reject(new SamlSsoError("HTTP 403: SAML SSO enforcement", { authorizationUrl: samlUrl }));
			return Promise.reject(new Error(`Unknown URL ${url}`));
		});

		await expect(resolveVersion("owner", "repo", { type: "branch", branch: "dev" })).rejects.toBeInstanceOf(
			SamlSsoError,
		);
	});

	it("names a commit by its seven characters in lower case", async () => {
		const { fetchJson } = vi.mocked(await import("../src/registry/http.js"));
		fetchJson.mockResolvedValue({ sha: "abcdef1234567" });

		const result = await resolveVersion("owner", "repo", { type: "commit", commit: "ABCDEF1234567" });

		expect(result.tagName).toBe("abcdef1");
		expect(result.commitSha).toBe("abcdef1234567");
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
