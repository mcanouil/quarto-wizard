/**
 * GitHub releases API client.
 */

import type { AuthConfig } from "../types/auth.js";
import type { VersionSpec } from "../types/extension.js";
import { getAuthHeaders } from "../types/auth.js";
import {
  AuthenticationError,
  NetworkError,
  RepositoryNotFoundError,
  VersionError,
} from "../errors.js";
import { fetchJson } from "../registry/http.js";

const GITHUB_API_BASE = "https://api.github.com";

/**
 * GitHub release information.
 */
export interface GitHubRelease {
  /** Release tag name (e.g., "v1.0.0"). */
  tagName: string;
  /** Release name/title. */
  name: string;
  /** URL to download the zipball. */
  zipballUrl: string;
  /** URL to download the tarball. */
  tarballUrl: string;
  /** URL to the release page. */
  htmlUrl: string;
  /** ISO timestamp when published. */
  publishedAt: string;
  /** Whether this is a prerelease. */
  prerelease: boolean;
  /** Whether this is a draft. */
  draft: boolean;
}

/**
 * GitHub tag information.
 */
export interface GitHubTag {
  /** Tag name. */
  name: string;
  /** Commit SHA. */
  sha: string;
  /** URL to download the zipball. */
  zipballUrl: string;
  /** URL to download the tarball. */
  tarballUrl: string;
}

/**
 * Raw release response from GitHub API.
 */
interface RawRelease {
  tag_name: string;
  name: string;
  zipball_url: string;
  tarball_url: string;
  html_url: string;
  published_at: string;
  prerelease: boolean;
  draft: boolean;
}

/**
 * Raw tag response from GitHub API.
 */
interface RawTag {
  name: string;
  commit: { sha: string };
  zipball_url: string;
  tarball_url: string;
}

/**
 * Options for GitHub API requests.
 */
export interface GitHubOptions {
  /** Authentication configuration. */
  auth?: AuthConfig;
  /** Request timeout in milliseconds. */
  timeout?: number;
  /** Include prereleases when resolving versions. */
  includePrereleases?: boolean;
}

/**
 * Get GitHub API headers.
 */
function getGitHubHeaders(auth?: AuthConfig): Record<string, string> {
  return {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "quarto-wizard",
    ...getAuthHeaders(auth, true),
  };
}

/**
 * Handle GitHub API errors.
 */
function handleGitHubError(
  error: unknown,
  owner: string,
  repo: string
): never {
  if (error instanceof NetworkError) {
    const status = error.statusCode;

    if (status === 401 || status === 403) {
      throw new AuthenticationError(
        `Authentication required for ${owner}/${repo}. ` +
        `Status: ${status}. ` +
        "The repository may be private or you may have hit the rate limit."
      );
    }

    if (status === 404) {
      throw new RepositoryNotFoundError(
        `Repository not found: ${owner}/${repo}`,
        "Check if the repository exists and you have access to it"
      );
    }
  }

  throw error;
}

/**
 * Fetch releases for a repository.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param options - GitHub options
 * @returns Array of releases
 */
export async function fetchReleases(
  owner: string,
  repo: string,
  options: GitHubOptions = {}
): Promise<GitHubRelease[]> {
  const { auth, timeout, includePrereleases = false } = options;
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/releases`;

  try {
    const raw = await fetchJson<RawRelease[]>(url, {
      headers: getGitHubHeaders(auth),
      timeout,
      retries: 2,
    });

    return raw
      .filter((r) => !r.draft && (includePrereleases || !r.prerelease))
      .map((r) => ({
        tagName: r.tag_name,
        name: r.name,
        zipballUrl: r.zipball_url,
        tarballUrl: r.tarball_url,
        htmlUrl: r.html_url,
        publishedAt: r.published_at,
        prerelease: r.prerelease,
        draft: r.draft,
      }));
  } catch (error) {
    handleGitHubError(error, owner, repo);
  }
}

/**
 * Fetch tags for a repository.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param options - GitHub options
 * @returns Array of tags
 */
export async function fetchTags(
  owner: string,
  repo: string,
  options: GitHubOptions = {}
): Promise<GitHubTag[]> {
  const { auth, timeout } = options;
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/tags`;

  try {
    const raw = await fetchJson<RawTag[]>(url, {
      headers: getGitHubHeaders(auth),
      timeout,
      retries: 2,
    });

    return raw.map((t) => ({
      name: t.name,
      sha: t.commit.sha,
      zipballUrl: t.zipball_url,
      tarballUrl: t.tarball_url,
    }));
  } catch (error) {
    handleGitHubError(error, owner, repo);
  }
}

/**
 * Get the latest release for a repository.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param options - GitHub options
 * @returns Latest release or null if none
 */
export async function getLatestRelease(
  owner: string,
  repo: string,
  options: GitHubOptions = {}
): Promise<GitHubRelease | null> {
  const releases = await fetchReleases(owner, repo, options);
  return releases[0] ?? null;
}

/**
 * Resolve a version specification to a release or tag.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param version - Version specification
 * @param options - GitHub options
 * @returns Resolved release/tag info with download URL
 */
export async function resolveVersion(
  owner: string,
  repo: string,
  version: VersionSpec,
  options: GitHubOptions = {}
): Promise<{ tagName: string; zipballUrl: string; tarballUrl: string }> {
  const { auth, timeout } = options;

  switch (version.type) {
    case "latest": {
      const release = await getLatestRelease(owner, repo, options);
      if (release) {
        return {
          tagName: release.tagName,
          zipballUrl: release.zipballUrl,
          tarballUrl: release.tarballUrl,
        };
      }

      const tags = await fetchTags(owner, repo, options);
      if (tags.length > 0 && tags[0]) {
        return {
          tagName: tags[0].name,
          zipballUrl: tags[0].zipballUrl,
          tarballUrl: tags[0].tarballUrl,
        };
      }

      return {
        tagName: "HEAD",
        zipballUrl: `https://github.com/${owner}/${repo}/archive/refs/heads/main.zip`,
        tarballUrl: `https://github.com/${owner}/${repo}/archive/refs/heads/main.tar.gz`,
      };
    }

    case "tag":
    case "exact": {
      const tagName = version.type === "tag" ? version.tag : `v${version.version}`;

      const releases = await fetchReleases(owner, repo, options);
      const release = releases.find((r) => r.tagName === tagName);
      if (release) {
        return {
          tagName: release.tagName,
          zipballUrl: release.zipballUrl,
          tarballUrl: release.tarballUrl,
        };
      }

      const tags = await fetchTags(owner, repo, options);
      const tag = tags.find((t) => t.name === tagName);
      if (tag) {
        return {
          tagName: tag.name,
          zipballUrl: tag.zipballUrl,
          tarballUrl: tag.tarballUrl,
        };
      }

      throw new VersionError(
        `Version "${tagName}" not found for ${owner}/${repo}`,
        "Check available releases at: https://github.com/" +
          `${owner}/${repo}/releases`
      );
    }

    case "branch": {
      const branchName = version.branch;
      return {
        tagName: branchName,
        zipballUrl: `https://github.com/${owner}/${repo}/archive/refs/heads/${branchName}.zip`,
        tarballUrl: `https://github.com/${owner}/${repo}/archive/refs/heads/${branchName}.tar.gz`,
      };
    }
  }
}
