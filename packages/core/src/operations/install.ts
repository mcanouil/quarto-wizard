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
import {
	extractArchive,
	findExtensionRoot,
	findAllExtensionRoots,
	cleanupExtraction,
	type DiscoveredExtension,
} from "../archive/extract.js";
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
 * Callback for selecting which extension(s) to install from a multi-extension source.
 * Called when a repository contains multiple extensions.
 *
 * @param extensions - Array of discovered extensions in the source
 * @returns Selected extensions to install, or null to cancel
 */
export type ExtensionSelectionCallback = (extensions: DiscoveredExtension[]) => Promise<DiscoveredExtension[] | null>;

/**
 * Callback for confirming overwrite when extension already exists.
 *
 * @param extension - The extension that already exists
 * @returns True to overwrite, false to skip/cancel
 */
export type ConfirmOverwriteCallback = (extension: DiscoveredExtension) => Promise<boolean>;

/**
 * Callback for validating Quarto version requirement.
 *
 * @param required - The required Quarto version string from the manifest
 * @param manifest - The extension manifest
 * @returns True to proceed with installation, false to cancel
 */
export type ValidateQuartoVersionCallback = (required: string, manifest: ExtensionManifest) => Promise<boolean>;

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
	/**
	 * Callback for selecting extensions when source contains multiple.
	 * If not provided and source contains multiple extensions, the first one is installed (legacy behaviour).
	 */
	selectExtension?: ExtensionSelectionCallback;
	/**
	 * Callback for confirming overwrite when extension already exists.
	 * Only called when force is true. If not provided, overwrites silently.
	 * Return true to overwrite, false to cancel.
	 */
	confirmOverwrite?: ConfirmOverwriteCallback;
	/**
	 * Callback for validating Quarto version requirement.
	 * Called when the manifest specifies a quartoRequired field.
	 * Return true to proceed, false to cancel.
	 */
	validateQuartoVersion?: ValidateQuartoVersionCallback;
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
	/** Additional extensions installed when multiple were selected (only set when using selectExtension callback). */
	additionalInstalls?: InstallResult[];
	/** Whether the installation was cancelled by user (via callbacks). */
	cancelled?: boolean;
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
		throw new ExtensionError(`Invalid extension reference: "${input}"`, {
			suggestion: 'Use format "owner/repo" or "owner/repo@version"',
		});
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

		// Find all extensions in the archive
		const allExtensions = await findAllExtensionRoots(extractDir);

		if (allExtensions.length === 0) {
			throw new ExtensionError("No _extension.yml found in archive", {
				suggestion: "Ensure the archive contains a valid Quarto extension",
			});
		}

		// When installing from GitHub, use the GitHub owner for all extensions
		// This matches Quarto CLI behaviour where all extensions from a repo
		// are installed under the repository owner's namespace
		if (source.type === "github") {
			for (const ext of allExtensions) {
				ext.id.owner = source.owner;
			}
		}

		// Handle multiple extensions
		let selectedExtensions: DiscoveredExtension[];
		if (allExtensions.length > 1 && options.selectExtension) {
			const selected = await options.selectExtension(allExtensions);
			if (!selected || selected.length === 0) {
				throw new ExtensionError("Extension selection cancelled by user");
			}
			selectedExtensions = selected;
		} else {
			// Single extension or no callback - use all found extensions (for single, just the one)
			selectedExtensions = allExtensions.length === 1 ? allExtensions : [allExtensions[0]];
		}

		// Use the first selected extension as the primary one
		const extensionRoot = selectedExtensions[0].path;

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

		// Validate Quarto version requirement if callback provided
		const quartoRequired = manifestResult.manifest.quartoRequired;
		if (quartoRequired && options.validateQuartoVersion) {
			const proceed = await options.validateQuartoVersion(quartoRequired, manifestResult.manifest);
			if (!proceed) {
				// User cancelled due to version mismatch
				const manifestPath = path.join(
					getExtensionInstallPath(projectDir, selectedExtensions[0].id),
					manifestResult.filename,
				);
				return {
					success: false,
					cancelled: true,
					extension: {
						id: selectedExtensions[0].id,
						manifest: manifestResult.manifest,
						manifestPath,
						directory: getExtensionInstallPath(projectDir, selectedExtensions[0].id),
					},
					filesCreated: [],
					source: sourceDisplay ?? formatSourceString(source, tagName, commitSha),
				};
			}
		}

		onProgress?.({ phase: "installing", message: dryRun ? "Checking installation..." : "Installing extension..." });

		// Use the pre-computed ID from the discovered extension
		// This ensures consistency with additional extensions and respects the directory structure
		const extensionId: ExtensionId = selectedExtensions[0].id;
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
				throw new ExtensionError(`Extension already installed: ${extensionId.owner}/${extensionId.name}`, {
					suggestion: "Use force option to reinstall",
				});
			}
			// If confirmOverwrite callback is provided, ask for confirmation
			if (options.confirmOverwrite) {
				const proceed = await options.confirmOverwrite(selectedExtensions[0]);
				if (!proceed) {
					// User cancelled overwrite
					return {
						success: false,
						cancelled: true,
						extension: {
							id: extensionId,
							manifest: manifestResult.manifest,
							manifestPath: path.join(targetDir, manifestResult.filename),
							directory: targetDir,
						},
						filesCreated: [],
						source: sourceString,
						alreadyExists: true,
					};
				}
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

		// Install additional extensions if multiple were selected
		const additionalInstalls: InstallResult[] = [];
		if (selectedExtensions.length > 1) {
			for (let i = 1; i < selectedExtensions.length; i++) {
				const additionalExt = selectedExtensions[i];
				try {
					const additionalResult = await installSingleExtension(
						additionalExt,
						projectDir,
						sourceDisplay ?? formatSourceString(source, tagName, commitSha),
						force,
						onProgress,
					);
					additionalInstalls.push(additionalResult);
				} catch (error) {
					// Log error but continue with other extensions
					const message = error instanceof Error ? error.message : String(error);
					onProgress?.({ phase: "installing", message: `Failed to install additional extension: ${message}` });
				}
			}
		}

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
			additionalInstalls: additionalInstalls.length > 0 ? additionalInstalls : undefined,
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
 *
 * @internal
 * Exported for testing purposes only. Not part of the public API.
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
	throw new ExtensionError("Invalid extension structure: missing _extensions directory", {
		suggestion: "Extension source must contain _extensions/owner/name or _extensions/name structure",
	});
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

/**
 * Install a single extension from an already-extracted directory.
 * Used for installing additional extensions when multiple are selected,
 * or when installing extensions directly with pre-computed IDs (e.g., from twoPhaseUse).
 *
 * @param extension - Discovered extension with path and pre-computed ID
 * @param projectDir - Project directory to install to
 * @param sourceString - Source string to record in manifest
 * @param force - Whether to force reinstall
 * @param onProgress - Progress callback
 * @returns Installation result
 */
export async function installSingleExtension(
	extension: DiscoveredExtension,
	projectDir: string,
	sourceString: string,
	force: boolean,
	onProgress?: InstallProgressCallback,
): Promise<InstallResult> {
	const manifestResult = readManifest(extension.path);

	if (!manifestResult) {
		throw new ExtensionError("Failed to read extension manifest");
	}

	// Use the pre-computed ID from the discovered extension
	const extensionId: ExtensionId = extension.id;

	const targetDir = getExtensionInstallPath(projectDir, extensionId);
	const alreadyExists = fs.existsSync(targetDir);

	if (alreadyExists) {
		if (!force) {
			throw new ExtensionError(`Extension already installed: ${extensionId.owner}/${extensionId.name}`, {
				suggestion: "Use force option to reinstall",
			});
		}
		await fs.promises.rm(targetDir, { recursive: true, force: true });
	}

	const extIdString = extensionId.owner ? `${extensionId.owner}/${extensionId.name}` : extensionId.name;
	onProgress?.({ phase: "installing", message: `Installing ${extIdString}...` });

	let filesCreated: string[];
	try {
		filesCreated = await copyExtension(extension.path, targetDir);

		const manifestPath = path.join(targetDir, manifestResult.filename);
		updateManifestSource(manifestPath, sourceString);
	} catch (error) {
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
	};
}
