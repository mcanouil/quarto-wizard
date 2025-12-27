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

import {
  fetchReleases,
  fetchTags,
  getLatestRelease,
  resolveVersion,
} from "../src/github/releases.js";

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
    await expect(
      resolveVersion("owner", "repo", { type: "tag", tag: "v999.0.0" })
    ).rejects.toThrow("not found");
  });
});
