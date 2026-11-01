/**
 * @title Extension Update Module
 * @description Extension update operations.
 *
 * Handles checking for and applying updates to installed extensions.
 *
 * @module operations
 */

import * as semver from "semver";
import type { AuthConfig } from "../types/auth.js";
import type { ExtensionId } from "../types/extension.js";
import { formatExtensionId } from "../types/extension.js";
import {
	formatGitHubLocator,
	getEffectiveSourceType,
	splitSourceRef,
	tryParseGitHubLocator,
} from "../types/manifest.js";
import {
	discoverInstalledExtensions,
	findInstalledExtension,
	type InstalledExtension,
} from "../filesystem/discovery.js";
import type { Registry, RegistryEntry } from "../types/registry.js";
import { fetchRegistry, type RegistryOptions } from "../registry/fetcher.js";
import { lookupRegistryEntry } from "../registry/search.js";
import { compareCommits, fetchLatestCommit, type GitHubOptions } from "../github/releases.js";
import { fetchRawFile } from "../github/raw.js";
import { MANIFEST_FILENAMES, parseManifestContent } from "../filesystem/manifest.js";
import { normaliseVersion, resolveLatestTag, type LatestTag } from "../github/latest.js";
import { install, parseInstallSource } from "./install.js";
import {
	AuthenticationError,
	CancellationError,
	ExtensionError,
	ManifestError,
	NetworkError,
	RateLimitError,
	SamlSsoError,
	getErrorMessage,
	isCancellationError,
} from "../errors.js";

/**
 * Where an update check looked for the latest version.
 */
export type UpdateCheckSource = "github" | "registry";

/**
 * Information about an available update.
 */
export interface UpdateInfo {
	/** Extension with update available. */
	extension: InstalledExtension;
	/** Project directory the extension is installed in. */
	projectDir: string;
	/** Current installed version, or the installed commit for a commit comparison. */
	currentVersion: string;
	/** Latest available version, or the latest commit for a commit comparison. */
	latestVersion: string;
	/** Tag or seven-character commit to install. */
	latestRef: string;
	/** Whether `latestRef` is a tag or a commit. */
	refKind: "tag" | "commit";
	/** Where the latest version was found. */
	checkedOn: UpdateCheckSource;
	/** URL to the release, or to the repository when there is no release. */
	releaseUrl: string | null;
	/** Source to install, as `owner/repo@<latestRef>` or `owner/repo/<subdirectory>@<latestRef>`. */
	source: string;
}

/**
 * A repository that could not be checked.
 */
export interface RepositoryFailure {
	/** Repository as `owner/repo`, or the extension name when it matches several owners. */
	repository: string;
	/** Reason of the failure. */
	message: string;
}

/**
 * A failure that stops the update check as a whole.
 */
export interface UpdateCheckFailure {
	/** Kind of failure. */
	kind: "registry-unavailable" | "rate-limited" | "unauthorised" | "network";
	/** Reason of the failure. */
	message: string;
}

/**
 * Result of an update check.
 */
export interface UpdateCheckResult {
	/** Where the check as a whole looked for the latest versions. */
	checkedOn: UpdateCheckSource;
	/** Available updates, in the order of the project directories. */
	updates: UpdateInfo[];
	/** Repositories that could not be checked, one entry each. */
	repositoryFailures: RepositoryFailure[];
	/** Set when the check could not complete. */
	checkFailure?: UpdateCheckFailure;
}

/**
 * Options for checking updates.
 */
export interface UpdateCheckOptions extends RegistryOptions {
	/** Project directories to check. */
	projectDirs: string[];
	/** Specific extension to check (all if omitted). */
	extension?: ExtensionId;
	/**
	 * Where to look for the latest versions.
	 *
	 * `"auto"` (default) uses GitHub when `auth.githubToken` is set, else the
	 * registry, and GitHub for an extension that the registry does not list.
	 * `"github"` uses GitHub for every extension, with or without a token.
	 */
	source?: "auto" | "github";
}

/**
 * Options for applying updates.
 */
export interface UpdateOptions extends UpdateCheckOptions {
	/** Authentication configuration. */
	auth?: AuthConfig;
	/** Progress callback. */
	onProgress?: (info: { extension: string; phase: string; message: string }) => void;
}

/**
 * Result of update operation.
 */
export interface UpdateResult {
	/** Successfully updated extensions. */
	updated: {
		extension: InstalledExtension;
		previousVersion: string;
		newVersion: string;
	}[];
	/** Skipped extensions with reasons. */
	skipped: {
		extension: InstalledExtension;
		reason: string;
	}[];
	/** Failed updates with errors. */
	failed: {
		extension: InstalledExtension;
		error: string;
	}[];
}

/**
 * An installed extension whose source points to a GitHub repository.
 */
interface UpdateCandidate {
	extension: InstalledExtension;
	projectDir: string;
	/** Source without its ref, as recorded in the manifest. */
	base: string;
	owner: string;
	repo: string;
	/** Repository as `owner/repo`, or the extension name when it matches several owners. */
	fullName: string;
	/** Seven-character commit when the source is pinned to a commit. */
	currentCommit: string | null;
	/** Repository subdirectory the extension was installed from, absent for the repository root. */
	subdirectory?: string;
}

/**
 * GitHub lookups shared by every extension of one check, so that each
 * repository is resolved once.
 */
interface GitHubLookups {
	latestTag(candidate: UpdateCandidate): Promise<LatestTag | null>;
	latestCommit(candidate: UpdateCandidate): Promise<string | null>;
	/**
	 * Normalised version in the manifest of the candidate subdirectory at a ref,
	 * or null when there is none or when it cannot be read.
	 */
	subdirectoryVersion(candidate: UpdateCandidate, ref: string): Promise<string | null>;
	/** Whether the installed commit is behind or diverged from a later commit, or false when the comparison fails. */
	isBehind(candidate: UpdateCandidate, installedCommit: string, latestCommit: string): Promise<boolean>;
}

/**
 * Check for available updates.
 *
 * A source pinned to a commit compares commits; every other source compares
 * the installed version with the latest tag. An update never goes to a lower
 * version.
 *
 * A source with a repository subdirectory is always checked on GitHub. Its
 * installed version is compared with the version in the subdirectory manifest
 * at the latest tag, because the tags of a repository that holds several
 * extensions need not follow the version of any one of them.
 *
 * An aborted `signal` stops the requests and rejects with a
 * `CancellationError`.
 *
 * @param options - Check options
 * @returns Available updates and the failures met on the way
 */
export async function checkForUpdates(options: UpdateCheckOptions): Promise<UpdateCheckResult> {
	const { projectDirs, extension: targetExtension, source = "auto", ...registryOptions } = options;
	const useGitHub = source === "github" || Boolean(registryOptions.auth?.githubToken);
	const result: UpdateCheckResult = {
		checkedOn: useGitHub ? "github" : "registry",
		updates: [],
		repositoryFailures: [],
	};

	if (registryOptions.signal?.aborted) {
		throw new CancellationError();
	}
	const { candidates, failures } = await collectCandidates(projectDirs, targetExtension);
	result.repositoryFailures = [...failures.values()];
	if (candidates.length === 0) {
		return result;
	}

	let registry: Registry | null = null;
	let checked = candidates;
	// No registry entry matches a subdirectory source.
	if (!useGitHub && candidates.some((candidate) => !candidate.subdirectory)) {
		try {
			registry = await fetchRegistry(registryOptions);
		} catch (error) {
			if (isCancellationError(error)) {
				throw error;
			}
			result.checkFailure = { kind: "registry-unavailable", message: getErrorMessage(error) };
			// A subdirectory source is always checked on GitHub, so only the root sources are lost.
			checked = candidates.filter((candidate) => candidate.subdirectory);
			if (checked.length === 0) {
				return result;
			}
		}
	} else {
		result.checkedOn = "github";
	}

	const lookups = createGitHubLookups({
		auth: registryOptions.auth,
		timeout: registryOptions.timeout,
		signal: registryOptions.signal,
	});
	const repositoryFailures = new Map(failures);

	const updates = await Promise.all(
		checked.map(async (candidate) => {
			const entry = registry && !candidate.subdirectory ? lookupRegistryEntry(registry, candidate.base) : null;
			if (entry) {
				return buildRegistryUpdate(candidate, entry);
			}
			try {
				return await buildGitHubUpdate(candidate, lookups);
			} catch (error) {
				if (isCancellationError(error)) {
					throw error;
				}
				const message = getErrorMessage(error);
				const kind = checkFailureKind(error);
				if (kind) {
					// A rate limit or a rejected token can be fixed by signing in, so it hides an unavailable registry.
					const replaces =
						result.checkFailure?.kind === "registry-unavailable" &&
						(kind === "rate-limited" || kind === "unauthorised");
					if (!result.checkFailure || replaces) {
						result.checkFailure = { kind, message };
					}
				} else {
					const key = candidate.fullName.toLowerCase();
					if (!repositoryFailures.has(key)) {
						repositoryFailures.set(key, { repository: candidate.fullName, message });
					}
				}
				return null;
			}
		}),
	);

	result.updates = updates.filter((u): u is UpdateInfo => u !== null);
	result.repositoryFailures = [...repositoryFailures.values()];
	return result;
}

/**
 * Discover the installed extensions that can be checked, in the order of the
 * project directories.
 */
async function collectCandidates(
	projectDirs: string[],
	target?: ExtensionId,
): Promise<{ candidates: UpdateCandidate[]; failures: Map<string, RepositoryFailure> }> {
	const failures = new Map<string, RepositoryFailure>();
	const perDirectory = await Promise.all(
		projectDirs.map(async (projectDir) => {
			let extensions: InstalledExtension[];
			if (target) {
				try {
					const ext = await findInstalledExtension(projectDir, target);
					extensions = ext ? [ext] : [];
				} catch (error) {
					if (!(error instanceof ExtensionError)) {
						throw error;
					}
					const repository = formatExtensionId(target);
					failures.set(repository.toLowerCase(), { repository, message: error.message });
					extensions = [];
				}
			} else {
				extensions = await discoverInstalledExtensions(projectDir);
			}
			return extensions.map((ext) => toCandidate(ext, projectDir)).filter((c): c is UpdateCandidate => c !== null);
		}),
	);
	return { candidates: perDirectory.flat(), failures };
}

function toCandidate(extension: InstalledExtension, projectDir: string): UpdateCandidate | null {
	const source = extension.manifest.source;
	if (!source) {
		return null;
	}
	// url and local sources have no repository to resolve against.
	const sourceType = getEffectiveSourceType(extension.manifest);
	if (sourceType !== "github" && sourceType !== "registry") {
		return null;
	}

	const { base } = splitSourceRef(source);
	const locator = tryParseGitHubLocator(base);
	if (!locator) {
		return null;
	}

	return {
		extension,
		projectDir,
		base,
		...locator,
		fullName: `${locator.owner}/${locator.repo}`,
		currentCommit: extractCommitFromSource(source),
	};
}

/**
 * Paths where the manifest of a subdirectory source can be, in the order they are tried:
 * the subdirectory itself, then the folder of the installed extension under the
 * `_extensions` folder of the subdirectory, without and with its owner.
 */
function subdirectoryManifestPaths(candidate: UpdateCandidate): string[] {
	const { owner, name } = candidate.extension.id;
	const directories = [candidate.subdirectory, `${candidate.subdirectory}/_extensions/${name}`];
	if (owner) {
		directories.push(`${candidate.subdirectory}/_extensions/${owner}/${name}`);
	}
	return directories.flatMap((directory) => MANIFEST_FILENAMES.map((filename) => `${directory}/${filename}`));
}

function createGitHubLookups(options: GitHubOptions): GitHubLookups {
	const pending = new Map<string, Promise<unknown>>();

	function once<T>(key: string, run: () => Promise<T>): Promise<T> {
		let promise = pending.get(key) as Promise<T> | undefined;
		if (!promise) {
			promise = run();
			pending.set(key, promise);
		}
		return promise;
	}

	return {
		latestTag(candidate) {
			const currentVersion = candidate.extension.manifest.version;
			const normalised = normaliseVersion(currentVersion);
			const followsPrereleases = normalised !== null && semver.prerelease(normalised) !== null;
			const key = `${candidate.fullName.toLowerCase()}#tag#${followsPrereleases}`;
			return once(key, () => resolveLatestTag(candidate.owner, candidate.repo, { ...options, currentVersion }));
		},
		latestCommit(candidate) {
			const { subdirectory } = candidate;
			const key = `${candidate.fullName.toLowerCase()}#commit:${subdirectory ?? ""}`;
			return once(key, () => fetchLatestCommit(candidate.owner, candidate.repo, { ...options, path: subdirectory }));
		},
		subdirectoryVersion(candidate, ref) {
			const repository = candidate.fullName.toLowerCase();
			const extensionId = formatExtensionId(candidate.extension.id);
			return once(`${repository}@${ref}:${candidate.subdirectory}#${extensionId}`, async () => {
				// Raw file requests do not count against the API rate limit, so every path is asked at once.
				const filePaths = subdirectoryManifestPaths(candidate);
				// Two extensions of one subdirectory share the paths of the subdirectory itself, so each file is asked once.
				const reads = await Promise.allSettled(
					filePaths.map((filePath) =>
						once(`${repository}#raw@${ref}:${filePath}`, () =>
							fetchRawFile(candidate.owner, candidate.repo, ref, filePath, options),
						),
					),
				);
				for (const read of reads) {
					if (read.status === "rejected" && isCancellationError(read.reason)) {
						throw read.reason;
					}
				}
				try {
					// The paths are in priority order, so a read that fails before the first manifest
					// found leaves the version unknown and a manifest of lower priority never decides.
					for (const [index, read] of reads.entries()) {
						if (read.status === "rejected") {
							throw read.reason;
						}
						if (read.value !== null) {
							return manifestVersion(read.value, filePaths[index]);
						}
					}
					return null;
				} catch {
					// The caller falls back to the recorded ref, so a failed read only loses precision.
					return null;
				}
			});
		},
		isBehind(candidate, installedCommit, latestCommit) {
			const repository = candidate.fullName.toLowerCase();
			return once(`${repository}#compare#${latestCommit}...${installedCommit}`, async () => {
				try {
					const status = await compareCommits(candidate.owner, candidate.repo, latestCommit, installedCommit, options);
					return status === "behind" || status === "diverged";
				} catch (error) {
					// A failure that makes the whole check unreliable, such as a rate limit, is reported.
					// Any other failure, such as a commit that no longer exists, offers no update,
					// so the check never downgrades.
					if (isCancellationError(error) || checkFailureKind(error) !== null) {
						throw error;
					}
					return false;
				}
			});
		},
	};
}

/**
 * Normalised version of a manifest, or null when the manifest cannot be
 * parsed or has no version.
 */
function manifestVersion(content: string, sourcePath: string): string | null {
	try {
		return normaliseVersion(parseManifestContent(content, sourcePath).version);
	} catch (error) {
		if (error instanceof ManifestError) {
			return null;
		}
		throw error;
	}
}

/**
 * Classify an error as a failure of the whole check, or return null when it
 * only concerns one repository.
 */
function checkFailureKind(error: unknown): UpdateCheckFailure["kind"] | null {
	if (error instanceof SamlSsoError) {
		return null;
	}
	if (error instanceof RateLimitError) {
		return "rate-limited";
	}
	// handleGitHubError turns a 401 or a denied 403 into an AuthenticationError
	// and keeps the original NetworkError as its cause.
	const networkError =
		error instanceof NetworkError
			? error
			: error instanceof AuthenticationError && error.cause instanceof NetworkError
				? error.cause
				: null;
	const status = networkError?.statusCode;
	if (status === 429) {
		return "rate-limited";
	}
	// A rejected token fails every request, so the whole check is unreliable.
	if (status === 401) {
		return "unauthorised";
	}
	if (networkError && (status === undefined || status >= 500)) {
		return "network";
	}
	// fetch rejects with a TypeError when the connection itself fails.
	if (error instanceof TypeError) {
		return "network";
	}
	return null;
}

function buildRegistryUpdate(candidate: UpdateCandidate, entry: RegistryEntry): UpdateInfo | null {
	if (candidate.currentCommit) {
		return buildCommitUpdate(candidate, entry.latestCommit, entry.htmlUrl, "registry");
	}
	if (!entry.latestTag) {
		return null;
	}
	return buildTagUpdate(candidate, entry.latestTag, entry.latestReleaseUrl, "registry");
}

async function buildGitHubUpdate(candidate: UpdateCandidate, lookups: GitHubLookups): Promise<UpdateInfo | null> {
	const htmlUrl = `https://github.com/${candidate.fullName}`;
	if (candidate.currentCommit) {
		const latestCommit = await lookups.latestCommit(candidate);
		const update = buildCommitUpdate(candidate, latestCommit, htmlUrl, "github");
		// The latest commit of a path can be older than an installed commit of the
		// whole repository, so a different commit is only an update when it is newer.
		if (update && candidate.subdirectory && latestCommit) {
			return (await lookups.isBehind(candidate, candidate.currentCommit, latestCommit)) ? update : null;
		}
		return update;
	}
	const latest = await lookups.latestTag(candidate);
	if (candidate.subdirectory) {
		return buildSubdirectoryUpdate(candidate, latest, lookups, htmlUrl);
	}
	if (!latest) {
		return null;
	}
	return buildTagUpdate(candidate, latest.tagName, latest.releaseUrl ?? htmlUrl, "github");
}

/**
 * Compare a subdirectory source with the version in its manifest at the
 * latest tag, or at the default branch when the repository has no version
 * tag. When that manifest gives no version, the latest tag is compared with
 * the ref recorded in the source instead.
 */
async function buildSubdirectoryUpdate(
	candidate: UpdateCandidate,
	latest: LatestTag | null,
	lookups: GitHubLookups,
	htmlUrl: string,
): Promise<UpdateInfo | null> {
	const installedVersion = candidate.extension.manifest.version;
	const currentVersion = normaliseVersion(installedVersion);
	const latestVersion = await lookups.subdirectoryVersion(candidate, latest?.tagName ?? "HEAD");
	// Prereleases qualify only for a prerelease install, as in buildTagUpdate.
	const followsPrereleases = currentVersion !== null && semver.prerelease(currentVersion) !== null;
	if (latestVersion !== null && semver.prerelease(latestVersion) !== null && !followsPrereleases) {
		return null;
	}
	const comparable = currentVersion !== null && latestVersion !== null;
	if (comparable && !semver.gt(latestVersion, currentVersion)) {
		return null;
	}
	// An installed version that is not a version is compared on the floor it gives, as in buildTagUpdate.
	if (currentVersion === null && latestVersion !== null) {
		const floor = installedVersionFloor(candidate, installedVersion);
		if (floor && !semver.gt(latestVersion, floor)) {
			return null;
		}
	}

	if (!latest) {
		if (!comparable) {
			return null;
		}
		// The default branch is installed pinned to its latest commit, as a first install would.
		const latestCommit = await lookups.latestCommit(candidate);
		if (!latestCommit) {
			return null;
		}
		return makeUpdate(candidate, {
			currentVersion,
			latestVersion,
			latestRef: latestCommit.substring(0, 7).toLowerCase(),
			refKind: "commit",
			checkedOn: "github",
			releaseUrl: htmlUrl,
		});
	}

	if (!comparable && !isNewerThanRecordedRef(candidate, latest)) {
		return null;
	}
	return makeUpdate(candidate, {
		currentVersion: currentVersion ?? installedVersion,
		latestVersion: latestVersion ?? latest.version,
		latestRef: latest.tagName,
		refKind: "tag",
		checkedOn: "github",
		releaseUrl: latest.releaseUrl ?? htmlUrl,
	});
}

/** Whether the latest tag is newer than the ref recorded in the manifest source. */
function isNewerThanRecordedRef(candidate: UpdateCandidate, latest: LatestTag): boolean {
	const ref = recordedRef(candidate);
	const recordedVersion = ref === null ? null : normaliseVersion(ref.replace(/^V/, "v"));
	return recordedVersion ? semver.gt(latest.version, recordedVersion) : !isInstalledTag(candidate, latest.tagName);
}

function buildTagUpdate(
	candidate: UpdateCandidate,
	latestTag: string,
	releaseUrl: string | null,
	checkedOn: UpdateCheckSource,
): UpdateInfo | null {
	const installedVersion = candidate.extension.manifest.version;
	const currentVersion = normaliseVersion(installedVersion);
	const latestVersion = normaliseVersion(latestTag);
	if (!latestVersion) {
		return null;
	}
	// Prereleases qualify only for a prerelease install, as in resolveLatestTag.
	const followsPrereleases = currentVersion !== null && semver.prerelease(currentVersion) !== null;
	if (semver.prerelease(latestVersion) !== null && !followsPrereleases) {
		return null;
	}
	// An installed version that is not a version is compared on the floor it
	// gives, and an install that gives no floor is offered the latest stable tag.
	const floor = currentVersion ?? installedVersionFloor(candidate, installedVersion);
	const isUpdate = floor ? semver.gt(latestVersion, floor) : !isInstalledTag(candidate, latestTag);
	if (!isUpdate) {
		return null;
	}
	return makeUpdate(candidate, {
		currentVersion: currentVersion ?? installedVersion,
		latestVersion,
		latestRef: latestTag,
		refKind: "tag",
		checkedOn,
		releaseUrl,
	});
}

const EXTRA_NUMERIC_PARTS_PATTERN = /^v?(\d+\.\d+\.\d+)(?:\.\d+)+$/;

/**
 * Version that an update must exceed when the installed version is not a
 * version, or null when there is none.
 *
 * A version with more than three numeric parts, such as the development build
 * "1.0.0.9000", is ahead of its first three parts, so a tag equal to them is
 * not newer. Any other installed version gives the version of the tag recorded
 * in the manifest source, so that an update never goes below that tag.
 */
function installedVersionFloor(candidate: UpdateCandidate, installedVersion: string): string | null {
	const extended = EXTRA_NUMERIC_PARTS_PATTERN.exec(installedVersion.trim());
	if (extended) {
		return normaliseVersion(extended[1]);
	}
	const ref = recordedRef(candidate);
	return ref === null ? null : normaliseVersion(ref.replace(/^V/, "v"));
}

/**
 * Whether the ref recorded in the manifest source is the given tag, ignoring
 * case and one leading "v".
 */
function isInstalledTag(candidate: UpdateCandidate, tag: string): boolean {
	const ref = recordedRef(candidate);
	const comparable = (value: string) => value.toLowerCase().replace(/^v/, "");
	return ref !== null && comparable(ref) === comparable(tag);
}

/** Ref recorded in the manifest source, or null when the source has none. */
function recordedRef(candidate: UpdateCandidate): string | null {
	const source = candidate.extension.manifest.source ?? "";
	const { base, hasRef } = splitSourceRef(source);
	return hasRef ? source.slice(base.length + 1) : null;
}

function buildCommitUpdate(
	candidate: UpdateCandidate,
	latestCommit: string | null,
	releaseUrl: string,
	checkedOn: UpdateCheckSource,
): UpdateInfo | null {
	const currentCommit = candidate.currentCommit;
	if (!currentCommit || !latestCommit) {
		return null;
	}
	const latestRef = latestCommit.substring(0, 7).toLowerCase();
	if (latestRef === currentCommit) {
		return null;
	}
	return makeUpdate(candidate, {
		currentVersion: currentCommit,
		latestVersion: latestRef,
		latestRef,
		refKind: "commit",
		checkedOn,
		releaseUrl,
	});
}

/** Update of a candidate to `latestRef`, installed from the same repository and subdirectory. */
function makeUpdate(
	candidate: UpdateCandidate,
	details: Omit<UpdateInfo, "extension" | "projectDir" | "source">,
): UpdateInfo {
	return {
		extension: candidate.extension,
		projectDir: candidate.projectDir,
		...details,
		source: `${formatGitHubLocator(candidate)}@${details.latestRef}`,
	};
}

/**
 * Apply updates to extensions.
 *
 * An aborted `signal` stops the running install. That update and every
 * update after it go to `skipped`, and the result keeps the updates that
 * were already installed.
 *
 * @param updates - Updates to apply
 * @param options - Update options
 * @returns Update result
 */
export async function applyUpdates(updates: UpdateInfo[], options: UpdateOptions): Promise<UpdateResult> {
	const { auth, onProgress, signal } = options;

	const result: UpdateResult = {
		updated: [],
		skipped: [],
		failed: [],
	};

	for (const [index, update] of updates.entries()) {
		const extName = formatExtensionId(update.extension.id);

		try {
			onProgress?.({
				extension: extName,
				phase: "updating",
				message: `Updating to ${update.latestVersion}...`,
			});

			const source = parseInstallSource(update.source);

			const installResult = await install(source, {
				projectDir: update.projectDir,
				auth,
				force: true,
				sourceType: update.extension.manifest.sourceType,
				signal,
				expectedExtensionId: update.extension.id,
				onProgress: (p) => {
					onProgress?.({
						extension: extName,
						phase: p.phase,
						message: p.message,
					});
				},
			});

			result.updated.push({
				extension: installResult.extension,
				previousVersion: update.currentVersion,
				newVersion: update.latestVersion,
			});
		} catch (error) {
			if (isCancellationError(error)) {
				result.skipped.push(...updates.slice(index).map((u) => ({ extension: u.extension, reason: error.message })));
				break;
			}
			result.failed.push({
				extension: update.extension,
				error: getErrorMessage(error),
			});
		}
	}

	return result;
}

/**
 * Check and apply updates in one operation.
 *
 * @param options - Update options
 * @returns Update result
 * @throws ExtensionError when the check could not complete
 */
export async function update(options: UpdateOptions): Promise<UpdateResult> {
	const { updates, checkFailure } = await checkForUpdates(options);

	if (checkFailure) {
		throw new ExtensionError(`Update check failed: ${checkFailure.message}`);
	}

	if (updates.length === 0) {
		return { updated: [], skipped: [], failed: [] };
	}

	return applyUpdates(updates, options);
}

/**
 * Check if a source string represents a commit-based installation.
 *
 * @param source - Source as recorded in the manifest
 * @returns The seven-character commit in lower case, or null when the source is not pinned to a commit
 */
export function extractCommitFromSource(source: string): string | null {
	const atIndex = source.lastIndexOf("@");
	if (atIndex <= 0) return null;

	const ref = source.substring(atIndex + 1);
	if (/^[a-f0-9]{7,40}$/i.test(ref)) {
		return ref.substring(0, 7).toLowerCase();
	}
	return null;
}
