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
import type { Registry } from "../types/registry.js";
import { fetchRegistry, type RegistryOptions } from "../registry/fetcher.js";
import { lookupRegistryEntry } from "../registry/search.js";
import { fetchReleases, fetchTags } from "../github/releases.js";
import { install, parseInstallSource } from "./install.js";
import { getErrorMessage } from "../errors.js";

/**
 * Information about an available update.
 */
export interface UpdateInfo {
	/** Extension with update available. */
	extension: InstalledExtension;
	/** Current installed version. */
	currentVersion: string;
	/** Latest available version. */
	latestVersion: string;
	/** URL to the release. */
	releaseUrl: string | null;
	/** Source reference for updating. */
	source: string;
}

/**
 * Options for checking updates.
 */
export interface UpdateCheckOptions extends RegistryOptions {
	/** Project directory. */
	projectDir: string;
	/** Specific extension to check (all if omitted). */
	extension?: ExtensionId;
	/**
	 * Allow registry lookup to resolve updates for GitHub-sourced extensions.
	 *
	 * When false (default), extensions with `sourceType: "github"` are resolved
	 * against GitHub releases/tags directly, respecting how they were installed.
	 * When true, if the GitHub lookup yields no tag, fall back to the registry
	 * (legacy behaviour).
	 */
	crossSource?: boolean;
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
 * Check for available updates.
 *
 * @param options - Check options
 * @returns Array of available updates
 */
export async function checkForUpdates(options: UpdateCheckOptions): Promise<UpdateInfo[]> {
	const { projectDir, extension: targetExtension, crossSource = false, ...registryOptions } = options;

	let extensions: InstalledExtension[];

	if (targetExtension) {
		const ext = await findInstalledExtension(projectDir, targetExtension);
		extensions = ext ? [ext] : [];
	} else {
		extensions = await discoverInstalledExtensions(projectDir);
	}

	// Group extensions by the path they'll use for update discovery so we only
	// fetch the registry when something actually needs it.
	const registryBound: InstalledExtension[] = [];
	const githubBound: InstalledExtension[] = [];
	for (const ext of extensions) {
		if (!ext.manifest.source) {
			continue;
		}
		const effectiveType = getEffectiveSourceType(ext.manifest);
		if (effectiveType === "github") {
			githubBound.push(ext);
		} else if (effectiveType === "registry") {
			registryBound.push(ext);
		}
		// url/local/unknown are intentionally skipped: they aren't resolvable.
	}

	const needsRegistry = registryBound.length > 0 || (crossSource && githubBound.length > 0);
	const registry = needsRegistry ? await fetchRegistry(registryOptions) : null;
	const updates: UpdateInfo[] = [];

	for (const ext of registryBound) {
		const source = ext.manifest.source;
		if (!source || !registry) {
			continue;
		}
		const update = buildRegistryUpdate(ext, source, registry);
		if (update) {
			updates.push(update);
		}
	}

	const githubResults = await Promise.all(
		githubBound.map(async (ext) => {
			const source = ext.manifest.source;
			if (!source) {
				return null;
			}
			const update = await buildGitHubUpdate(ext, source, registryOptions);
			if (update) {
				return update;
			}
			if (crossSource && registry) {
				return buildRegistryUpdate(ext, source, registry);
			}
			return null;
		}),
	);

	for (const update of githubResults) {
		if (update) {
			updates.push(update);
		}
	}

	return updates;
}

/**
 * Resolve a registry-sourced extension against the registry, producing an
 * UpdateInfo only if a newer tag or commit is advertised.
 */
function buildRegistryUpdate(ext: InstalledExtension, source: string, registry: Registry): UpdateInfo | null {
	const { base: baseName } = splitSourceRef(source);
	const entry = lookupRegistryEntry(registry, baseName);

	if (!entry) {
		return null;
	}

	const currentCommit = extractCommitFromSource(source);

	if (currentCommit && entry.latestCommit) {
		const latestCommit = entry.latestCommit.substring(0, 7).toLowerCase();
		if (currentCommit === latestCommit) {
			return null;
		}
		return {
			extension: ext,
			currentVersion: currentCommit,
			latestVersion: latestCommit,
			releaseUrl: entry.htmlUrl,
			source: `${entry.fullName}@${latestCommit}`,
		};
	}

	if (currentCommit) {
		// Current install is pinned to a commit but the registry doesn't track
		// commits; we can't meaningfully compare, so report no update.
		return null;
	}

	if (!entry.latestVersion) {
		return null;
	}

	const currentVersion = normaliseVersion(ext.manifest.version);
	const latestVersion = normaliseVersion(entry.latestVersion);

	if (!currentVersion || !latestVersion) {
		return null;
	}

	try {
		if (semver.gt(latestVersion, currentVersion)) {
			return {
				extension: ext,
				currentVersion,
				latestVersion,
				releaseUrl: entry.latestReleaseUrl,
				source: entry.latestTag ? `${entry.fullName}@${entry.latestTag}` : entry.fullName,
			};
		}
	} catch {
		// Invalid semver — treat as no update rather than aborting the batch.
		return null;
	}

	return null;
}

/**
 * Resolve a github-sourced extension against GitHub's releases/tags APIs
 * directly, bypassing the registry.
 */
async function buildGitHubUpdate(
	ext: InstalledExtension,
	source: string,
	registryOptions: RegistryOptions,
): Promise<UpdateInfo | null> {
	// Commit-pinned installs have no comparable data outside the registry; bail
	// before issuing any network calls.
	if (extractCommitFromSource(source)) {
		return null;
	}

	const { base: baseName } = splitSourceRef(source);
	const slashIndex = baseName.indexOf("/");
	if (slashIndex <= 0 || slashIndex === baseName.length - 1) {
		return null;
	}
	const owner = baseName.substring(0, slashIndex);
	// GitHub's releases API only addresses the repository, so drop any
	// "owner/repo/subdir" suffix and keep the first segment after the owner.
	const rest = baseName.substring(slashIndex + 1);
	const nextSlash = rest.indexOf("/");
	const repo = nextSlash === -1 ? rest : rest.substring(0, nextSlash);
	const fullName = `${owner}/${repo}`;
	const htmlUrl = `https://github.com/${fullName}`;

	const { auth, timeout } = registryOptions;
	const githubOptions = { auth, timeout };

	let latestTag: string | undefined;
	let latestReleaseUrl: string | null = null;

	try {
		const releases = await fetchReleases(owner, repo, githubOptions);
		const release = releases[0];
		if (release) {
			latestTag = release.tagName;
			latestReleaseUrl = release.htmlUrl;
		}
	} catch (error) {
		// Network or auth failures shouldn't abort the entire update check; the
		// caller may still fall back to the registry. No logger dependency here.
		console.error(`Failed to fetch releases for ${fullName}: ${getErrorMessage(error)}`);
	}

	if (!latestTag) {
		try {
			const tags = await fetchTags(owner, repo, githubOptions);
			// Match `fetchReleases`'s default filtering: skip prerelease-style tags
			// so a repo that only ships v2.0.0-beta.1 via tags doesn't get flagged
			// as an update.
			const tag = tags.find((t) => !isPrereleaseTag(t.name));
			if (tag) {
				latestTag = tag.name;
			}
		} catch (error) {
			console.error(`Failed to fetch tags for ${fullName}: ${getErrorMessage(error)}`);
		}
	}

	if (!latestTag) {
		return null;
	}

	const currentVersion = normaliseVersion(ext.manifest.version);
	const latestVersion = normaliseVersion(latestTag);

	if (!currentVersion || !latestVersion) {
		return null;
	}

	try {
		if (semver.gt(latestVersion, currentVersion)) {
			return {
				extension: ext,
				currentVersion,
				latestVersion,
				releaseUrl: latestReleaseUrl ?? htmlUrl,
				source: `${fullName}@${latestTag}`,
			};
		}
	} catch {
		return null;
	}

	return null;
}

/**
 * Apply updates to extensions.
 *
 * @param updates - Updates to apply
 * @param options - Update options
 * @returns Update result
 */
export async function applyUpdates(updates: UpdateInfo[], options: UpdateOptions): Promise<UpdateResult> {
	const { projectDir, auth, onProgress } = options;

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
				projectDir,
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
 */
export async function update(options: UpdateOptions): Promise<UpdateResult> {
	const updates = await checkForUpdates(options);

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

/**
 * Determine whether a tag name encodes a prerelease (e.g. `v2.0.0-beta.1`).
 * `normaliseVersion` runs through `semver.coerce`, which strips prerelease
 * identifiers, so this check operates on the raw tag.
 */
function isPrereleaseTag(tag: string): boolean {
	const cleaned = tag.replace(/^v/, "").trim();
	const parsed = semver.parse(cleaned, { loose: true });
	if (parsed) {
		return parsed.prerelease.length > 0;
	}
	return semver.prerelease(cleaned, { loose: true }) !== null;
}

/**
 * Normalise a version string for comparison.
 * Strips leading "v" prefix and coerces to valid semver.
 *
 * @param version - Version string to normalise
 * @returns Normalised semver string, or null if invalid
 */
export function normaliseVersion(version: string): string | null {
	if (!version) {
		return null;
	}

	const cleaned = version.replace(/^v/, "").trim();

	const parsed = semver.valid(semver.coerce(cleaned));

	return parsed;
}
