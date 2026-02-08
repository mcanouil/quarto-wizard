/**
 * @title Brand Use Module
 * @description Brand operations for downloading and applying Quarto brands.
 *
 * Handles downloading brand extensions or plain brand repositories
 * and copying brand files (YAML + referenced assets) to _brand/.
 *
 * @module operations
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import type { AuthConfig } from "../types/auth.js";
import { ExtensionError } from "../errors.js";
import { parseInstallSource, formatInstallSource, type InstallSource } from "./install.js";
import { downloadGitHubArchive, downloadFromUrl } from "../github/download.js";
import { extractArchive, cleanupExtraction } from "../archive/extract.js";
import { MANIFEST_FILENAMES } from "../filesystem/manifest.js";
import { fetchRegistry, type RegistryOptions } from "../registry/fetcher.js";

/** Supported brand file names at root level. */
const BRAND_FILENAMES = ["_brand.yml", "_brand.yaml"] as const;

/**
 * Result of brand extension detection.
 */
export interface BrandExtensionInfo {
	/** Whether a brand extension was found. */
	isBrandExtension: boolean;
	/** Directory containing the brand extension. */
	extensionDir?: string;
	/** The brand file name declared in the extension manifest. */
	brandFileName?: string;
}

/**
 * Located brand file information.
 */
export interface BrandFileInfo {
	/** Absolute path to the brand YAML file. */
	brandFilePath: string;
	/** Directory containing the brand file (for resolving relative paths). */
	brandFileDir: string;
	/** Whether the brand was found via a brand extension. */
	isBrandExtension: boolean;
}

/**
 * Options for "use brand" operation.
 */
export interface UseBrandOptions extends RegistryOptions {
	/** Project directory. */
	projectDir: string;
	/** Authentication configuration. */
	auth?: AuthConfig;
	/** Callback to confirm overwriting existing files. Receives list of files that would be overwritten. */
	confirmOverwrite?: (files: string[]) => Promise<boolean>;
	/** Callback to confirm removing extra files in _brand/ not present in the source. */
	cleanupExtra?: (files: string[]) => Promise<boolean>;
	/** Progress callback. */
	onProgress?: (info: { phase: string; message: string; file?: string }) => void;
}

/**
 * Result of "use brand" operation.
 */
export interface UseBrandResult {
	/** Whether the operation succeeded. */
	success: boolean;
	/** Files created (new files). */
	created: string[];
	/** Files overwritten. */
	overwritten: string[];
	/** Files skipped (existing, not overwritten). */
	skipped: string[];
	/** Files cleaned up (removed from _brand/). */
	cleaned: string[];
	/** Source string for display. */
	source: string;
}

/**
 * Check if a directory contains a brand extension.
 *
 * Reads _extension.yml and looks for contributes.metadata.project.brand.
 *
 * @param dir - Directory to check
 * @returns Brand extension info
 */
export function checkForBrandExtension(dir: string): BrandExtensionInfo {
	for (const filename of MANIFEST_FILENAMES) {
		const filePath = path.join(dir, filename);
		if (!fs.existsSync(filePath)) {
			continue;
		}

		try {
			const content = fs.readFileSync(filePath, "utf-8");
			const raw = yaml.load(content) as Record<string, unknown> | null;
			if (!raw) {
				continue;
			}

			const contributes = raw.contributes as Record<string, unknown> | undefined;
			const metadata = contributes?.metadata as Record<string, unknown> | undefined;
			const project = metadata?.project as Record<string, unknown> | undefined;
			const brandFile = project?.brand;

			if (typeof brandFile === "string" && brandFile.length > 0) {
				return {
					isBrandExtension: true,
					extensionDir: dir,
					brandFileName: brandFile,
				};
			}
		} catch {
			// Cannot read or parse the extension file; continue searching.
		}
	}

	return { isBrandExtension: false };
}

/**
 * Find the brand file in a staged directory.
 *
 * Search order:
 * 1. Root: _brand.yml / _brand.yaml (plain brand repo).
 * 2. _extensions/\* (direct children).
 * 3. _extensions/\*\/\* (nested owner/name).
 *
 * @param stagedDir - Extracted/staged directory to search
 * @returns Brand file info or null if not found
 */
export function findBrandFile(stagedDir: string): BrandFileInfo | null {
	// 1. Check root for plain brand file.
	for (const filename of BRAND_FILENAMES) {
		const filePath = path.join(stagedDir, filename);
		if (fs.existsSync(filePath)) {
			return {
				brandFilePath: filePath,
				brandFileDir: stagedDir,
				isBrandExtension: false,
			};
		}
	}

	// 2. Check _extensions directory for brand extensions.
	const extensionsDir = path.join(stagedDir, "_extensions");
	if (!fs.existsSync(extensionsDir)) {
		return null;
	}

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(extensionsDir, { withFileTypes: true });
	} catch {
		return null;
	}

	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue;
		}

		const extPath = path.join(extensionsDir, entry.name);

		// Check direct child: _extensions/name/
		const check = checkForBrandExtension(extPath);
		if (check.isBrandExtension && check.extensionDir && check.brandFileName) {
			const brandFilePath = path.join(check.extensionDir, check.brandFileName);
			if (fs.existsSync(brandFilePath)) {
				return {
					brandFilePath,
					brandFileDir: check.extensionDir,
					isBrandExtension: true,
				};
			}
		}

		// Check nested: _extensions/owner/name/
		let nestedEntries: fs.Dirent[];
		try {
			nestedEntries = fs.readdirSync(extPath, { withFileTypes: true });
		} catch {
			continue;
		}

		for (const nested of nestedEntries) {
			if (!nested.isDirectory()) {
				continue;
			}
			const nestedPath = path.join(extPath, nested.name);
			const nestedCheck = checkForBrandExtension(nestedPath);
			if (nestedCheck.isBrandExtension && nestedCheck.extensionDir && nestedCheck.brandFileName) {
				const brandFilePath = path.join(nestedCheck.extensionDir, nestedCheck.brandFileName);
				if (fs.existsSync(brandFilePath)) {
					return {
						brandFilePath,
						brandFileDir: nestedCheck.extensionDir,
						isBrandExtension: true,
					};
				}
			}
		}
	}

	return null;
}

/**
 * Extract a path string from various brand YAML value formats.
 *
 * Handles:
 * - string: "path/to/file"
 * - object with path: \{ path: "path/to/file", alt: "..." \}
 *
 * @param value - Value from brand YAML
 * @returns Extracted path or undefined
 */
function extractPath(value: unknown): string | undefined {
	if (typeof value === "string") {
		return value;
	}
	if (value && typeof value === "object" && "path" in value) {
		const pathValue = (value as Record<string, unknown>).path;
		if (typeof pathValue === "string") {
			return pathValue;
		}
	}
	return undefined;
}

const RECOGNISED_ASSET_EXTENSIONS = new Set([
	"svg",
	"png",
	"jpg",
	"jpeg",
	"gif",
	"ico",
	"webp",
	"avif",
	"woff",
	"woff2",
	"ttf",
	"otf",
	"eot",
	"css",
	"scss",
	"sass",
	"less",
	"json",
	"yml",
	"yaml",
]);

/**
 * Check if a string is a local file path (not a URL or a named image reference).
 *
 * Named image references like "light" or "dark" refer to logo.images keys,
 * not file paths. We detect these by checking for path separators or extensions.
 *
 * Trade-off: a bare value like "logo.svg" (no path separator) is classified as
 * a file path because ".svg" is in the recognised set. If a brand YAML ever
 * uses a named reference whose name happens to end with a recognised extension,
 * it would be misclassified. In practice this is unlikely because named
 * references are short identifiers ("light", "dark", "icon"), not filenames.
 *
 * @param value - String to check
 * @returns True if the value is a local file path
 */
function isLocalFilePath(value: string): boolean {
	if (value.startsWith("http://") || value.startsWith("https://")) {
		return false;
	}
	// Paths with separators are always file paths.
	if (value.includes("/") || value.includes("\\")) {
		return true;
	}
	// Without path separators, require a recognised asset file extension to avoid
	// misclassifying dotted named references (e.g., "my.theme") as file paths.
	const ext = value.split(".").pop()?.toLowerCase();
	return ext !== undefined && RECOGNISED_ASSET_EXTENSIONS.has(ext);
}

/**
 * Extract all local file paths referenced in a brand YAML file.
 *
 * Extracts paths from:
 * - logo.images.\* (string or \{ path, alt \} objects).
 * - logo.small, logo.medium, logo.large (string or \{ light, dark \} objects).
 * - typography.fonts[].files where source is "file".
 *
 * @param brandYamlPath - Absolute path to the brand YAML file
 * @param onWarning - Optional callback for non-fatal warnings (e.g., parse errors)
 * @returns Array of unique relative file paths
 */
export function extractBrandFilePaths(brandYamlPath: string, onWarning?: (message: string) => void): string[] {
	const paths: string[] = [];

	let raw: Record<string, unknown>;
	try {
		const content = fs.readFileSync(brandYamlPath, "utf-8");
		raw = yaml.load(content) as Record<string, unknown>;
		if (!raw || typeof raw !== "object") {
			return paths;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		onWarning?.(`Failed to read brand file "${brandYamlPath}": ${message}`);
		return paths;
	}

	// Extract logo paths.
	const logo = raw.logo as Record<string, unknown> | undefined;
	if (logo && typeof logo === "object") {
		// logo.images: named resources.
		const images = logo.images as Record<string, unknown> | undefined;
		if (images && typeof images === "object") {
			for (const value of Object.values(images)) {
				const p = extractPath(value);
				if (p && isLocalFilePath(p)) {
					paths.push(p);
				}
			}
		}

		// logo.small, logo.medium, logo.large: string or { light, dark }.
		for (const size of ["small", "medium", "large"]) {
			const sizeValue = logo[size];
			if (!sizeValue) {
				continue;
			}

			if (typeof sizeValue === "string") {
				if (isLocalFilePath(sizeValue)) {
					paths.push(sizeValue);
				}
			} else if (typeof sizeValue === "object" && sizeValue !== null) {
				const lightDark = sizeValue as Record<string, unknown>;
				if (typeof lightDark.light === "string" && isLocalFilePath(lightDark.light)) {
					paths.push(lightDark.light);
				}
				if (typeof lightDark.dark === "string" && isLocalFilePath(lightDark.dark)) {
					paths.push(lightDark.dark);
				}
			}
		}
	}

	// Extract typography font file paths.
	const typography = raw.typography as Record<string, unknown> | undefined;
	if (typography && typeof typography === "object") {
		const fonts = typography.fonts as unknown[] | undefined;
		if (Array.isArray(fonts)) {
			for (const font of fonts) {
				if (!font || typeof font !== "object") {
					continue;
				}
				const fontObj = font as Record<string, unknown>;
				if (fontObj.source !== "file") {
					continue;
				}
				const files = fontObj.files as unknown[] | undefined;
				if (Array.isArray(files)) {
					for (const file of files) {
						const p = extractPath(file);
						if (p && isLocalFilePath(p)) {
							paths.push(p);
						}
					}
				}
			}
		}
	}

	// Deduplicate.
	return [...new Set(paths)];
}

/**
 * Find files in a directory that are not in the source set.
 *
 * @param targetDir - Directory to scan
 * @param sourceFiles - Set of relative file paths expected from the source
 * @returns Array of relative paths for files not in sourceFiles
 */
async function findExtraFiles(targetDir: string, sourceFiles: Set<string>): Promise<string[]> {
	const extras: string[] = [];

	async function walk(dir: string, baseRel: string): Promise<void> {
		let entries: fs.Dirent[];
		try {
			entries = await fs.promises.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			// Normalise entry names to forward slashes for consistent comparison
			// with sourceFileSet (also forward-slash normalised).
			// On Windows, entry.name itself should not contain backslashes, but we
			// normalise defensively to avoid subtle cross-platform mismatches.
			const name = entry.name.replace(/\\/g, "/");
			const rel = baseRel ? path.posix.join(baseRel, name) : name;
			if (entry.isDirectory()) {
				await walk(path.join(dir, entry.name), rel);
			} else if (!sourceFiles.has(rel)) {
				extras.push(rel);
			}
		}
	}

	try {
		await fs.promises.access(targetDir);
		await walk(targetDir, "");
	} catch {
		// Directory does not exist or is otherwise inaccessible (e.g. EACCES).
		// Both cases are treated as "no extras", matching prior existsSync behaviour.
	}
	return extras;
}

/**
 * Remove empty directories recursively from bottom up.
 *
 * @param dir - Root directory to clean
 */
async function cleanupEmptyDirs(dir: string): Promise<void> {
	try {
		await fs.promises.access(dir);
	} catch {
		return;
	}
	let entries: fs.Dirent[];
	try {
		entries = await fs.promises.readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	const subdirs = entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(dir, entry.name));

	await Promise.all(subdirs.map((subdir) => cleanupEmptyDirs(subdir)));

	await Promise.all(
		subdirs.map(async (subdir) => {
			try {
				const contents = await fs.promises.readdir(subdir);
				if (contents.length === 0) {
					await fs.promises.rmdir(subdir);
				}
			} catch {
				// Best-effort cleanup.
			}
		}),
	);
}

/**
 * Resolve the staged directory from a downloaded/extracted archive.
 *
 * GitHub archives typically have a single top-level directory (e.g., "owner-repo-sha/").
 * This function finds that directory.
 *
 * @param extractDir - Extraction directory
 * @returns The effective staged directory
 */
export function resolveStagedDir(extractDir: string): string {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(extractDir, { withFileTypes: true });
	} catch {
		return extractDir;
	}

	// Classify entries, following symlinks so that a symlink to a directory
	// is counted as a directory rather than being silently ignored.
	const dirs: fs.Dirent[] = [];
	const files: fs.Dirent[] = [];
	for (const entry of entries) {
		if (entry.isDirectory()) {
			dirs.push(entry);
		} else if (entry.isFile()) {
			files.push(entry);
		} else if (entry.isSymbolicLink()) {
			try {
				const target = fs.realpathSync(path.join(extractDir, entry.name));
				const realExtractDir = fs.realpathSync(extractDir);
				if (!target.startsWith(realExtractDir + path.sep) && target !== realExtractDir) {
					// Symlink points outside extractDir; treat as a file to avoid traversal.
					files.push(entry);
					continue;
				}
				const resolved = fs.statSync(path.join(extractDir, entry.name));
				if (resolved.isDirectory()) {
					dirs.push(entry);
				} else {
					files.push(entry);
				}
			} catch {
				// Broken symlink; treat as a file so we do not descend into it.
				files.push(entry);
			}
		}
	}

	// If there is exactly one directory and no files, use that directory.
	if (dirs.length === 1 && files.length === 0) {
		return path.join(extractDir, dirs[0].name);
	}

	return extractDir;
}

/**
 * Download and extract a brand source to a temporary directory.
 *
 * @param source - Parsed install source
 * @param options - Brand options for auth and progress
 * @returns Object with extractDir and stagedDir paths
 */
async function stageBrandSource(
	source: InstallSource,
	options: UseBrandOptions,
): Promise<{ extractDir: string; stagedDir: string; isLocal: boolean }> {
	const { auth, onProgress } = options;

	if (source.type === "github") {
		onProgress?.({ phase: "resolving", message: `Resolving ${source.owner}/${source.repo}...` });

		let defaultBranch: string | undefined;
		let latestCommit: string | undefined;
		try {
			const registry = await fetchRegistry(options);
			const registryKey = `${source.owner}/${source.repo}`;
			const entry = registry[registryKey] ?? registry[registryKey.toLowerCase()];
			if (entry) {
				defaultBranch = entry.defaultBranchRef ?? undefined;
				latestCommit = entry.latestCommit ?? undefined;
			}
		} catch {
			// Registry fetch failed; use defaults.
		}

		const result = await downloadGitHubArchive(source.owner, source.repo, source.version, {
			auth,
			defaultBranch,
			latestCommit,
			onProgress: (p) => {
				onProgress?.({ phase: p.phase, message: p.message });
			},
		});

		onProgress?.({ phase: "extracting", message: "Extracting archive..." });
		const extracted = await extractArchive(result.archivePath);

		// Clean up downloaded archive.
		try {
			await fs.promises.unlink(result.archivePath);
		} catch {
			// Best-effort cleanup.
		}

		const stagedDir = resolveStagedDir(extracted.extractDir);
		return { extractDir: extracted.extractDir, stagedDir, isLocal: false };
	}

	if (source.type === "url") {
		onProgress?.({ phase: "downloading", message: "Downloading archive..." });
		const archivePath = await downloadFromUrl(source.url, { auth });

		onProgress?.({ phase: "extracting", message: "Extracting archive..." });
		const extracted = await extractArchive(archivePath);

		try {
			await fs.promises.unlink(archivePath);
		} catch {
			// Best-effort cleanup.
		}

		const stagedDir = resolveStagedDir(extracted.extractDir);
		return { extractDir: extracted.extractDir, stagedDir, isLocal: false };
	}

	// Local source.
	const stat = await fs.promises.stat(source.path);
	if (stat.isDirectory()) {
		return { extractDir: source.path, stagedDir: source.path, isLocal: true };
	}

	onProgress?.({ phase: "extracting", message: "Extracting archive..." });
	const extracted = await extractArchive(source.path);
	const stagedDir = resolveStagedDir(extracted.extractDir);
	return { extractDir: extracted.extractDir, stagedDir, isLocal: false };
}

/**
 * Download and apply a Quarto brand to a project.
 *
 * Downloads/extracts the source, finds the brand YAML file, extracts referenced
 * asset paths, and copies the brand file (renamed to _brand.yml) plus assets
 * into the project's _brand/ directory.
 *
 * @param source - Brand source (string or InstallSource)
 * @param options - Use brand options
 * @returns Use brand result
 *
 * @example
 * ```typescript
 * const result = await useBrand("mcanouil/quarto-mcanouil", {
 *   projectDir: "/path/to/project",
 *   onProgress: ({ phase, message }) => console.log(`[${phase}] ${message}`),
 * });
 * ```
 */
export async function useBrand(source: string | InstallSource, options: UseBrandOptions): Promise<UseBrandResult> {
	const { projectDir, confirmOverwrite, cleanupExtra, onProgress } = options;
	const installSource = typeof source === "string" ? parseInstallSource(source) : source;
	const sourceString = formatInstallSource(installSource);

	let extractDir: string | undefined;
	let isLocal = false;

	try {
		// Step 1: Download and extract.
		const staged = await stageBrandSource(installSource, options);
		extractDir = staged.extractDir;
		isLocal = staged.isLocal;

		// Step 2: Find brand file.
		onProgress?.({ phase: "detecting", message: "Searching for brand file..." });
		const brandInfo = findBrandFile(staged.stagedDir);

		if (!brandInfo) {
			throw new ExtensionError("No brand file found in source", {
				suggestion:
					"Ensure the source contains _brand.yml or a brand extension with contributes.metadata.project.brand.",
			});
		}

		// Step 3: Extract referenced file paths.
		const referencedPaths = extractBrandFilePaths(brandInfo.brandFilePath, (warning) => {
			onProgress?.({ phase: "detecting", message: warning });
		});

		// Step 4: Build file copy list.
		// The brand file itself (will be renamed to _brand.yml).
		// Referenced assets maintain their relative paths from the brand file directory.
		const filesToCopy: { sourcePath: string; targetRel: string }[] = [];

		filesToCopy.push({
			sourcePath: brandInfo.brandFilePath,
			targetRel: "_brand.yml",
		});

		// Step 5: Determine target directory.
		const brandDir = path.resolve(projectDir, "_brand");

		for (const refPath of referencedPaths) {
			// Normalise to forward slashes for consistent comparison across platforms.
			const normalisedRefPath = refPath.replace(/\\/g, "/");

			// Validate that the referenced path does not escape the target directory.
			// Uses path.relative() for robust cross-platform traversal detection
			// (handles UNC paths, drive letter casing, etc.).
			const resolvedTarget = path.resolve(brandDir, normalisedRefPath);
			const relativeTarget = path.relative(brandDir, resolvedTarget);
			if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
				onProgress?.({ phase: "detecting", message: `Skipping unsafe path: ${refPath}.` });
				continue;
			}

			// Also verify the resolved source path stays within brandFileDir to prevent
			// reading files outside the staged source via path traversal.
			const sourcePath = path.resolve(brandInfo.brandFileDir, normalisedRefPath);
			const relativeSource = path.relative(brandInfo.brandFileDir, sourcePath);
			if (relativeSource.startsWith("..") || path.isAbsolute(relativeSource)) {
				onProgress?.({ phase: "detecting", message: `Skipping unsafe path: ${refPath}.` });
				continue;
			}

			if (fs.existsSync(sourcePath)) {
				filesToCopy.push({
					sourcePath,
					targetRel: normalisedRefPath,
				});
			}
		}

		// Step 6: Check for existing files and confirm overwrite.
		const existingFileSet = new Set<string>();
		for (const file of filesToCopy) {
			const targetPath = path.join(brandDir, file.targetRel);
			if (fs.existsSync(targetPath)) {
				existingFileSet.add(file.targetRel);
			}
		}

		// Determine whether to overwrite existing files.
		// - If confirmOverwrite is provided: ask the user.
		// - If confirmOverwrite is not provided: skip existing files (safe default).
		// When the user declines overwrite, only existing files are skipped;
		// new (non-conflicting) files are still created.
		let shouldOverwrite = false;
		if (existingFileSet.size > 0) {
			if (confirmOverwrite) {
				shouldOverwrite = await confirmOverwrite([...existingFileSet]);
			} else {
				onProgress?.({
					phase: "copying",
					message: `${existingFileSet.size} existing file(s) will be skipped (no overwrite callback provided).`,
				});
			}
		}

		// Step 7: Copy files.
		onProgress?.({ phase: "copying", message: "Copying brand files..." });

		const created: string[] = [];
		const overwritten: string[] = [];
		const skipped: string[] = [];

		for (const file of filesToCopy) {
			const targetPath = path.join(brandDir, file.targetRel);
			const targetDir = path.dirname(targetPath);

			await fs.promises.mkdir(targetDir, { recursive: true });

			const exists = existingFileSet.has(file.targetRel);
			if (exists && !shouldOverwrite) {
				skipped.push(file.targetRel);
				onProgress?.({
					phase: "copying",
					message: `Skipped ${file.targetRel} (already exists).`,
					file: file.targetRel,
				});
				continue;
			}

			await fs.promises.copyFile(file.sourcePath, targetPath);
			onProgress?.({ phase: "copying", message: `Copied ${file.targetRel}.`, file: file.targetRel });

			if (exists) {
				overwritten.push(file.targetRel);
			} else {
				created.push(file.targetRel);
			}
		}

		// Step 8: Handle extra files in _brand/ not in source.
		const cleaned: string[] = [];
		if (fs.existsSync(brandDir)) {
			const sourceFileSet = new Set(filesToCopy.map((f) => f.targetRel.replace(/\\/g, "/")));
			const extras = await findExtraFiles(brandDir, sourceFileSet);

			if (extras.length > 0 && cleanupExtra) {
				const shouldClean = await cleanupExtra(extras);
				if (shouldClean) {
					for (const extra of extras) {
						// extras use forward slashes (via path.posix); path.join
						// normalises to OS separators before passing to unlink.
						const extraPath = path.join(brandDir, extra);
						try {
							await fs.promises.unlink(extraPath);
							cleaned.push(extra);
						} catch {
							// Best-effort removal.
						}
					}
					await cleanupEmptyDirs(brandDir);
				}
			}
		}

		return {
			success: true,
			created,
			overwritten,
			skipped,
			cleaned,
			source: sourceString,
		};
	} finally {
		// Clean up temporary extraction directory (skip for local directories).
		if (extractDir && !isLocal) {
			await cleanupExtraction(extractDir);
		}
	}
}
