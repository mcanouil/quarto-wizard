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
import type { ExtensionId, VersionSpec } from "../types/extension.js";
import { formatExtensionId } from "../types/extension.js";
import {
	formatGitHubLocator,
	getEffectiveSourceType,
	normaliseCommit,
	recordedCommit,
	recordedTrack,
	shortCommit,
	splitSourceRef,
	tryParseGitHubLocator,
	type InstallTrack,
} from "../types/manifest.js";
import {
	discoverInstalledExtensions,
	findInstalledExtension,
	type InstalledExtension,
} from "../filesystem/discovery.js";
import type { LocalEdit } from "../filesystem/sourceRecord.js";
import type { Registry, RegistryEntry } from "../types/registry.js";
import { fetchRegistry, type RegistryOptions } from "../registry/fetcher.js";
import { lookupRegistryEntry } from "../registry/search.js";
import { isEmbeddedInInstalledParent } from "../filesystem/projects.js";
import { compareCommits, fetchDefaultBranchHead, fetchLatestCommit, type GitHubOptions } from "../github/releases.js";
import { fetchRawFile } from "../github/raw.js";
import { normaliseVersion, resolveLatestTag, type LatestTag } from "../github/latest.js";
import { install } from "./install.js";
import { githubInstallSource, type InstallTarget } from "./source.js";
import { installedVersionFloor, readSubdirectoryVersion } from "./versions.js";
import {
	AuthenticationError,
	CancellationError,
	ExtensionError,
	LocalEditsError,
	NetworkError,
	RateLimitError,
	RepositoryNotFoundError,
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
	/** Tag or seven-character commit to show for the update. */
	latestRef: string;
	/** Whether `latestRef` is a tag or a commit. */
	refKind: "tag" | "commit";
	/** Where the latest version was found. */
	checkedOn: UpdateCheckSource;
	/** URL to the release, or to the repository when there is no release. */
	releaseUrl: string | null;
	/**
	 * What the update installs and records. Its source names the tag, or the full commit so that
	 * the install downloads exactly the commit the check saw. It keeps the update mode of the
	 * installed extension, and a commit update sets `recordSource`: the recorded source in branch
	 * mode, and the source without a ref in tag mode.
	 */
	target: InstallTarget;
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
	/**
	 * Skipped extensions with reasons.
	 * An extension with local changes has the reason `local-edits` and lists its edits.
	 */
	skipped: {
		extension: InstalledExtension;
		reason: string;
		edits?: LocalEdit[];
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
	/** Seven-character installed commit, from the record or from a commit ref of the source. */
	currentCommit: string | null;
	/** Repository subdirectory the extension was installed from, absent for the repository root. */
	subdirectory?: string;
	/** Update mode of the install record. */
	track: InstallTrack;
	/** Branch that a branch-mode source names, absent for the default branch and in tag mode. */
	branch?: string;
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
 * The update mode of the install record picks the comparison. Branch mode
 * compares the installed commit with the head of the tracked branch, the
 * default branch unless the source names one. Tag mode compares the installed
 * version with the latest tag, and an update never goes to a lower version.
 * While the repository has no version tag, tag mode compares commits on the
 * default branch, when the install recorded a commit.
 *
 * A source with a repository subdirectory is always checked on GitHub. Its
 * installed version is compared with the version in the subdirectory manifest
 * at the latest tag, because the tags of a repository that holds several
 * extensions need not follow the version of any one of them.
 *
 * An extension embedded in an installed parent is not checked, because it
 * changes only when its parent is updated.
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
	if (!useGitHub && candidates.some(checksInRegistry)) {
		try {
			registry = await fetchRegistry(registryOptions);
		} catch (error) {
			if (isCancellationError(error)) {
				throw error;
			}
			result.checkFailure = { kind: "registry-unavailable", message: getErrorMessage(error) };
			// The sources that are always checked on GitHub can still be checked.
			checked = candidates.filter((candidate) => !checksInRegistry(candidate));
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
			const entry = registry && checksInRegistry(candidate) ? lookupRegistryEntry(registry, candidate.base) : null;
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
	const installedParents = new Map<string, boolean>();
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
			// An embedded extension of an installed parent changes only when its parent is updated.
			return extensions
				.filter((ext) => !isEmbeddedInInstalledParent(ext.directory, installedParents))
				.map((ext) => toCandidate(ext, projectDir))
				.filter((c): c is UpdateCandidate => c !== null);
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

	const { base, ref } = splitSourceRef(source);
	const locator = tryParseGitHubLocator(base);
	if (!locator) {
		return null;
	}

	const track = recordedTrack(extension.record);
	const quartoWizard = extension.record?.quartoWizard;
	// A branch ref is never a commit, even when its name looks like one.
	const branchCommit = quartoWizard?.commit ? shortCommit(quartoWizard.commit) : null;
	return {
		extension,
		projectDir,
		base,
		...locator,
		fullName: `${locator.owner}/${locator.repo}`,
		currentCommit: track === "branch" ? branchCommit : recordedCommit({ source, quartoWizard }),
		track,
		...(track === "branch" && ref !== undefined && { branch: ref }),
	};
}

/**
 * Whether the registry can check a candidate. The registry holds the latest
 * commit of the default branch of the whole repository only, and no entry
 * matches a subdirectory source.
 */
function checksInRegistry(candidate: UpdateCandidate): boolean {
	return !candidate.subdirectory && candidate.branch === undefined;
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
			const key = `${candidate.fullName.toLowerCase()}#tag#${followsPrereleases(candidate)}`;
			return once(key, () => resolveLatestTag(candidate.owner, candidate.repo, { ...options, currentVersion }));
		},
		latestCommit(candidate) {
			const { subdirectory, branch } = candidate;
			// The head of the default branch comes from its archive redirect, without the GitHub API.
			if (branch === undefined && !subdirectory) {
				return once(`${candidate.fullName.toLowerCase()}#head`, () =>
					fetchDefaultBranchHead(candidate.owner, candidate.repo, options),
				);
			}
			const key = `${candidate.fullName.toLowerCase()}#commit@${branch ?? ""}:${subdirectory ?? ""}`;
			return once(key, () =>
				fetchLatestCommit(candidate.owner, candidate.repo, { ...options, path: subdirectory, ref: branch }),
			);
		},
		subdirectoryVersion(candidate, ref) {
			const repository = candidate.fullName.toLowerCase();
			const extensionId = formatExtensionId(candidate.extension.id);
			return once(`${repository}@${ref}:${candidate.subdirectory}#${extensionId}`, async () => {
				// Two extensions of one subdirectory share the paths of the subdirectory itself, so each file is asked once.
				return readSubdirectoryVersion(candidate.subdirectory as string, candidate.extension.id, (filePath) =>
					once(`${repository}#raw@${ref}:${filePath}`, () =>
						fetchRawFile(candidate.owner, candidate.repo, ref, filePath, options),
					),
				);
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
	if (candidate.track === "branch") {
		return buildCommitUpdate(candidate, entry.latestCommit, entry.htmlUrl, "registry");
	}
	if (entry.latestTag && isUsableTag(candidate, entry.latestTag)) {
		return buildTagUpdate(candidate, entry.latestTag, entry.latestReleaseUrl, "registry");
	}
	return buildDefaultBranchUpdate(candidate, entry.latestCommit, entry.htmlUrl, "registry");
}

async function buildGitHubUpdate(candidate: UpdateCandidate, lookups: GitHubLookups): Promise<UpdateInfo | null> {
	const htmlUrl = `https://github.com/${candidate.fullName}`;
	if (candidate.track === "branch") {
		return buildBranchUpdate(candidate, lookups, htmlUrl);
	}
	const latest = await lookups.latestTag(candidate);
	if (candidate.subdirectory) {
		return buildSubdirectoryUpdate(candidate, latest, lookups, htmlUrl);
	}
	if (latest) {
		return buildTagUpdate(candidate, latest.tagName, latest.releaseUrl ?? htmlUrl, "github");
	}
	const latestCommit = candidate.currentCommit ? await lookups.latestCommit(candidate) : null;
	return buildDefaultBranchUpdate(candidate, latestCommit, htmlUrl, "github");
}

/**
 * Update of a tag-mode install whose repository has no usable version tag.
 * It follows the default branch, as a first install does, when the install
 * recorded a commit.
 */
function buildDefaultBranchUpdate(
	candidate: UpdateCandidate,
	latestCommit: string | null,
	releaseUrl: string,
	checkedOn: UpdateCheckSource,
): UpdateInfo | null {
	return candidate.currentCommit ? buildCommitUpdate(candidate, latestCommit, releaseUrl, checkedOn) : null;
}

/**
 * Compare the installed commit with the head of the tracked branch on GitHub.
 */
async function buildBranchUpdate(
	candidate: UpdateCandidate,
	lookups: GitHubLookups,
	htmlUrl: string,
): Promise<UpdateInfo | null> {
	const latestCommit = await lookups.latestCommit(candidate).catch((error: unknown) => {
		// The head lookup of a named branch fails with the repository error when the branch is gone.
		if (candidate.branch !== undefined && error instanceof RepositoryNotFoundError) {
			throw new ExtensionError(`Branch "${candidate.branch}" or its repository not found: ${candidate.fullName}`);
		}
		throw error;
	});
	const update = buildCommitUpdate(candidate, latestCommit, htmlUrl, "github");
	// The latest commit of a path can be older than an installed commit of the
	// whole repository, so a different commit is only an update when it is newer.
	if (update && candidate.subdirectory && candidate.currentCommit && latestCommit) {
		return (await lookups.isBehind(candidate, candidate.currentCommit, latestCommit)) ? update : null;
	}
	return update;
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
	if (latestVersion !== null && semver.prerelease(latestVersion) !== null && !followsPrereleases(candidate)) {
		return null;
	}
	const comparable = currentVersion !== null && latestVersion !== null;
	if (comparable && !semver.gt(latestVersion, currentVersion)) {
		return null;
	}
	// An installed version that is not a version is compared on the floor it gives, as in buildTagUpdate.
	if (currentVersion === null && latestVersion !== null) {
		const floor = installedVersionFloor(installedVersion, recordedRef(candidate));
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
		return makeUpdate(
			candidate,
			{ type: "commit", commit: normaliseCommit(latestCommit) },
			{ currentVersion, latestVersion, checkedOn: "github", releaseUrl: htmlUrl },
		);
	}

	if (!comparable && !isNewerThanRecordedRef(candidate, latest)) {
		return null;
	}
	return makeUpdate(
		candidate,
		{ type: "tag", tag: latest.tagName },
		{
			currentVersion: currentVersion ?? installedVersion,
			latestVersion: latestVersion ?? latest.version,
			checkedOn: "github",
			releaseUrl: latest.releaseUrl ?? htmlUrl,
		},
	);
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
	if (semver.prerelease(latestVersion) !== null && !followsPrereleases(candidate)) {
		return null;
	}
	// An installed version that is not a version is compared on the floor it
	// gives, and an install that gives no floor is offered the latest stable tag.
	const floor = currentVersion ?? installedVersionFloor(installedVersion, recordedRef(candidate));
	const isUpdate = floor ? semver.gt(latestVersion, floor) : !isInstalledTag(candidate, latestTag);
	if (!isUpdate) {
		return null;
	}
	return makeUpdate(
		candidate,
		{ type: "tag", tag: latestTag },
		{ currentVersion: currentVersion ?? installedVersion, latestVersion, checkedOn, releaseUrl },
	);
}

/**
 * Whether a tag is a version tag that the install can follow, as in
 * resolveLatestTag: a prerelease qualifies only for a prerelease install.
 */
function isUsableTag(candidate: UpdateCandidate, tag: string): boolean {
	const version = normaliseVersion(tag);
	return version !== null && (semver.prerelease(version) === null || followsPrereleases(candidate));
}

/** Whether the installed version is a prerelease, so that the install follows prereleases too. */
function followsPrereleases(candidate: UpdateCandidate): boolean {
	const installed = normaliseVersion(candidate.extension.manifest.version);
	return installed !== null && semver.prerelease(installed) !== null;
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
	return splitSourceRef(candidate.extension.manifest.source ?? "").ref ?? null;
}

/**
 * Compare the installed commit with the latest commit. A branch install whose
 * commit lookup failed recorded no commit, so it is offered the latest commit.
 */
function buildCommitUpdate(
	candidate: UpdateCandidate,
	latestCommit: string | null,
	releaseUrl: string,
	checkedOn: UpdateCheckSource,
): UpdateInfo | null {
	if (!latestCommit) {
		return null;
	}
	const { currentCommit } = candidate;
	const latestRef = shortCommit(latestCommit);
	if (latestRef === currentCommit) {
		return null;
	}
	return makeUpdate(
		candidate,
		{ type: "commit", commit: normaliseCommit(latestCommit) },
		{
			currentVersion: currentCommit ?? candidate.extension.manifest.version,
			latestVersion: latestRef,
			checkedOn,
			releaseUrl,
		},
	);
}

/** Tag or full commit that an update installs. */
type UpdateRef = Extract<VersionSpec, { type: "tag" } | { type: "commit" }>;

/**
 * Update of a candidate to a tag or a full commit, installed from the same
 * repository and subdirectory and with the same update mode.
 */
function makeUpdate(
	candidate: UpdateCandidate,
	ref: UpdateRef,
	details: Pick<UpdateInfo, "currentVersion" | "latestVersion" | "checkedOn" | "releaseUrl">,
): UpdateInfo {
	const isCommit = ref.type === "commit";
	// A commit update keeps the source it follows in the record, so the next check follows it too.
	let recordSource: string | undefined;
	if (isCommit) {
		recordSource = candidate.track === "branch" ? candidate.extension.manifest.source : formatGitHubLocator(candidate);
	}
	return {
		extension: candidate.extension,
		projectDir: candidate.projectDir,
		...details,
		latestRef: isCommit ? shortCommit(ref.commit) : ref.tag,
		refKind: isCommit ? "commit" : "tag",
		target: {
			source: githubInstallSource(candidate, ref),
			track: candidate.track,
			...(recordSource !== undefined && { recordSource }),
		},
	};
}

/**
 * Apply updates to extensions.
 *
 * An update never replaces an extension with local changes: that extension goes
 * to `skipped` with the reason `local-edits`, and the other updates continue.
 * An update replaces a copy at the same version too, because a new tag or
 * commit can keep the manifest version.
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

			const { source, ...record } = update.target;
			const installResult = await install(source, {
				...record,
				projectDir: update.projectDir,
				auth,
				sourceType: update.extension.manifest.sourceType,
				replaceSameVersion: true,
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
			if (error instanceof LocalEditsError) {
				result.skipped.push({ extension: update.extension, reason: "local-edits", edits: error.edits });
				continue;
			}
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
