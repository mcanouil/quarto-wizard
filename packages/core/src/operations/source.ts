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
import { parseVersionSpec } from "../types/extension.js";
import { normaliseVersion, resolveLatestTag, type LatestTag } from "../github/latest.js";
import { fetchRawFile } from "../github/raw.js";
import { installedVersionFloor, readSubdirectoryVersion } from "./versions.js";
import { fetchDefaultBranch, fetchLatestCommit, type GitHubOptions } from "../github/releases.js";

/**
 * What an install writes for a GitHub extension.
 */
export interface InstallTarget {
	/** Source to download. */
	source: string;
	/** Source to write in the record, when it differs from `source`. */
	recordSource?: string;
	track: InstallTrack;
	/** Whether the ref of `source` is a tag that reads as a branch or a commit, such as `2`. */
	refIsTag?: boolean;
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
	const track = recordedTrack(extension.record);
	const commit = extension.record?.quartoWizard?.commit;

	if (track === "branch") {
		return commit ? { source: `${parsed.base}@${commit}`, recordSource: source, track } : { source, track };
	}
	if (commit && !parsed.hasRef) {
		return { source: `${parsed.base}@${commit}`, recordSource: parsed.base, track };
	}
	return { source, track, ...(refReadsAsTag(source) && { refIsTag: true }) };
}

/**
 * Whether the ref of a source is a version that the version parser would not take for a tag.
 */
function refReadsAsTag(source: string): boolean {
	const { ref } = splitSourceRef(source);
	return ref !== undefined && normaliseVersion(ref) !== null && parseVersionSpec(ref).type !== "tag";
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
			source: `${base}@${commit.toLowerCase()}`,
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
		source: `${base}@${latest.tagName}`,
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
