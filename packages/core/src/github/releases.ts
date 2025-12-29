/**
 * GitHub releases API client.
 */

import type { AuthConfig } from "../types/auth.js";
import type { VersionSpec } from "../types/extension.js";
import { getAuthHeaders } from "../types/auth.js";
import { AuthenticationError, NetworkError, RepositoryNotFoundError, VersionError } from "../errors.js";
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
 * Options for version resolution.
 */
export interface ResolveVersionOptions extends GitHubOptions {
	/** Default branch to use when no releases/tags exist. */
	defaultBranch?: string;
	/** Latest commit SHA on default branch (for fallback). */
	latestCommit?: string;
}

/**
 * Result of version resolution.
 */
export interface ResolvedVersion {
	/** Resolved tag/version name. */
	tagName: string;
	/** URL to download the zipball. */
	zipballUrl: string;
	/** URL to download the tarball. */
	tarballUrl: string;
	/** Commit SHA if resolved to a commit (first 7 characters). */
	commitSha?: string;
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
 * Construct a GitHub archive URL.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param ref - Git reference (tag, branch, or commit)
 * @param refType - Type of reference
 * @param format - Archive format
 * @returns Archive URL
 */
export function constructArchiveUrl(
	owner: string,
	repo: string,
	ref: string,
	refType: "tag" | "branch" | "commit",
	format: "zip" | "tarball" = "zip",
): string {
	const ext = format === "zip" ? ".zip" : ".tar.gz";
	const baseUrl = `https://github.com/${owner}/${repo}/archive`;

	switch (refType) {
		case "tag":
			return `${baseUrl}/refs/tags/${ref}${ext}`;
		case "branch":
			return `${baseUrl}/refs/heads/${ref}${ext}`;
		case "commit":
			return `${baseUrl}/${ref}${ext}`;
	}
}

/**
 * Handle GitHub API errors.
 */
function handleGitHubError(error: unknown, owner: string, repo: string): never {
	if (error instanceof NetworkError) {
		const status = error.statusCode;

		if (status === 401 || status === 403) {
			throw new AuthenticationError(
				`Authentication required for ${owner}/${repo}. ` +
					`Status: ${status}. ` +
					"The repository may be private or you may have hit the rate limit.",
			);
		}

		if (status === 404) {
			throw new RepositoryNotFoundError(
				`Repository not found: ${owner}/${repo}`,
				"Check if the repository exists and you have access to it",
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
	options: GitHubOptions = {},
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
export async function fetchTags(owner: string, repo: string, options: GitHubOptions = {}): Promise<GitHubTag[]> {
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
	options: GitHubOptions = {},
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
 * @param options - Resolution options
 * @returns Resolved release/tag info with download URL
 */
export async function resolveVersion(
	owner: string,
	repo: string,
	version: VersionSpec,
	options: ResolveVersionOptions = {},
): Promise<ResolvedVersion> {
	const { defaultBranch = "main", latestCommit } = options;

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

			// Fallback to default branch with commit tracking
			const commitSha = latestCommit?.substring(0, 7);
			return {
				tagName: commitSha ?? "HEAD",
				zipballUrl: constructArchiveUrl(owner, repo, defaultBranch, "branch", "zip"),
				tarballUrl: constructArchiveUrl(owner, repo, defaultBranch, "branch", "tarball"),
				commitSha,
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
				"Check available releases at: https://github.com/" + `${owner}/${repo}/releases`,
			);
		}

		case "commit": {
			const commitRef = version.commit;
			const shortCommit = commitRef.substring(0, 7);
			return {
				tagName: shortCommit,
				zipballUrl: constructArchiveUrl(owner, repo, commitRef, "commit", "zip"),
				tarballUrl: constructArchiveUrl(owner, repo, commitRef, "commit", "tarball"),
				commitSha: shortCommit,
			};
		}

		case "branch": {
			const branchName = version.branch;
			return {
				tagName: branchName,
				zipballUrl: constructArchiveUrl(owner, repo, branchName, "branch", "zip"),
				tarballUrl: constructArchiveUrl(owner, repo, branchName, "branch", "tarball"),
			};
		}
	}
}
