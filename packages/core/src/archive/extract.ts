/**
 * @title Archive Extraction Module
 * @description Unified archive extraction for ZIP and TAR.GZ formats.
 *
 * Provides format detection, extraction, and cleanup utilities for archive files.
 *
 * @module archive
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { ExtensionError } from "../errors.js";
import { MANIFEST_FILENAMES } from "../filesystem/manifest.js";
import { EXTENSIONS_DIR, getExtensionsDir } from "../filesystem/discovery.js";
import { isQuartoIgnored, readQuartoIgnore } from "../filesystem/quartoignore.js";
import { isInside, toRelativePosixPath } from "../filesystem/walk.js";
import { extractZip } from "./zip.js";
import { extractTar } from "./tar.js";

/**
 * Options for archive extraction.
 */
export interface ExtractOptions {
	/** Maximum total extraction size in bytes. */
	maxSize?: number;
	/** Progress callback. */
	onProgress?: (file: string) => void;
}

/**
 * Result of archive extraction.
 */
export interface ExtractResult {
	/** Path to the extraction directory. */
	extractDir: string;
	/** List of extracted file paths. */
	files: string[];
	/** Detected archive format. */
	format: "zip" | "tarball";
}

/**
 * Detect archive format from file path.
 */
export function detectArchiveFormat(archivePath: string): "zip" | "tarball" | null {
	const lower = archivePath.toLowerCase();

	if (lower.endsWith(".zip")) {
		return "zip";
	}

	if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz") || lower.endsWith(".tar")) {
		return "tarball";
	}

	return null;
}

/**
 * Extract an archive to a temporary directory.
 *
 * @param archivePath - Path to the archive file
 * @param options - Extraction options
 * @returns Extraction result
 */
export async function extractArchive(archivePath: string, options: ExtractOptions = {}): Promise<ExtractResult> {
	const format = detectArchiveFormat(archivePath);

	if (!format) {
		throw new ExtensionError(`Unsupported archive format: ${path.basename(archivePath)}`, {
			suggestion: "Supported formats: .zip, .tar.gz, .tgz",
		});
	}

	const extractDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "quarto-ext-"));

	try {
		let files: string[];

		if (format === "zip") {
			files = await extractZip(archivePath, extractDir, options);
		} else {
			files = await extractTar(archivePath, extractDir, options);
		}

		return {
			extractDir,
			files,
			format,
		};
	} catch (error) {
		await fs.promises.rm(extractDir, { recursive: true, force: true });
		throw error;
	}
}

/**
 * Check whether a file exists using async FS operations.
 */
async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.promises.access(filePath);
		return true;
	} catch {
		return false;
	}
}

/** Maximum recursion depth for findExtensionRoot to prevent stack overflow on crafted archives. */
const MAX_FIND_DEPTH = 5;

/**
 * Check whether a directory holds an extension manifest.
 */
async function hasManifestFile(directory: string): Promise<boolean> {
	for (const name of MANIFEST_FILENAMES) {
		if (await fileExists(path.join(directory, name))) {
			return true;
		}
	}
	return false;
}

/**
 * Find the extension root in an extracted archive.
 *
 * GitHub archives typically have a top-level directory like "repo-tag/".
 * This function finds the directory containing _extension.yml.
 *
 * @param extractDir - Extraction directory
 * @param depth - Current recursion depth (internal use)
 * @returns Path to extension root or null if not found
 */
export async function findExtensionRoot(extractDir: string, depth = 0): Promise<string | null> {
	if (depth > MAX_FIND_DEPTH) {
		return null;
	}

	if (await hasManifestFile(extractDir)) {
		return extractDir;
	}

	const entries = await fs.promises.readdir(extractDir, { withFileTypes: true });
	const directories = entries.filter((e) => e.isDirectory());

	for (const dir of directories) {
		const dirPath = path.join(extractDir, dir.name);
		if (await hasManifestFile(dirPath)) {
			return dirPath;
		}
	}

	for (const dir of directories) {
		const subRoot = await findExtensionRoot(path.join(extractDir, dir.name), depth + 1);
		if (subRoot) {
			return subRoot;
		}
	}

	return null;
}

/**
 * Information about a discovered extension in an archive.
 */
export interface DiscoveredExtension {
	/** Absolute path to the extension root (directory containing _extension.yml). */
	path: string;
	/** Path relative to the extraction root (for display purposes). */
	relativePath: string;
	/** Extension ID derived from directory structure. */
	id: { owner: string | null; name: string };
}

/**
 * Derive extension ID from the extension path relative to extraction directory.
 *
 * @param extensionPath - Path to extension root
 * @param extractDir - Base extraction directory
 * @returns Extension ID with owner and name
 */
function deriveExtensionIdFromPath(extensionPath: string, extractDir: string): { owner: string | null; name: string } {
	const relativePath = path.relative(extractDir, extensionPath);
	const parts = relativePath.split(path.sep);
	const extensionsIndex = parts.lastIndexOf(EXTENSIONS_DIR);

	if (extensionsIndex >= 0 && parts.length > extensionsIndex + 1) {
		const afterExtensions = parts.slice(extensionsIndex + 1);
		if (afterExtensions.length >= 2) {
			return { owner: afterExtensions[0], name: afterExtensions[afterExtensions.length - 1] };
		}
		if (afterExtensions.length === 1) {
			return { owner: null, name: afterExtensions[0] };
		}
	}

	// Fallback: use last directory name
	return { owner: null, name: parts[parts.length - 1] };
}

/**
 * Resolve the repository root inside an extraction directory.
 *
 * GitHub archives wrap everything in a single top-level directory such as `repo-tag/`.
 * That wrapper is stripped so `.quartoignore` and `_extensions/` are looked up where the
 * repository actually declares them. A sole `_extensions/` entry is not a wrapper, and
 * neither is a directory that is itself an extension.
 *
 * @param extractDir - Extraction directory
 * @returns Path to the repository root
 */
async function resolveArchiveRoot(extractDir: string): Promise<string> {
	if (await hasManifestFile(extractDir)) {
		return extractDir;
	}

	let entries: fs.Dirent[];
	try {
		entries = await fs.promises.readdir(extractDir, { withFileTypes: true });
	} catch {
		return extractDir;
	}

	if (entries.length !== 1 || !entries[0].isDirectory() || entries[0].name === EXTENSIONS_DIR) {
		return extractDir;
	}

	return path.join(extractDir, entries[0].name);
}

/**
 * Narrow a list, but never to nothing.
 *
 * The primary-host and `.quartoignore` rules both express a preference rather than a hard
 * requirement: a repository that keeps its only extension in an ignored location must still
 * be installable.
 */
function narrowKeepingNonEmpty<T>(items: T[], keep: (item: T) => boolean): T[] {
	const narrowed = items.filter(keep);
	return narrowed.length > 0 ? narrowed : items;
}

/**
 * What an extracted archive offers for installation.
 */
export interface ArchiveExtensions {
	/**
	 * The repository root inside the extraction directory, with any archive wrapper
	 * directory stripped. Template files are relative to this, and it is where the
	 * repository declares `.quartoignore` and `_extensions/`.
	 */
	root: string;
	/** Extensions the archive offers. */
	extensions: DiscoveredExtension[];
}

/**
 * Read the extensions an extracted archive offers, and the repository root they came from.
 *
 * Unlike findExtensionRoot which returns the first match, this function
 * finds all extensions in the archive, useful for repositories that
 * contain multiple extensions.
 *
 * The repository's own `_extensions/` is the primary host: when it holds at least one
 * extension, extensions found elsewhere in the archive are ignored, so a vendored copy
 * under `docs/_extensions/` is not offered for installation. Paths matched by the
 * repository's `.quartoignore` are dropped as well. Neither rule is allowed to empty the
 * result, so an archive that only ships extensions in ignored locations still installs.
 * `discoverQuartoProjectRoots` in the extension host applies the same two rules to a
 * workspace folder; it checks the host first so it can skip scanning entirely, which is an
 * ordering the fallback below makes immaterial.
 *
 * @param extractDir - Extraction directory
 * @returns The repository root and the extensions on offer
 */
export async function readArchiveExtensions(extractDir: string): Promise<ArchiveExtensions> {
	const results: DiscoveredExtension[] = [];

	async function searchDirectory(dir: string, depth = 0): Promise<void> {
		if (depth > MAX_FIND_DEPTH) {
			return;
		}

		// Check for manifest in current directory
		if (await hasManifestFile(dir)) {
			// Found an extension, derive its ID from path
			const id = deriveExtensionIdFromPath(dir, extractDir);
			const relativePath = path.relative(extractDir, dir);
			results.push({ path: dir, relativePath, id });
			// Don't search subdirectories of an extension
			return;
		}

		// Search subdirectories
		const entries = await fs.promises.readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.isDirectory()) {
				await searchDirectory(path.join(dir, entry.name), depth + 1);
			}
		}
	}

	await searchDirectory(extractDir);

	const root = await resolveArchiveRoot(extractDir);

	if (results.length === 0) {
		return { root, extensions: [] };
	}

	const ignorePatterns = readQuartoIgnore(root);
	const hostDir = getExtensionsDir(root);

	const kept = narrowKeepingNonEmpty(
		results,
		(ext) => !isQuartoIgnored(ignorePatterns, toRelativePosixPath(root, ext.path)),
	);
	return { root, extensions: narrowKeepingNonEmpty(kept, (ext) => isInside(hostDir, ext.path)) };
}

/**
 * Clean up a temporary extraction directory.
 *
 * @param extractDir - Directory to remove
 */
export async function cleanupExtraction(extractDir: string): Promise<void> {
	try {
		await fs.promises.rm(extractDir, { recursive: true, force: true });
	} catch {
		// Cleanup is best-effort; failures are non-critical since temp directories
		// will be cleaned up eventually by the OS. Common causes: file locks on
		// Windows, permission changes, or directory already deleted.
	}
}
