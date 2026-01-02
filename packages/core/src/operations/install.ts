/**
 * @title Extension Installation Module
 * @description Extension installation operations.
 *
 * Handles installing extensions from GitHub, URLs, and local sources.
 *
 * @module operations
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { AuthConfig } from "../types/auth.js";
import type { ExtensionId, VersionSpec } from "../types/extension.js";
import type { ExtensionManifest } from "../types/manifest.js";
import { parseExtensionId, parseExtensionRef } from "../types/extension.js";
import { ExtensionError } from "../errors.js";
import { getExtensionInstallPath, type InstalledExtension } from "../filesystem/discovery.js";
import { copyDirectory, collectFiles } from "../filesystem/walk.js";
import { readManifest, updateManifestSource } from "../filesystem/manifest.js";
import { downloadGitHubArchive, downloadFromUrl } from "../github/download.js";
import { extractArchive, findExtensionRoot, cleanupExtraction } from "../archive/extract.js";
import { fetchRegistry, type RegistryOptions } from "../registry/fetcher.js";

/**
 * Source for extension installation.
 */
export type InstallSource =
	| { type: "github"; owner: string; repo: string; version: VersionSpec }
	| { type: "url"; url: string }
	| { type: "local"; path: string };

/**
 * Progress phases for installation.
 */
export type InstallPhase = "resolving" | "downloading" | "extracting" | "installing" | "finalizing";

/**
 * Progress callback for installation.
 */
export type InstallProgressCallback = (progress: { phase: InstallPhase; message: string; percentage?: number }) => void;

/**
 * Options for extension installation.
 */
export interface InstallOptions extends RegistryOptions {
	/** Project directory. */
	projectDir: string;
	/** Authentication configuration. */
	auth?: AuthConfig;
	/** Progress callback. */
	onProgress?: InstallProgressCallback;
	/** Force reinstall if already installed. */
	force?: boolean;
	/** Keep source directory after installation (for template copying). */
	keepSourceDir?: boolean;
	/** Dry run mode - resolve without installing. */
	dryRun?: boolean;
	/** Display source to record in manifest (for relative paths that were resolved). */
	sourceDisplay?: string;
}

/**
 * Result of installation.
 */
export interface InstallResult {
	/** Whether installation succeeded. */
	success: boolean;
	/** Installed extension details. */
	extension: InstalledExtension;
	/** Files created during installation. */
	filesCreated: string[];
	/** Source string for the manifest. */
	source: string;
	/** Path to extracted source root (only set if keepSourceDir was true). */
	sourceRoot?: string;
	/** Whether this was a dry run (no files were actually created). */
	dryRun?: boolean;
	/** Files that would be created (only set in dry run mode). */
	wouldCreate?: string[];
	/** Whether the extension already exists (only relevant in dry run mode). */
	alreadyExists?: boolean;
}

/**
 * Parse an install source string.
 *
 * @param input - Source string (GitHub ref, URL, or local path)
 * @returns Parsed InstallSource
 *
 * @example
 * ```typescript
 * // GitHub reference
 * parseInstallSource("quarto-ext/fontawesome");
 * // { type: "github", owner: "quarto-ext", repo: "fontawesome", version: { type: "latest" } }
 *
 * // GitHub with version
 * parseInstallSource("quarto-ext/lightbox@v1.0.0");
 * // { type: "github", ..., version: { type: "tag", tag: "v1.0.0" } }
 *
 * // URL
 * parseInstallSource("https://example.com/ext.zip");
 * // { type: "url", url: "https://example.com/ext.zip" }
 *
 * // Local path
 * parseInstallSource("./my-extension");
 * // { type: "local", path: "./my-extension" }
 * ```
 */
export function parseInstallSource(input: string): InstallSource {
	// HTTP/HTTPS URLs
	if (input.startsWith("http://") || input.startsWith("https://")) {
		return { type: "url", url: input };
	}

	// file:// protocol - strip protocol and treat as local path
	if (input.startsWith("file://")) {
		return { type: "local", path: input.slice(7) };
	}

	// Unix absolute paths
	if (input.startsWith("/")) {
		return { type: "local", path: input };
	}

	// Unix relative paths
	if (input.startsWith("./") || input.startsWith("../")) {
		return { type: "local", path: input };
	}

	// Tilde expansion (Unix home directory)
	if (input.startsWith("~/")) {
		return { type: "local", path: input };
	}

	// Windows absolute paths (C:\, D:/, etc.)
	if (/^[a-zA-Z]:[/\\]/.test(input)) {
		return { type: "local", path: input };
	}

	// Windows UNC paths (\\server\share)
	if (input.startsWith("\\\\")) {
		return { type: "local", path: input };
	}

	// Archive file extensions (zip, tar.gz, tgz) - treat as local paths
	// This handles cases like "quarto-test-main.zip" or "subdirectory/extension.tar.gz"
	if (/\.(zip|tar\.gz|tgz)$/i.test(input)) {
		return { type: "local", path: input };
	}

	// Filesystem existence check (fallback)
	if (fs.existsSync(input)) {
		return { type: "local", path: input };
	}

	const ref = parseExtensionRef(input);

	if (!ref.id.owner) {
		throw new ExtensionError(
			`Invalid extension reference: "${input}"`,
			'Use format "owner/repo" or "owner/repo@version"',
		);
	}

	return {
		type: "github",
		owner: ref.id.owner,
		repo: ref.id.name,
		version: ref.version,
	};
}

/**
 * Format an install source as a string.
 */
export function formatInstallSource(source: InstallSource): string {
	switch (source.type) {
		case "github": {
			const base = `${source.owner}/${source.repo}`;
			if (source.version.type === "latest") {
				return base;
			}
			if (source.version.type === "tag") {
				return `${base}@${source.version.tag}`;
			}
			if (source.version.type === "branch") {
				return `${base}@${source.version.branch}`;
			}
			if (source.version.type === "exact") {
				return `${base}@v${source.version.version}`;
			}
			if (source.version.type === "commit") {
				return `${base}@${source.version.commit.substring(0, 7)}`;
			}
			return base;
		}
		case "url":
			return source.url;
		case "local":
			return source.path;
	}
}

/**
 * Install an extension from a source.
 *
 * @param source - Installation source
 * @param options - Installation options
 * @returns Installation result
 *
 * @example
 * ```typescript
 * // Install from GitHub
 * const source = parseInstallSource("quarto-ext/fontawesome");
 * const result = await install(source, { projectDir: "." });
 * console.log(`Installed ${result.extension.id.name}`);
 *
 * // Install with progress tracking
 * await install(source, {
 *   projectDir: ".",
 *   onProgress: ({ phase, message }) => console.log(`[${phase}] ${message}`),
 * });
 * ```
 */
export async function install(source: InstallSource, options: InstallOptions): Promise<InstallResult> {
	const { projectDir, auth, onProgress, force = false, keepSourceDir = false, dryRun = false, sourceDisplay } = options;

	let archivePath: string | undefined;
	let extractDir: string | undefined;
	let tagName: string | undefined;
	let repoRoot: string | undefined;
	let commitSha: string | undefined;

	try {
		onProgress?.({ phase: "resolving", message: "Resolving extension source..." });

		if (source.type === "github") {
			// Try to get registry info for default branch and latest commit
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
				// Registry fetch failed, use defaults
			}

			const result = await downloadGitHubArchive(source.owner, source.repo, source.version, {
				auth,
				defaultBranch,
				latestCommit,
				onProgress: (p) => {
					onProgress?.({
						phase: p.phase === "resolving" ? "resolving" : "downloading",
						message: p.message,
						percentage: p.percentage,
					});
				},
			});
			archivePath = result.archivePath;
			tagName = result.tagName;
			commitSha = result.commitSha;
		} else if (source.type === "url") {
			onProgress?.({ phase: "downloading", message: "Downloading archive..." });
			archivePath = await downloadFromUrl(source.url, { auth });
		} else {
			archivePath = source.path;
		}

		onProgress?.({ phase: "extracting", message: "Extracting archive..." });

		const archiveStats = await fs.promises.stat(archivePath);
		if (source.type === "local" && archiveStats.isDirectory()) {
			extractDir = archivePath;
		} else {
			const extracted = await extractArchive(archivePath);
			extractDir = extracted.extractDir;
		}

		const extensionRoot = await findExtensionRoot(extractDir);

		if (!extensionRoot) {
			throw new ExtensionError(
				"No _extension.yml found in archive",
				"Ensure the archive contains a valid Quarto extension",
			);
		}

		// Compute repo root from extensionRoot
		// extensionRoot is like /tmp/xxx/owner-repo-tag/_extensions/owner/name
		// Repo root is the parent of _extensions (e.g., /tmp/xxx/owner-repo-tag)
		const extensionRootParts = extensionRoot.split(path.sep);
		const extensionsIndex = extensionRootParts.lastIndexOf("_extensions");
		if (extensionsIndex >= 0) {
			repoRoot = extensionRootParts.slice(0, extensionsIndex).join(path.sep) || "/";
		} else {
			// No _extensions in path, extension is at repo root level
			repoRoot = path.dirname(extensionRoot);
		}

		const manifestResult = readManifest(extensionRoot);

		if (!manifestResult) {
			throw new ExtensionError("Failed to read extension manifest");
		}

		onProgress?.({ phase: "installing", message: dryRun ? "Checking installation..." : "Installing extension..." });

		const extensionId = resolveExtensionId(source, extensionRoot, manifestResult.manifest);
		const targetDir = getExtensionInstallPath(projectDir, extensionId);
		// Use sourceDisplay if provided (for relative paths that were resolved), otherwise format from source
		const sourceString = sourceDisplay ?? formatSourceString(source, tagName, commitSha);
		const alreadyExists = fs.existsSync(targetDir);

		// In dry-run mode, return what would happen without making changes
		if (dryRun) {
			// Collect files that would be created
			const wouldCreate = await collectExtensionFiles(extensionRoot);
			const manifestPath = path.join(targetDir, manifestResult.filename);

			return {
				success: true,
				extension: {
					id: extensionId,
					manifest: manifestResult.manifest,
					manifestPath,
					directory: targetDir,
				},
				filesCreated: [],
				source: sourceString,
				sourceRoot: keepSourceDir ? repoRoot : undefined,
				dryRun: true,
				wouldCreate,
				alreadyExists,
			};
		}

		if (alreadyExists) {
			if (!force) {
				throw new ExtensionError(
					`Extension already installed: ${extensionId.owner}/${extensionId.name}`,
					"Use force option to reinstall",
				);
			}
			await fs.promises.rm(targetDir, { recursive: true, force: true });
		}

		// Transaction-like semantics: if manifest update fails after copying,
		// we clean up the partially installed extension to avoid inconsistent state.
		let filesCreated: string[];
		try {
			filesCreated = await copyExtension(extensionRoot, targetDir);

			onProgress?.({ phase: "finalizing", message: "Updating manifest..." });

			const manifestPath = path.join(targetDir, manifestResult.filename);
			updateManifestSource(manifestPath, sourceString);
		} catch (error) {
			// Rollback: remove partially installed extension to maintain consistency.
			// This ensures we don't leave an extension directory without proper metadata.
			await fs.promises.rm(targetDir, { recursive: true, force: true }).catch(() => {});
			throw error;
		}

		const manifestPath = path.join(targetDir, manifestResult.filename);
		const finalManifest = readManifest(targetDir);

		return {
			success: true,
			extension: {
				id: extensionId,
				manifest: finalManifest?.manifest ?? manifestResult.manifest,
				manifestPath,
				directory: targetDir,
			},
			filesCreated,
			source: sourceString,
			sourceRoot: keepSourceDir ? repoRoot : undefined,
		};
	} finally {
		if (archivePath && source.type !== "local" && fs.existsSync(archivePath)) {
			// Cleanup is best-effort; archive deletion failure is non-critical since
			// it's in a temp directory that will be cleaned up eventually by the OS
			await fs.promises.unlink(archivePath).catch(() => {});
		}

		// Only cleanup extraction directory if keepSourceDir is false
		if (extractDir && source.type !== "local" && !keepSourceDir) {
			await cleanupExtraction(extractDir);
		}
	}
}

/**
 * Resolve extension ID from source and manifest.
 * @internal Exported for testing purposes.
 */
export function resolveExtensionId(
	source: InstallSource,
	extensionRoot: string,
	_manifest: ExtensionManifest,
): ExtensionId {
	if (source.type === "github") {
		return { owner: source.owner, name: source.repo };
	}

	// Parse the path to find owner/name structure relative to _extensions
	const pathParts = extensionRoot.split(path.sep);
	const extensionsIndex = pathParts.lastIndexOf("_extensions");

	if (extensionsIndex >= 0) {
		const partsAfterExtensions = pathParts.slice(extensionsIndex + 1);

		if (partsAfterExtensions.length >= 2) {
			// Structure: _extensions/owner/name
			const owner = partsAfterExtensions[0];
			const name = partsAfterExtensions[partsAfterExtensions.length - 1];
			if (owner && !owner.startsWith(".")) {
				return { owner, name };
			}
		}

		// Structure: _extensions/name (no owner)
		if (partsAfterExtensions.length === 1) {
			const name = partsAfterExtensions[0];
			return { owner: null, name };
		}
	}

	// No _extensions in path - invalid extension source
	throw new ExtensionError(
		"Invalid extension structure: missing _extensions directory",
		"Extension source must contain _extensions/owner/name or _extensions/name structure",
	);
}

/**
 * Format source string for manifest.
 */
function formatSourceString(source: InstallSource, tagName?: string, commitSha?: string): string {
	if (source.type === "github") {
		const base = `${source.owner}/${source.repo}`;
		// If we resolved to a commit (no releases), use short commit format
		if (commitSha) {
			return `${base}@${commitSha}`;
		}
		return tagName && tagName !== "HEAD" ? `${base}@${tagName}` : base;
	}

	return formatInstallSource(source);
}

/**
 * Copy extension files to target directory.
 */
async function copyExtension(sourceDir: string, targetDir: string): Promise<string[]> {
	return copyDirectory(sourceDir, targetDir);
}

/**
 * Collect extension files for dry-run preview.
 * Returns relative paths that would be created.
 */
async function collectExtensionFiles(sourceDir: string): Promise<string[]> {
	const absolutePaths = await collectFiles(sourceDir);
	return absolutePaths.map((p) => path.relative(sourceDir, p));
}
