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
import { formatExtensionId, type ExtensionId } from "../types/extension.js";
import type { ExtensionManifest, SourceType } from "../types/manifest.js";
import { ExtensionError } from "../errors.js";
import { readManifest } from "./manifest.js";
import {
	readSourceRecord,
	type SourceRecord,
	type SourceRecordKind,
	type SourceRecordReadResult,
} from "./sourceRecord.js";
import { pathExists } from "./walk.js";

/** Name of the extensions directory. */
export const EXTENSIONS_DIR = "_extensions";

/**
 * An installed extension discovered on the filesystem.
 */
export interface InstalledExtension {
	/** Extension identifier. */
	id: ExtensionId;
	/**
	 * Parsed manifest data.
	 *
	 * `source` and `sourceType` come from the install record when it can be read.
	 * Without a record, they come from the `source` and `source-type` keys of the manifest.
	 * An unreadable record leaves them empty.
	 */
	manifest: ExtensionManifest;
	/** Full path to the manifest file. */
	manifestPath: string;
	/** Full path to the extension directory. */
	directory: string;
	/** Install record, or null when it is absent or unreadable. */
	record: SourceRecord | null;
	/** Whether the install record is absent, unreadable, or read. */
	recordStatus: "absent" | "unreadable" | "ok";
}

/**
 * Record fields of an extension that has no install record.
 */
export const NO_SOURCE_RECORD = { record: null, recordStatus: "absent" } as const satisfies Pick<
	InstalledExtension,
	"record" | "recordStatus"
>;

const RECORD_KIND_SOURCE_TYPES: Record<SourceRecordKind, SourceType> = {
	github: "github",
	url: "url",
	"local-archive": "local",
	"local-dir": "local",
};

/**
 * Read the install record of an extension folder and apply its source to the manifest.
 *
 * The record wins over the `source` and `source-type` keys of the manifest.
 *
 * @param directory - Extension folder
 * @param manifest - Manifest read from the folder
 * @param result - Install record already read from the folder, read again when not given
 * @returns The manifest with the effective source, and the record
 */
export function applySourceRecord(
	directory: string,
	manifest: ExtensionManifest,
	result: SourceRecordReadResult = readSourceRecord(directory),
): Pick<InstalledExtension, "manifest" | "record" | "recordStatus"> {
	if (result.status === "absent") {
		return { manifest, ...NO_SOURCE_RECORD };
	}
	if (result.status === "unreadable") {
		return {
			manifest: { ...manifest, source: undefined, sourceType: undefined },
			record: null,
			recordStatus: "unreadable",
		};
	}
	const { record } = result;
	const sourceType =
		record.quartoWizard?.sourceType === "registry" ? "registry" : RECORD_KIND_SOURCE_TYPES[record.kind];
	return {
		manifest: { ...manifest, source: record.source, sourceType },
		record,
		recordStatus: "ok",
	};
}

/**
 * Describe an installed extension, with its install record applied.
 *
 * @param id - Extension identifier
 * @param manifest - Manifest read from the folder
 * @param manifestPath - Full path to the manifest file
 * @param directory - Extension folder
 * @param recordResult - Install record already read from the folder, read again when not given
 * @returns The installed extension
 */
export function toInstalledExtension(
	id: ExtensionId,
	manifest: ExtensionManifest,
	manifestPath: string,
	directory: string,
	recordResult?: SourceRecordReadResult,
): InstalledExtension {
	return { id, manifestPath, directory, ...applySourceRecord(directory, manifest, recordResult) };
}

/**
 * Describe an extension folder whose manifest is missing or cannot be parsed.
 */
function toInvalidExtension(id: ExtensionId, directory: string): InstalledExtension {
	return toInstalledExtension(
		id,
		{ title: id.name, author: "", version: "", contributes: {} },
		path.join(directory, "_extension.yml"),
		directory,
	);
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
	// Delegates to the sync version since readManifest (the heavy work) is
	// already synchronous. The only async part would be readdir, but for
	// the small _extensions directory this is negligible.
	return discoverInstalledExtensionsSync(projectDir, options);
}

/**
 * List a directory in code-point order of entry names.
 *
 * `readdirSync` returns entries in the order of the filesystem, which differs
 * between machines. A fixed order makes the first match of a shared name the
 * same everywhere.
 */
export function readDirectorySorted(directory: string): fs.Dirent[] {
	return fs
		.readdirSync(directory, { withFileTypes: true })
		.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
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
		const topEntries = readDirectorySorted(extensionsDir);

		for (const topEntry of topEntries) {
			if (!topEntry.isDirectory()) {
				continue;
			}

			const topPath = path.join(extensionsDir, topEntry.name);

			// Check if this is an extension without owner (has manifest directly)
			const directManifest = readManifest(topPath);
			if (directManifest) {
				results.push(
					toInstalledExtension(
						{ owner: null, name: topEntry.name },
						directManifest.manifest,
						directManifest.manifestPath,
						topPath,
					),
				);
				continue;
			}

			// Otherwise, treat as owner directory and look for extensions inside
			const extEntries = readDirectorySorted(topPath);

			for (const extEntry of extEntries) {
				if (!extEntry.isDirectory()) {
					continue;
				}

				const extPath = path.join(topPath, extEntry.name);

				try {
					const manifestResult = readManifest(extPath);

					if (manifestResult) {
						results.push(
							toInstalledExtension(
								{ owner: topEntry.name, name: extEntry.name },
								manifestResult.manifest,
								manifestResult.manifestPath,
								extPath,
							),
						);
					} else if (options.includeInvalid) {
						results.push(toInvalidExtension({ owner: topEntry.name, name: extEntry.name }, extPath));
					}
				} catch {
					// Manifest parsing failed (invalid YAML, missing required fields, etc.).
					// If includeInvalid is set, we still want to show the extension exists
					// so users can see and potentially fix or remove it.
					if (options.includeInvalid) {
						results.push(toInvalidExtension({ owner: topEntry.name, name: extEntry.name }, extPath));
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
 * A name without an owner matches the ownerless `_extensions/<name>` first,
 * then the single owned extension of that name.
 *
 * @param projectDir - Project root directory
 * @param extensionId - Extension ID to find
 * @returns InstalledExtension or null if not found
 * @throws ExtensionError when a name without an owner matches several owners
 */
export async function findInstalledExtension(
	projectDir: string,
	extensionId: ExtensionId,
): Promise<InstalledExtension | null> {
	if (!extensionId.owner) {
		const extensions = await discoverInstalledExtensions(projectDir);
		const matches = extensions.filter((ext) => ext.id.name === extensionId.name);
		const ownerless = matches.find((ext) => ext.id.owner === null);
		if (ownerless) {
			return ownerless;
		}
		if (matches.length > 1) {
			throw new ExtensionError(
				`Extension name "${extensionId.name}" is ambiguous: ${matches.map((ext) => formatExtensionId(ext.id)).join(", ")}.`,
				{ suggestion: "Use the full owner/name." },
			);
		}
		return matches[0] ?? null;
	}

	const extPath = path.join(getExtensionsDir(projectDir), extensionId.owner, extensionId.name);

	if (!(await pathExists(extPath))) {
		return null;
	}

	const manifestResult = readManifest(extPath);

	if (!manifestResult) {
		return null;
	}

	return toInstalledExtension(extensionId, manifestResult.manifest, manifestResult.manifestPath, extPath);
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
