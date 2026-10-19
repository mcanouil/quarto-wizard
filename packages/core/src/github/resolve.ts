/**
 * @title GitHub Version Resolution Module
 * @description Resolution of a version specification to a downloadable reference.
 *
 * @module github
 */

import type { VersionSpec } from "../types/extension.js";
import { SamlSsoError, VersionError, isCancellationError } from "../errors.js";
import {
	constructArchiveUrl,
	fetchDefaultBranch,
	fetchLatestCommit,
	fetchReleases,
	fetchTags,
	validateBranch,
	validateCommit,
	type GitHubOptions,
} from "./releases.js";
import { resolveLatestTag } from "./latest.js";

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
	const { defaultBranch, latestCommit } = options;

	switch (version.type) {
		case "latest": {
			const latest = await resolveLatestTag(owner, repo, options);
			if (latest) {
				return {
					tagName: latest.tagName,
					zipballUrl: latest.zipballUrl,
					tarballUrl: latest.tarballUrl,
				};
			}

			// Fallback to default branch with commit tracking. The registry hint is
			// preferred, then GitHub itself, because the branch is not always "main".
			const branch = defaultBranch ?? (await fetchDefaultBranch(owner, repo, options)) ?? "main";
			const commitSha = (latestCommit ?? (await lookUpLatestCommit(owner, repo, options)))?.substring(0, 7);
			return {
				tagName: commitSha ?? "HEAD",
				zipballUrl: constructArchiveUrl(owner, repo, branch, "branch", "zip"),
				tarballUrl: constructArchiveUrl(owner, repo, branch, "branch", "tarball"),
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

			throw new VersionError(`Version "${tagName}" not found for ${owner}/${repo}`, {
				suggestion: `Check available releases at: https://github.com/${owner}/${repo}/releases`,
			});
		}

		case "commit": {
			const commitRef = version.commit;
			// Validate commit exists before constructing URL
			await validateCommit(owner, repo, commitRef, options);
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
			// Validate branch exists before constructing URL
			await validateBranch(owner, repo, branchName, options);
			return {
				tagName: branchName,
				zipballUrl: constructArchiveUrl(owner, repo, branchName, "branch", "zip"),
				tarballUrl: constructArchiveUrl(owner, repo, branchName, "branch", "tarball"),
			};
		}
	}
}

/**
 * Look up the latest commit of the default branch, so that an install without
 * tags records the commit it installed. A failed lookup returns `undefined`,
 * so the install still goes ahead without a commit. A SAML SSO error and a
 * cancellation are rethrown, as in `fetchDefaultBranch`.
 */
async function lookUpLatestCommit(owner: string, repo: string, options: GitHubOptions): Promise<string | undefined> {
	try {
		return (await fetchLatestCommit(owner, repo, options)) ?? undefined;
	} catch (error) {
		if (error instanceof SamlSsoError || isCancellationError(error)) {
			throw error;
		}
		return undefined;
	}
}
