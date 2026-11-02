/**
 * @title Install Source Module
 * @description Targets of Reinstall and Change Update Source.
 *
 * Computes what a reinstall and a change of update source install, and what
 * they write in the install record. The VS Code layer installs the result.
 *
 * @module operations
 */

import * as semver from "semver";
import type { InstalledExtension } from "../filesystem/discovery.js";
import {
	formatGitHubLocator,
	getEffectiveSourceType,
	recordedTrack,
	shortCommit,
	splitSourceRef,
	tryParseGitHubLocator,
	type GitHubLocator,
	type InstallTrack,
} from "../types/manifest.js";
import { ExtensionError } from "../errors.js";
import { parseVersionSpec, type VersionSpec } from "../types/extension.js";
import type { InstallSource } from "./install.js";
import { normaliseVersion, resolveLatestTag, type LatestTag } from "../github/latest.js";
import { fetchRawFile } from "../github/raw.js";
import { installedVersionFloor, readSubdirectoryVersion } from "./versions.js";
import { fetchDefaultBranch, fetchLatestCommit, type GitHubOptions } from "../github/releases.js";

/**
 * What an install of a GitHub extension downloads and what it records.
 */
export interface InstallTarget {
	/**
	 * Source to download. Its version says whether the ref is a tag, a commit or a
	 * branch, so a tag such as `2` installs as a tag.
	 */
	source: InstallSource;
	/** Source to write in the record, in place of the typed form of `source`. */
	recordSource?: string;
	/** What updates of the install follow. */
	track: InstallTrack;
}

/**
 * GitHub install source of a repository, or of one of its subdirectories, at a version.
 */
export function githubInstallSource(locator: GitHubLocator, version: VersionSpec): InstallSource {
	const { owner, repo, subdirectory } = locator;
	return { type: "github", owner, repo, ...(subdirectory && { subdirectory }), version };
}

/**
 * Target of a change of update source.
 */
export interface SourceChange extends InstallTarget {
	/** Display of the target: the tag, or "<branch> @ <7-char commit>". */
	targetLabel: string;
	/** Installed manifest version, as shown in "(now ...)". */
	currentVersion: string | null;
	/** Whether the target tag is below the installed version. */
	isDowngrade: boolean;
}

interface GitHubSource {
	locator: GitHubLocator;
	base: string;
	hasRef: boolean;
}

function parseGitHubSource(extension: InstalledExtension): GitHubSource | null {
	const source = extension.manifest.source;
	if (!source) {
		return null;
	}
	// url and local sources have no repository to install from.
	const sourceType = getEffectiveSourceType(extension.manifest);
	if (sourceType !== "github" && sourceType !== "registry") {
		return null;
	}
	const { base, hasRef } = splitSourceRef(source);
	const locator = tryParseGitHubLocator(base);
	return locator ? { locator, base, hasRef } : null;
}

/**
 * Compute the target of a reinstall, which keeps the update mode and the files.
 *
 * In tag mode it installs the recorded ref, or the recorded commit of an
 * install that had no version tag, or the latest tag when the record names
 * neither. In branch mode it installs the recorded commit.
 *
 * @param extension - Installed extension
 * @returns Target to install, or null when the source is not on GitHub
 */
export function reinstallTarget(extension: InstalledExtension): InstallTarget | null {
	const parsed = parseGitHubSource(extension);
	if (!parsed) {
		return null;
	}
	const source = extension.manifest.source as string;
	const { locator } = parsed;
	const track = recordedTrack(extension.record);
	const commit = extension.record?.quartoWizard?.commit;
	const atCommit = (commitRef: string) => githubInstallSource(locator, { type: "commit", commit: commitRef });

	if (track === "branch") {
		return commit
			? { source: atCommit(commit), recordSource: source, track }
			: { source: githubInstallSource(locator, recordedVersion(source, false)), track };
	}
	if (commit && !parsed.hasRef) {
		return { source: atCommit(commit), recordSource: parsed.base, track };
	}
	return { source: githubInstallSource(locator, recordedVersion(source, true)), track };
}

/**
 * Version that the ref of a recorded source names. In tag mode, a ref that is
 * a version, such as `2` or `20240101`, is a tag even when it reads as a branch
 * or a commit.
 */
function recordedVersion(source: string, inTagMode: boolean): VersionSpec {
	const { ref } = splitSourceRef(source);
	if (ref === undefined) {
		return { type: "latest" };
	}
	const version = parseVersionSpec(ref);
	const readsAsTag = inTagMode && (version.type === "branch" || version.type === "commit");
	return readsAsTag && normaliseVersion(ref) !== null ? { type: "tag", tag: ref } : version;
}

/**
 * Compute the target of a change of update source.
 *
 * Tag to branch targets the head of the default branch. Branch to tag targets
 * the latest version tag, which can be below the installed version, and drops
 * an explicit branch. A repository without a version tag targets the head of
 * the default branch in tag mode, as a first install in tag mode would.
 *
 * @param extension - Installed extension
 * @param options - GitHub options
 * @returns Target to install, or null when the source is not on GitHub
 * @throws ExtensionError when the default branch has no commit to install
 */
export async function planSourceChange(
	extension: InstalledExtension,
	options: GitHubOptions,
): Promise<SourceChange | null> {
	const parsed = parseGitHubSource(extension);
	if (!parsed) {
		return null;
	}
	const { locator, base } = parsed;
	const installed = extension.manifest.version;
	const currentVersion = installed ? installed : null;

	const headTarget = async (track: InstallTrack): Promise<SourceChange> => {
		const [commit, branch] = await Promise.all([
			fetchLatestCommit(locator.owner, locator.repo, { ...options, path: locator.subdirectory }),
			fetchDefaultBranch(locator.owner, locator.repo, options),
		]);
		if (!commit) {
			throw new ExtensionError(
				`Cannot find a commit on the default branch of "${formatGitHubLocator(locator)}". Check that the repository has commits and try again.`,
			);
		}
		return {
			source: githubInstallSource(locator, { type: "commit", commit: commit.toLowerCase() }),
			recordSource: base,
			track,
			targetLabel: `${branch ?? "default branch"} @ ${shortCommit(commit)}`,
			currentVersion,
			isDowngrade: false,
		};
	};

	if (recordedTrack(extension.record) === "tag") {
		return headTarget("branch");
	}

	const latest = await resolveLatestTag(locator.owner, locator.repo, { ...options, currentVersion: installed });
	if (!latest) {
		return headTarget("tag");
	}
	return {
		source: githubInstallSource(locator, { type: "tag", tag: latest.tagName }),
		track: "tag",
		targetLabel: latest.tagName,
		currentVersion,
		isDowngrade: await isBelowInstalled(extension, parsed, latest, options),
	};
}

/**
 * Whether the target tag holds a version below the installed one.
 *
 * A subdirectory source compares the version in its manifest at the tag,
 * because the version of the tag belongs to the whole repository. A version
 * that cannot be read is not a downgrade.
 */
async function isBelowInstalled(
	extension: InstalledExtension,
	{ locator }: GitHubSource,
	tag: LatestTag,
	options: GitHubOptions,
): Promise<boolean> {
	const installed = extension.manifest.version;
	const targetVersion = locator.subdirectory
		? await readSubdirectoryVersion(locator.subdirectory, extension.id, (filePath) =>
				fetchRawFile(locator.owner, locator.repo, tag.tagName, filePath, options),
			)
		: tag.version;
	if (targetVersion === null) {
		return false;
	}
	const installedVersion = normaliseVersion(installed);
	if (installedVersion !== null) {
		return semver.lt(targetVersion, installedVersion);
	}
	// A development build such as "1.0.0.9000" is ahead of the tag equal to its first parts.
	const floor = installedVersionFloor(installed, null);
	return floor !== null && semver.lte(targetVersion, floor);
}
