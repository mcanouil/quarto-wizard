/**
 * Extension installation operations.
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
import { validateManifest, type ValidationResult, type ValidationOptions } from "../validation/manifest.js";
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
	/** Dry run mode - resolve and validate without installing. */
	dryRun?: boolean;
	/** Validate manifest before installation. */
	validate?: boolean;
	/** Options for manifest validation (only used if validate is true). */
	validationOptions?: ValidationOptions;
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
	/** Validation result (only set if validate option was true). */
	validation?: ValidationResult;
}

/**
 * Parse an install source string.
 *
 * @param input - Source string (GitHub ref, URL, or local path)
 * @returns Parsed InstallSource
 */
export function parseInstallSource(input: string): InstallSource {
	if (input.startsWith("http://") || input.startsWith("https://")) {
		return { type: "url", url: input };
	}

	if (input.startsWith("/") || input.startsWith("./") || input.startsWith("../")) {
		return { type: "local", path: input };
	}

	if (fs.existsSync(input)) {
		return { type: "local", path: input };
	}

	const ref = parseExtensionRef(input);

	if (!ref.id.owner) {
		throw new ExtensionError(
			`Invalid extension reference: "${input}"`,
			'Use format "owner/repo" or "owner/repo@version"'
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
 */
export async function install(source: InstallSource, options: InstallOptions): Promise<InstallResult> {
	const {
		projectDir,
		auth,
		onProgress,
		force = false,
		keepSourceDir = false,
		dryRun = false,
		validate = false,
		validationOptions,
	} = options;

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

		if (source.type === "local" && fs.statSync(archivePath).isDirectory()) {
			extractDir = archivePath;
		} else {
			const extracted = await extractArchive(archivePath);
			extractDir = extracted.extractDir;
		}

		const extensionRoot = await findExtensionRoot(extractDir);

		if (!extensionRoot) {
			throw new ExtensionError(
				"No _extension.yml found in archive",
				"Ensure the archive contains a valid Quarto extension"
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

		// Run validation if requested
		let validationResult: ValidationResult | undefined;
		if (validate) {
			validationResult = validateManifest(manifestResult.manifest, validationOptions);
			if (!validationResult.valid) {
				throw new ExtensionError(
					`Extension manifest validation failed with ${validationResult.summary.errors} error(s)`,
					validationResult.issues
						.filter((i) => i.severity === "error")
						.map((i) => `${i.field}: ${i.message}`)
						.join("; ")
				);
			}
		}

		onProgress?.({ phase: "installing", message: dryRun ? "Validating installation..." : "Installing extension..." });

		const extensionId = resolveExtensionId(source, extensionRoot, manifestResult.manifest);
		const targetDir = getExtensionInstallPath(projectDir, extensionId);
		const sourceString = formatSourceString(source, tagName, commitSha);
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
				validation: validationResult,
			};
		}

		if (alreadyExists) {
			if (!force) {
				throw new ExtensionError(
					`Extension already installed: ${extensionId.owner}/${extensionId.name}`,
					"Use force option to reinstall"
				);
			}
			await fs.promises.rm(targetDir, { recursive: true, force: true });
		}

		const filesCreated = await copyExtension(extensionRoot, targetDir);

		onProgress?.({ phase: "finalizing", message: "Updating manifest..." });

		const manifestPath = path.join(targetDir, manifestResult.filename);
		updateManifestSource(manifestPath, sourceString);

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
			validation: validationResult,
		};
	} finally {
		if (archivePath && source.type !== "local" && fs.existsSync(archivePath)) {
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
 */
function resolveExtensionId(source: InstallSource, extensionRoot: string, manifest: ExtensionManifest): ExtensionId {
	if (source.type === "github") {
		return { owner: source.owner, name: source.repo };
	}

	const dirName = path.basename(extensionRoot);
	const parentName = path.basename(path.dirname(extensionRoot));

	if (parentName && !parentName.startsWith(".") && !parentName.includes("-")) {
		return { owner: parentName, name: dirName };
	}

	const title = manifest.title.toLowerCase().replace(/[^a-z0-9-]/g, "-");

	return { owner: "local", name: title || dirName };
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
