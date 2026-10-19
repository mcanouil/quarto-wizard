/**
 * @title Latest Tag Module
 * @description Resolution of the latest GitHub tag of a repository.
 *
 * Provides the single rule that installs and update checks use for "latest".
 *
 * @module github
 */

import * as semver from "semver";
import { fetchReleases, fetchTags, type GitHubOptions } from "./releases.js";

/**
 * Latest tag of a repository.
 */
export interface LatestTag {
	/** Tag name as published (e.g., "v1.3.0"). */
	tagName: string;
	/** Normalised semantic version of the tag (e.g., "1.3.0"). */
	version: string;
	/** URL to the release page, or null when the tag has no release. */
	releaseUrl: string | null;
	/** URL to download the zipball. */
	zipballUrl: string;
	/** URL to download the tarball. */
	tarballUrl: string;
}

/**
 * Options for resolving the latest tag.
 */
export interface ResolveLatestTagOptions extends GitHubOptions {
	/** Installed version. Prereleases qualify only when this is a prerelease. */
	currentVersion?: string;
}

/**
 * Normalise a version string for comparison.
 * Strips leading "v" prefix and coerces to valid semver, keeping prerelease
 * identifiers so that "2.0.0-beta.1" sorts below "2.0.0".
 *
 * @param version - Version string to normalise
 * @returns Normalised semver string, or null if invalid
 */
export function normaliseVersion(version: string): string | null {
	if (!version) {
		return null;
	}

	const cleaned = version.replace(/^v/, "").trim();

	return semver.valid(semver.coerce(cleaned, { includePrerelease: true }));
}

function isPrereleaseVersion(version: string | undefined): boolean {
	const normalised = version ? normaliseVersion(version) : null;
	return normalised !== null && semver.prerelease(normalised) !== null;
}

/**
 * Resolve the latest tag of a repository.
 *
 * The latest tag is the highest semantic version among the releases and the
 * tags together; the GitHub "latest release" marker is not used. Tag names
 * that are not semantic versions are ignored. Prereleases, by version or by the
 * GitHub release flag, qualify only when the installed version is a prerelease.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param options - GitHub options and the installed version
 * @returns Latest tag, or null when no tag qualifies
 */
export async function resolveLatestTag(
	owner: string,
	repo: string,
	options: ResolveLatestTagOptions = {},
): Promise<LatestTag | null> {
	const { currentVersion, ...githubOptions } = options;
	const followPrereleases = isPrereleaseVersion(currentVersion);

	const [releases, tags] = await Promise.all([
		fetchReleases(owner, repo, { ...githubOptions, includePrereleases: true }),
		fetchTags(owner, repo, githubOptions),
	]);

	const flaggedPrereleases = new Set(releases.filter((r) => r.prerelease).map((r) => r.tagName));
	// Releases come first, so a tag of the same version keeps the release URL.
	const candidates = [
		...releases.map((r) => ({
			tagName: r.tagName,
			releaseUrl: r.htmlUrl,
			zipballUrl: r.zipballUrl,
			tarballUrl: r.tarballUrl,
		})),
		...tags.map((t) => ({ tagName: t.name, releaseUrl: null, zipballUrl: t.zipballUrl, tarballUrl: t.tarballUrl })),
	];

	let latest: LatestTag | null = null;
	for (const candidate of candidates) {
		const version = normaliseVersion(candidate.tagName);
		if (!version) {
			continue;
		}
		const prerelease = semver.prerelease(version) !== null || flaggedPrereleases.has(candidate.tagName);
		if (prerelease && !followPrereleases) {
			continue;
		}
		if (!latest || semver.gt(version, latest.version)) {
			latest = { ...candidate, version };
		}
	}

	return latest;
}
