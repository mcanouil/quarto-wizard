/**
 * @title Extension Discovery Module
 * @description Extension discovery from the filesystem.
 *
 * Scans the _extensions directory to find installed Quarto extensions.
 *
 * @module filesystem
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionId } from "../types/extension.js";
import type { ExtensionManifest } from "../types/manifest.js";
import { readManifest } from "./manifest.js";

/** Name of the extensions directory. */
const EXTENSIONS_DIR = "_extensions";

/**
 * An installed extension discovered on the filesystem.
 */
export interface InstalledExtension {
	/** Extension identifier. */
	id: ExtensionId;
	/** Parsed manifest data. */
	manifest: ExtensionManifest;
	/** Full path to the manifest file. */
	manifestPath: string;
	/** Full path to the extension directory. */
	directory: string;
}

/**
 * Options for extension discovery.
 */
export interface DiscoveryOptions {
	/** Include extensions without valid manifests. */
	includeInvalid?: boolean;
}

/**
 * Get the extensions directory path for a project.
 *
 * @param projectDir - Project root directory
 * @returns Path to _extensions directory
 */
export function getExtensionsDir(projectDir: string): string {
	return path.join(projectDir, EXTENSIONS_DIR);
}

/**
 * Check if an extensions directory exists.
 *
 * @param projectDir - Project root directory
 * @returns True if _extensions directory exists
 */
export function hasExtensionsDir(projectDir: string): boolean {
	const extensionsDir = getExtensionsDir(projectDir);
	return fs.existsSync(extensionsDir) && fs.statSync(extensionsDir).isDirectory();
}

/**
 * Discover all installed extensions in a project.
 *
 * Scans the _extensions directory for extensions in both formats:
 * - _extensions/owner/name/_extension.yml (with owner)
 * - _extensions/name/_extension.yml (without owner)
 *
 * @param projectDir - Project root directory
 * @param options - Discovery options
 * @returns Array of installed extensions
 *
 * @example
 * ```typescript
 * const extensions = await discoverInstalledExtensions("./my-project");
 * for (const ext of extensions) {
 *   console.log(`${ext.id.owner ?? ""}/${ext.id.name}: ${ext.manifest.version}`);
 * }
 * ```
 */
export async function discoverInstalledExtensions(
	projectDir: string,
	options: DiscoveryOptions = {},
): Promise<InstalledExtension[]> {
	const extensionsDir = getExtensionsDir(projectDir);

	if (!hasExtensionsDir(projectDir)) {
		return [];
	}

	const results: InstalledExtension[] = [];

	try {
		const topEntries = await fs.promises.readdir(extensionsDir, {
			withFileTypes: true,
		});

		for (const topEntry of topEntries) {
			if (!topEntry.isDirectory()) {
				continue;
			}

			const topPath = path.join(extensionsDir, topEntry.name);

			// Check if this is an extension without owner (has manifest directly)
			const directManifest = readManifest(topPath);
			if (directManifest) {
				results.push({
					id: { owner: null, name: topEntry.name },
					manifest: directManifest.manifest,
					manifestPath: directManifest.manifestPath,
					directory: topPath,
				});
				continue;
			}

			// Otherwise, treat as owner directory and look for extensions inside
			const extEntries = await fs.promises.readdir(topPath, {
				withFileTypes: true,
			});

			for (const extEntry of extEntries) {
				if (!extEntry.isDirectory()) {
					continue;
				}

				const extPath = path.join(topPath, extEntry.name);

				try {
					const manifestResult = readManifest(extPath);

					if (manifestResult) {
						results.push({
							id: { owner: topEntry.name, name: extEntry.name },
							manifest: manifestResult.manifest,
							manifestPath: manifestResult.manifestPath,
							directory: extPath,
						});
					} else if (options.includeInvalid) {
						results.push({
							id: { owner: topEntry.name, name: extEntry.name },
							manifest: {
								title: extEntry.name,
								author: "",
								version: "",
								contributes: {},
							},
							manifestPath: path.join(extPath, "_extension.yml"),
							directory: extPath,
						});
					}
				} catch {
					// Manifest parsing failed (invalid YAML, missing required fields, etc.).
					// If includeInvalid is set, we still want to show the extension exists
					// so users can see and potentially fix or remove it.
					if (options.includeInvalid) {
						results.push({
							id: { owner: topEntry.name, name: extEntry.name },
							manifest: {
								title: extEntry.name,
								author: "",
								version: "",
								contributes: {},
							},
							manifestPath: path.join(extPath, "_extension.yml"),
							directory: extPath,
						});
					}
				}
			}
		}
	} catch {
		// Top-level directory read failed (permissions, deleted mid-scan, etc.).
		// Return empty array rather than throwing since discovery is best-effort;
		// a missing or inaccessible _extensions directory just means no extensions.
		return [];
	}

	return results;
}

/**
 * Synchronous version of discoverInstalledExtensions.
 *
 * @param projectDir - Project root directory
 * @param options - Discovery options
 * @returns Array of installed extensions
 */
export function discoverInstalledExtensionsSync(
	projectDir: string,
	options: DiscoveryOptions = {},
): InstalledExtension[] {
	const extensionsDir = getExtensionsDir(projectDir);

	if (!hasExtensionsDir(projectDir)) {
		return [];
	}

	const results: InstalledExtension[] = [];

	try {
		const topEntries = fs.readdirSync(extensionsDir, { withFileTypes: true });

		for (const topEntry of topEntries) {
			if (!topEntry.isDirectory()) {
				continue;
			}

			const topPath = path.join(extensionsDir, topEntry.name);

			// Check if this is an extension without owner (has manifest directly)
			const directManifest = readManifest(topPath);
			if (directManifest) {
				results.push({
					id: { owner: null, name: topEntry.name },
					manifest: directManifest.manifest,
					manifestPath: directManifest.manifestPath,
					directory: topPath,
				});
				continue;
			}

			// Otherwise, treat as owner directory and look for extensions inside
			const extEntries = fs.readdirSync(topPath, { withFileTypes: true });

			for (const extEntry of extEntries) {
				if (!extEntry.isDirectory()) {
					continue;
				}

				const extPath = path.join(topPath, extEntry.name);

				try {
					const manifestResult = readManifest(extPath);

					if (manifestResult) {
						results.push({
							id: { owner: topEntry.name, name: extEntry.name },
							manifest: manifestResult.manifest,
							manifestPath: manifestResult.manifestPath,
							directory: extPath,
						});
					} else if (options.includeInvalid) {
						results.push({
							id: { owner: topEntry.name, name: extEntry.name },
							manifest: {
								title: extEntry.name,
								author: "",
								version: "",
								contributes: {},
							},
							manifestPath: path.join(extPath, "_extension.yml"),
							directory: extPath,
						});
					}
				} catch {
					// Manifest parsing failed (invalid YAML, missing required fields, etc.).
					// If includeInvalid is set, we still want to show the extension exists
					// so users can see and potentially fix or remove it.
					if (options.includeInvalid) {
						results.push({
							id: { owner: topEntry.name, name: extEntry.name },
							manifest: {
								title: extEntry.name,
								author: "",
								version: "",
								contributes: {},
							},
							manifestPath: path.join(extPath, "_extension.yml"),
							directory: extPath,
						});
					}
				}
			}
		}
	} catch {
		// Top-level directory read failed (permissions, deleted mid-scan, etc.).
		// Return empty array rather than throwing since discovery is best-effort;
		// a missing or inaccessible _extensions directory just means no extensions.
		return [];
	}

	return results;
}

/**
 * Find a specific installed extension by ID.
 *
 * @param projectDir - Project root directory
 * @param extensionId - Extension ID to find
 * @returns InstalledExtension or null if not found
 */
export async function findInstalledExtension(
	projectDir: string,
	extensionId: ExtensionId,
): Promise<InstalledExtension | null> {
	if (!extensionId.owner) {
		const extensions = await discoverInstalledExtensions(projectDir);
		return extensions.find((ext) => ext.id.name === extensionId.name) ?? null;
	}

	const extPath = path.join(getExtensionsDir(projectDir), extensionId.owner, extensionId.name);

	if (!fs.existsSync(extPath)) {
		return null;
	}

	const manifestResult = readManifest(extPath);

	if (!manifestResult) {
		return null;
	}

	return {
		id: extensionId,
		manifest: manifestResult.manifest,
		manifestPath: manifestResult.manifestPath,
		directory: extPath,
	};
}

/**
 * Get the installation path for an extension.
 *
 * @param projectDir - Project root directory
 * @param extensionId - Extension ID
 * @returns Path where the extension should be installed
 */
export function getExtensionInstallPath(projectDir: string, extensionId: ExtensionId): string {
	if (extensionId.owner) {
		return path.join(getExtensionsDir(projectDir), extensionId.owner, extensionId.name);
	}
	// No owner - install directly under _extensions/name
	return path.join(getExtensionsDir(projectDir), extensionId.name);
}
