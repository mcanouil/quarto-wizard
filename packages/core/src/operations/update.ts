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
import { getEffectiveSourceType, splitSourceRef } from "../types/manifest.js";
import {
	discoverInstalledExtensions,
	findInstalledExtension,
	type InstalledExtension,
} from "../filesystem/discovery.js";
import type { Registry, RegistryEntry } from "../types/registry.js";
import { fetchRegistry, type RegistryOptions } from "../registry/fetcher.js";
import { lookupRegistryEntry } from "../registry/search.js";
import { fetchLatestCommit, type GitHubOptions } from "../github/releases.js";
import { normaliseVersion, resolveLatestTag, type LatestTag } from "../github/latest.js";
import { install, parseInstallSource } from "./install.js";
import {
	AuthenticationError,
	ExtensionError,
	NetworkError,
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
	/** Source to install, as `owner/repo@<latestRef>`. */
	source: string;
}

/**
 * A repository that could not be checked.
 */
export interface RepositoryFailure {
	/** Repository as `owner/repo`. */
	repository: string;
	/** Reason of the failure. */
	message: string;
}

/**
 * A failure that stops the update check as a whole.
 */
export interface UpdateCheckFailure {
	/** Kind of failure. */
	kind: "registry-unavailable" | "rate-limited" | "network";
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
	/** Repository as `owner/repo`. */
	fullName: string;
	/** Seven-character commit when the source is pinned to a commit. */
	currentCommit: string | null;
}

/**
 * GitHub lookups shared by every extension of one check, so that each
 * repository is resolved once.
 */
interface GitHubLookups {
	latestTag(candidate: UpdateCandidate): Promise<LatestTag | null>;
	latestCommit(candidate: UpdateCandidate): Promise<string | null>;
}

/**
 * Check for available updates.
 *
 * A source pinned to a commit compares commits; every other source compares
 * the installed version with the latest tag. An update never goes to a lower
 * version.
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

	const candidates = await collectCandidates(projectDirs, targetExtension);
	if (candidates.length === 0) {
		return result;
	}

	let registry: Registry | null = null;
	if (!useGitHub) {
		try {
			registry = await fetchRegistry(registryOptions);
		} catch (error) {
			if (isCancellationError(error)) {
				throw error;
			}
			result.checkFailure = { kind: "registry-unavailable", message: getErrorMessage(error) };
			return result;
		}
	}

	const lookups = createGitHubLookups({ auth: registryOptions.auth, timeout: registryOptions.timeout });
	const repositoryFailures = new Map<string, RepositoryFailure>();

	const updates = await Promise.all(
		candidates.map(async (candidate) => {
			const entry = registry ? lookupRegistryEntry(registry, candidate.base) : null;
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
					result.checkFailure ??= { kind, message };
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
async function collectCandidates(projectDirs: string[], target?: ExtensionId): Promise<UpdateCandidate[]> {
	const perDirectory = await Promise.all(
		projectDirs.map(async (projectDir) => {
			let extensions: InstalledExtension[];
			if (target) {
				const ext = await findInstalledExtension(projectDir, target);
				extensions = ext ? [ext] : [];
			} else {
				extensions = await discoverInstalledExtensions(projectDir);
			}
			return extensions.map((ext) => toCandidate(ext, projectDir)).filter((c): c is UpdateCandidate => c !== null);
		}),
	);
	return perDirectory.flat();
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
	const [owner, repo] = base.split("/");
	if (!owner || !repo) {
		return null;
	}

	return {
		extension,
		projectDir,
		base,
		owner,
		repo,
		fullName: `${owner}/${repo}`,
		currentCommit: extractCommitFromSource(source),
	};
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
			const key = `${candidate.fullName.toLowerCase()}#commit`;
			return once(key, () => fetchLatestCommit(candidate.owner, candidate.repo, options));
		},
	};
}

/**
 * Classify an error as a failure of the whole check, or return null when it
 * only concerns one repository.
 */
function checkFailureKind(error: unknown): UpdateCheckFailure["kind"] | null {
	if (error instanceof SamlSsoError) {
		return null;
	}
	// handleGitHubError turns a 401 or 403 into an AuthenticationError and keeps
	// the original NetworkError as its cause.
	const networkError =
		error instanceof NetworkError
			? error
			: error instanceof AuthenticationError && error.cause instanceof NetworkError
				? error.cause
				: null;
	const status = networkError?.statusCode;
	if (status === 403 || status === 429) {
		return "rate-limited";
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
		return buildCommitUpdate(candidate, latestCommit, htmlUrl, "github");
	}
	const latest = await lookups.latestTag(candidate);
	if (!latest) {
		return null;
	}
	return buildTagUpdate(candidate, latest.tagName, latest.releaseUrl ?? htmlUrl, "github");
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
	// An installed version that is not a version cannot be compared, so the
	// latest stable tag is offered and the never-downgrade guard does not apply.
	const isUpdate = currentVersion ? semver.gt(latestVersion, currentVersion) : !isInstalledTag(candidate, latestTag);
	if (!isUpdate) {
		return null;
	}
	return {
		extension: candidate.extension,
		projectDir: candidate.projectDir,
		currentVersion: currentVersion ?? installedVersion,
		latestVersion,
		latestRef: latestTag,
		refKind: "tag",
		checkedOn,
		releaseUrl,
		source: `${candidate.fullName}@${latestTag}`,
	};
}

/**
 * Whether the ref recorded in the manifest source is the given tag, ignoring
 * case and one leading "v".
 */
function isInstalledTag(candidate: UpdateCandidate, tag: string): boolean {
	const source = candidate.extension.manifest.source ?? "";
	if (!splitSourceRef(source).hasRef) {
		return false;
	}
	const comparable = (ref: string) => ref.toLowerCase().replace(/^v/, "");
	return comparable(source.substring(source.lastIndexOf("@") + 1)) === comparable(tag);
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
	return {
		extension: candidate.extension,
		projectDir: candidate.projectDir,
		currentVersion: currentCommit,
		latestVersion: latestRef,
		latestRef,
		refKind: "commit",
		checkedOn,
		releaseUrl,
		source: `${candidate.fullName}@${latestRef}`,
	};
}

/**
 * Apply updates to extensions.
 *
 * @param updates - Updates to apply
 * @param options - Update options
 * @returns Update result
 */
export async function applyUpdates(updates: UpdateInfo[], options: UpdateOptions): Promise<UpdateResult> {
	const { auth, onProgress } = options;

	const result: UpdateResult = {
		updated: [],
		skipped: [],
		failed: [],
	};

	for (const update of updates) {
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
 * Returns the short commit hash if it is, null otherwise.
 */
function extractCommitFromSource(source: string): string | null {
	const atIndex = source.lastIndexOf("@");
	if (atIndex <= 0) return null;

	const ref = source.substring(atIndex + 1);
	// Match 7-character hex string (short commit hash)
	if (/^[a-f0-9]{7}$/i.test(ref)) {
		return ref.toLowerCase();
	}
	return null;
}
