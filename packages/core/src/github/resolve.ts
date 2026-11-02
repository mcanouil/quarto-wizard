/**
 * @title GitHub Version Resolution Module
 * @description Resolution of a version specification to a downloadable reference.
 *
 * @module github
 */

import type { VersionSpec } from "../types/extension.js";
import { normaliseCommit, shortCommit, type InstallTrack } from "../types/manifest.js";
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
	/**
	 * Repository subdirectory that is installed. Without a tag, the commit
	 * recorded is the latest commit that changes this path.
	 */
	path?: string;
	/**
	 * What a `latest` version follows: the latest tag (default), or the head of
	 * the default branch. The other version types ignore it.
	 */
	track?: InstallTrack;
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
	/** Full commit SHA in lower case, if resolved to a commit. */
	commitSha?: string;
	/** Whether the archive is that of a release or a tag. */
	fromTag: boolean;
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
	const { track = "tag" } = options;

	switch (version.type) {
		case "latest": {
			const latest = track === "tag" ? await resolveLatestTag(owner, repo, options) : null;
			if (latest) {
				return {
					tagName: latest.tagName,
					zipballUrl: latest.zipballUrl,
					tarballUrl: latest.tarballUrl,
					fromTag: true,
				};
			}
			return resolveBranchHead(owner, repo, undefined, options);
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
					fromTag: true,
				};
			}

			const tags = await fetchTags(owner, repo, options);
			const tag = tags.find((t) => t.name === tagName);
			if (tag) {
				return {
					tagName: tag.name,
					zipballUrl: tag.zipballUrl,
					tarballUrl: tag.tarballUrl,
					fromTag: true,
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
			return {
				tagName: shortCommit(commitRef),
				...commitArchive(owner, repo, commitRef),
				commitSha: normaliseCommit(commitRef),
				fromTag: false,
			};
		}

		case "branch": {
			const head = resolveBranchHead(owner, repo, version.branch, options);
			// The head lookup runs alongside the check that the branch exists, whose error wins.
			head.catch(() => undefined);
			await validateBranch(owner, repo, version.branch, options);
			return head;
		}
	}
}

/**
 * Resolve the head of a branch, the default branch when `branch` is not set.
 *
 * The head is downloaded by its commit, so the files match the commit that is
 * recorded even when the branch moves during the install. Without a commit,
 * it falls back to the branch archive.
 */
async function resolveBranchHead(
	owner: string,
	repo: string,
	branch: string | undefined,
	options: ResolveVersionOptions,
): Promise<ResolvedVersion> {
	const commit =
		(branch === undefined ? options.latestCommit : undefined) ??
		(await lookUpLatestCommit(owner, repo, { ...options, ref: branch }));
	if (commit) {
		const commitSha = normaliseCommit(commit);
		return {
			tagName: branch ?? shortCommit(commitSha),
			...commitArchive(owner, repo, commitSha),
			commitSha,
			fromTag: false,
		};
	}
	// For the default branch, the registry hint is preferred, then GitHub itself,
	// because the branch is not always "main".
	const archiveBranch = branch ?? options.defaultBranch ?? (await fetchDefaultBranch(owner, repo, options)) ?? "main";
	return {
		tagName: branch ?? "HEAD",
		zipballUrl: constructArchiveUrl(owner, repo, archiveBranch, "branch", "zip"),
		tarballUrl: constructArchiveUrl(owner, repo, archiveBranch, "branch", "tarball"),
		fromTag: false,
	};
}

/**
 * Archive URLs of a commit.
 */
function commitArchive(owner: string, repo: string, commit: string): { zipballUrl: string; tarballUrl: string } {
	return {
		zipballUrl: constructArchiveUrl(owner, repo, commit, "commit", "zip"),
		tarballUrl: constructArchiveUrl(owner, repo, commit, "commit", "tarball"),
	};
}

/**
 * Look up the latest commit of a branch, the default branch when `ref` is not
 * set, so that an install records the commit it installed. A failed lookup
 * returns `undefined`, so the install still goes ahead from the branch archive
 * without a commit. A SAML SSO error and a cancellation are rethrown, as in
 * `fetchDefaultBranch`.
 */
async function lookUpLatestCommit(
	owner: string,
	repo: string,
	options: GitHubOptions & { path?: string; ref?: string },
): Promise<string | undefined> {
	try {
		return (await fetchLatestCommit(owner, repo, options)) ?? undefined;
	} catch (error) {
		if (error instanceof SamlSsoError || isCancellationError(error)) {
			throw error;
		}
		return undefined;
	}
}
