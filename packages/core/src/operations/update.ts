/**
 * Extension update operations.
 */

import * as semver from "semver";
import type { AuthConfig } from "../types/auth.js";
import type { ExtensionId } from "../types/extension.js";
import { formatExtensionId } from "../types/extension.js";
import { ExtensionError } from "../errors.js";
import {
	discoverInstalledExtensions,
	findInstalledExtension,
	type InstalledExtension,
} from "../filesystem/discovery.js";
import { fetchRegistry, type RegistryOptions } from "../registry/fetcher.js";
import { install, parseInstallSource, type InstallResult } from "./install.js";

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
	updated: Array<{
		extension: InstalledExtension;
		previousVersion: string;
		newVersion: string;
	}>;
	/** Skipped extensions with reasons. */
	skipped: Array<{
		extension: InstalledExtension;
		reason: string;
	}>;
	/** Failed updates with errors. */
	failed: Array<{
		extension: InstalledExtension;
		error: string;
	}>;
}

/**
 * Check for available updates.
 *
 * @param options - Check options
 * @returns Array of available updates
 */
export async function checkForUpdates(options: UpdateCheckOptions): Promise<UpdateInfo[]> {
	const { projectDir, extension: targetExtension, ...registryOptions } = options;

	let extensions: InstalledExtension[];

	if (targetExtension) {
		const ext = await findInstalledExtension(projectDir, targetExtension);
		extensions = ext ? [ext] : [];
	} else {
		extensions = await discoverInstalledExtensions(projectDir);
	}

	const registry = await fetchRegistry(registryOptions);
	const updates: UpdateInfo[] = [];

	for (const ext of extensions) {
		const source = ext.manifest.source;

		if (!source) {
			continue;
		}

		const registryKey = findRegistryKey(source, registry);

		if (!registryKey) {
			continue;
		}

		const entry = registry[registryKey];

		if (!entry) {
			continue;
		}

		// Check for commit-based installation
		const currentCommit = extractCommitFromSource(source);

		if (currentCommit && entry.lastCommit) {
			// Commit-based comparison
			const latestCommit = entry.lastCommit.substring(0, 7).toLowerCase();

			if (currentCommit !== latestCommit) {
				updates.push({
					extension: ext,
					currentVersion: currentCommit,
					latestVersion: latestCommit,
					releaseUrl: entry.htmlUrl,
					source: `${entry.fullName}@${latestCommit}`,
				});
			}
			continue; // Skip semver comparison for commit-based
		}

		// Semver-based comparison for tagged releases
		if (!entry.latestVersion) {
			continue;
		}

		const currentVersion = normaliseVersion(ext.manifest.version);
		const latestVersion = normaliseVersion(entry.latestVersion);

		if (!currentVersion || !latestVersion) {
			continue;
		}

		try {
			if (semver.gt(latestVersion, currentVersion)) {
				updates.push({
					extension: ext,
					currentVersion,
					latestVersion,
					releaseUrl: entry.latestReleaseUrl,
					source: entry.latestTag ? `${entry.fullName}@${entry.latestTag}` : entry.fullName,
				});
			}
		} catch {
			continue;
		}
	}

	return updates;
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
				error: error instanceof Error ? error.message : String(error),
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
 * Find registry key for a source string.
 */
function findRegistryKey(source: string, registry: Record<string, unknown>): string | null {
	const atIndex = source.lastIndexOf("@");
	const baseName = atIndex > 0 ? source.substring(0, atIndex) : source;

	if (registry[baseName]) {
		return baseName;
	}

	const lowerBase = baseName.toLowerCase();
	for (const key of Object.keys(registry)) {
		if (key.toLowerCase() === lowerBase) {
			return key;
		}
	}

	return null;
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
 * Normalise version string for comparison.
 */
function normaliseVersion(version: string): string | null {
	if (!version) {
		return null;
	}

	const cleaned = version.replace(/^v/, "").trim();

	const parsed = semver.valid(semver.coerce(cleaned));

	return parsed;
}
