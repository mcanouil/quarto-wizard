/**
 * @title Template Use Module
 * @description Use extension operation for installing and copying template files.
 *
 * Combines installation with template file copying for starter templates.
 *
 * @module operations
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { glob } from "glob";
import { minimatch } from "minimatch";
import type { AuthConfig } from "../types/auth.js";
import { ExtensionError } from "../errors.js";
import {
	install,
	installSingleExtension,
	parseInstallSource,
	formatInstallSource,
	type InstallSource,
	type InstallResult,
	type ExtensionSelectionCallback,
} from "./install.js";
import { cleanupExtraction, findAllExtensionRoots, type DiscoveredExtension } from "../archive/extract.js";
import { getExtensionInstallPath } from "../filesystem/discovery.js";

/**
 * Options for globbing files.
 */
interface GlobFilesOptions {
	/** Include hidden files (dot files). */
	includeHidden?: boolean;
	/** Patterns to ignore. */
	ignore?: string[];
}

/**
 * Glob all files in a directory with sensible defaults.
 *
 * @param cwd - Directory to search in
 * @param options - Glob options
 * @returns Array of file paths relative to cwd
 */
async function globFiles(cwd: string, options: GlobFilesOptions = {}): Promise<string[]> {
	const { includeHidden = false, ignore = [] } = options;
	return glob("**/*", {
		cwd,
		nodir: true,
		dot: includeHidden,
		ignore,
	});
}

/**
 * Default patterns to exclude when copying templates.
 * These files are typically repository metadata and should not be copied to the project.
 */
const DEFAULT_EXCLUDE_PATTERNS = [
	// Extension directory (already installed separately)
	"_extensions/**",

	// Git files
	".git/**",
	".github/**",
	".gitignore",
	".gitattributes",

	// Quarto files
	".quartoignore",

	// Documentation (repository-specific)
	"README.md",
	"README.qmd",
	"LICENSE",
	"LICENSE.md",
	"CHANGELOG.md",
	"CONTRIBUTING.md",
	"CODE_OF_CONDUCT.md",
	"CITATION.cff",

	// Node.js
	"node_modules/**",
	"package-lock.json",
	"yarn.lock",
	"pnpm-lock.yaml",

	// Python
	"__pycache__/**",
	"*.pyc",
	"venv/**",
	".venv/**",

	// R
	".Rproj.user/**",
	"renv/**",

	// Build artifacts
	"dist/**",
	"build/**",
	"_site/**",

	// Test/coverage
	"coverage/**",
	".nyc_output/**",

	// OS files
	".DS_Store",
	"Thumbs.db",

	// Temporary/backup files
	"*.log",
	"*.bak",
	"*.tmp",
	"*.swp",
	"*.swo",
	"*~",

	// IDE files
	".vscode/**",
	".idea/**",

	// LLM
	".claude/**",
];

/**
 * Callback for confirming file overwrites (per-file).
 */
export type OverwriteCallback = (file: string) => Promise<boolean>;

/**
 * Result of batch overwrite confirmation.
 * - 'all': Overwrite all files.
 * - 'none': Skip all files.
 * - string[]: List of specific files to overwrite.
 */
export type OverwriteBatchResult = "all" | "none" | string[];

/**
 * Callback for confirming file overwrites in batch.
 * Receives all conflicting files upfront and returns which ones to overwrite.
 */
export type OverwriteBatchCallback = (files: string[]) => Promise<OverwriteBatchResult>;

/**
 * Result of file selection callback.
 */
export interface FileSelectionResult {
	/** Files selected for copying. */
	selectedFiles: string[];
	/** Whether to overwrite existing files without prompting. */
	overwriteExisting: boolean;
}

/**
 * Callback for interactive file selection.
 * Receives all available template files and which ones already exist.
 * Returns which files to copy and whether to overwrite existing.
 */
export type FileSelectionCallback = (
	availableFiles: string[],
	existingFiles: string[],
	defaultExcludePatterns: string[],
) => Promise<FileSelectionResult | null>;

/**
 * Callback for selecting target subdirectory.
 * Returns the subdirectory path or null/empty string for project root.
 */
export type SelectTargetSubdirCallback = () => Promise<string | null>;

/**
 * Options for "use extension" operation.
 */
export interface UseOptions {
	/** Project directory. */
	projectDir: string;
	/** Authentication configuration. */
	auth?: AuthConfig;
	/** Skip template copying. */
	noTemplate?: boolean;
	/** File patterns to include (overrides defaults). */
	include?: string[];
	/** Additional patterns to exclude. */
	exclude?: string[];
	/** Callback to confirm overwrites (per-file). Takes precedence if confirmOverwriteBatch is not provided. */
	confirmOverwrite?: OverwriteCallback;
	/** Callback to confirm overwrites in batch. Receives all conflicting files upfront. Takes precedence over confirmOverwrite. */
	confirmOverwriteBatch?: OverwriteBatchCallback;
	/** Callback for interactive file selection. Takes precedence over include/exclude/confirmOverwrite. */
	selectFiles?: FileSelectionCallback;
	/**
	 * Show file selection before installing extension (default: false).
	 * When true, the extension is only installed if the user confirms file selection.
	 * When false, the extension is installed immediately and then files are selected.
	 */
	selectFilesFirst?: boolean;
	/** Progress callback. */
	onProgress?: (info: { phase: string; message: string; file?: string }) => void;
	/** Dry run mode - resolve and validate without copying files. */
	dryRun?: boolean;
	/** Display source to record in manifest (for relative paths that were resolved). */
	sourceDisplay?: string;
	/**
	 * Callback for selecting extensions when source contains multiple.
	 * If not provided and source contains multiple extensions, the first one is installed.
	 */
	selectExtension?: ExtensionSelectionCallback;
	/**
	 * Callback to confirm overwriting existing extensions.
	 * Called with extensions that already exist in the project.
	 * Returns the extensions to overwrite, or null to cancel.
	 */
	confirmExtensionOverwrite?: (extensions: DiscoveredExtension[]) => Promise<DiscoveredExtension[] | null>;
	/**
	 * Subdirectory within projectDir where template files should be copied.
	 * If selectTargetSubdir callback is provided and selectFilesFirst is true,
	 * the callback takes precedence.
	 */
	targetSubdir?: string;
	/**
	 * Callback for interactive target subdirectory selection.
	 * Called before file selection in two-phase flow.
	 * Returns subdirectory path, or null/empty string for project root.
	 */
	selectTargetSubdir?: SelectTargetSubdirCallback;
}

/**
 * Result of "use extension" operation.
 */
export interface UseResult {
	/** Installation result. */
	install: InstallResult;
	/** Template files copied. */
	templateFiles: string[];
	/** Files skipped due to existing. */
	skippedFiles: string[];
	/** Whether this was a dry run (no files were actually copied). */
	dryRun?: boolean;
	/** Template files that would be copied (only set in dry run mode). */
	wouldCopy?: string[];
	/** Files that would conflict with existing files (only set in dry run mode). */
	wouldConflict?: string[];
	/** Whether the user cancelled the file selection (only set when selectFilesFirst is true). */
	cancelled?: boolean;
}

/**
 * Two-phase use: show file selection before installing.
 *
 * New flow:
 * 1. Download/extract source (dry-run without extension selection).
 * 2. Show file selection dialog.
 * 3. Show extension selection dialog.
 * 4. Show overwrite prompts (for extensions that already exist).
 * 5. Install selected extensions and copy selected files.
 *
 * @param source - Extension source
 * @param options - Use options (must include selectFiles callback)
 * @returns Use result with cancelled flag if user cancelled
 */
async function twoPhaseUse(source: InstallSource, options: UseOptions): Promise<UseResult> {
	const {
		projectDir,
		auth,
		selectFiles,
		selectExtension,
		confirmExtensionOverwrite,
		onProgress,
		sourceDisplay,
		targetSubdir: staticTargetSubdir,
		selectTargetSubdir,
	} = options;

	if (!selectFiles) {
		throw new ExtensionError("selectFiles callback is required for twoPhaseUse");
	}

	// Compute effective source display from original source if not provided.
	// This ensures the original GitHub/URL reference is preserved when Phase 2
	// uses a local path pointing to the extracted temporary directory.
	const effectiveSourceDisplay = sourceDisplay ?? formatInstallSource(source);

	let dryRunResult: InstallResult | null = null;

	try {
		// STEP 1: Download/extract source (dry-run WITHOUT extension selection)
		onProgress?.({ phase: "preparing", message: "Preparing template preview..." });

		dryRunResult = await install(source, {
			projectDir,
			auth,
			force: true,
			keepSourceDir: true,
			dryRun: true,
			sourceDisplay: effectiveSourceDisplay,
			// Do NOT pass selectExtension here - we'll handle it after file selection
			onProgress: (p) => {
				onProgress?.({ phase: p.phase, message: p.message });
			},
		});

		if (!dryRunResult.success || !dryRunResult.sourceRoot) {
			throw new ExtensionError("Failed to prepare template preview");
		}

		const sourceRoot = dryRunResult.sourceRoot;

		// STEP 1.5: Target subdirectory selection (before file selection)
		let effectiveTargetSubdir: string | undefined;
		if (selectTargetSubdir) {
			onProgress?.({ phase: "selecting", message: "Awaiting target directory selection..." });
			const selectedSubdir = await selectTargetSubdir();
			// null or empty string means project root
			effectiveTargetSubdir = selectedSubdir || undefined;
		} else {
			effectiveTargetSubdir = staticTargetSubdir;
		}

		// Compute effective target directory for existing file checks
		const effectiveTargetDir = effectiveTargetSubdir ? path.join(projectDir, effectiveTargetSubdir) : projectDir;

		// STEP 2: File selection
		// Get all available files from extracted source
		const allFiles = await globFiles(sourceRoot, {
			includeHidden: true,
			ignore: ["_extensions/**"],
		});

		// Find which files already exist in the target directory
		const existingFiles: string[] = [];
		for (const file of allFiles) {
			const targetPath = path.join(effectiveTargetDir, file);
			if (fs.existsSync(targetPath)) {
				existingFiles.push(file);
			}
		}

		onProgress?.({ phase: "selecting", message: "Awaiting file selection..." });

		const selectionResult = await selectFiles(
			allFiles,
			existingFiles,
			DEFAULT_EXCLUDE_PATTERNS.filter((p) => p !== "_extensions/**"),
		);

		if (!selectionResult) {
			// User cancelled file selection
			await cleanupExtraction(sourceRoot);
			return {
				install: {
					success: false,
					extension: dryRunResult.extension,
					filesCreated: [],
					source: effectiveSourceDisplay,
				},
				templateFiles: [],
				skippedFiles: allFiles,
				cancelled: true,
			};
		}

		// STEP 3: Extension selection
		// Find all extensions in the extracted source
		const allExtensions = await findAllExtensionRoots(sourceRoot);

		if (allExtensions.length === 0) {
			throw new ExtensionError("No extensions found in source", {
				suggestion: "Ensure the source contains a valid Quarto extension with _extension.yml",
			});
		}

		// Apply GitHub owner to extensions if source is from GitHub
		if (source.type === "github") {
			for (const ext of allExtensions) {
				ext.id.owner = source.owner;
			}
		}

		let selectedExtensions: DiscoveredExtension[];
		if (allExtensions.length > 1 && selectExtension) {
			onProgress?.({ phase: "selecting", message: "Awaiting extension selection..." });
			const selected = await selectExtension(allExtensions);
			if (!selected || selected.length === 0) {
				// User cancelled extension selection
				await cleanupExtraction(sourceRoot);
				return {
					install: {
						success: false,
						extension: dryRunResult.extension,
						filesCreated: [],
						source: effectiveSourceDisplay,
					},
					templateFiles: [],
					skippedFiles: allFiles,
					cancelled: true,
				};
			}
			selectedExtensions = selected;
		} else {
			// Single extension or no callback - use all (for single, just the one)
			selectedExtensions = allExtensions.length === 1 ? allExtensions : [allExtensions[0]];
		}

		// STEP 4: Check for existing extensions and prompt for overwrite
		const existingExtensions: DiscoveredExtension[] = [];
		for (const ext of selectedExtensions) {
			const targetDir = getExtensionInstallPath(projectDir, ext.id);
			if (fs.existsSync(targetDir)) {
				existingExtensions.push(ext);
			}
		}

		let extensionsToInstall = selectedExtensions;
		if (existingExtensions.length > 0 && confirmExtensionOverwrite) {
			onProgress?.({ phase: "confirming", message: "Awaiting overwrite confirmation..." });
			const confirmed = await confirmExtensionOverwrite(existingExtensions);
			if (confirmed === null) {
				// User cancelled overwrite confirmation
				await cleanupExtraction(sourceRoot);
				return {
					install: {
						success: false,
						extension: dryRunResult.extension,
						filesCreated: [],
						source: effectiveSourceDisplay,
					},
					templateFiles: [],
					skippedFiles: allFiles,
					cancelled: true,
				};
			}
			// Filter to only install: non-existing + confirmed overwrites
			const confirmedIds = new Set(confirmed.map((e) => `${e.id.owner}/${e.id.name}`));
			extensionsToInstall = selectedExtensions.filter((ext) => {
				const extId = `${ext.id.owner}/${ext.id.name}`;
				const exists = existingExtensions.some((e) => `${e.id.owner}/${e.id.name}` === extId);
				return !exists || confirmedIds.has(extId);
			});
		}

		// STEP 5: Install selected extensions and copy files
		// Install each extension directly using installSingleExtension to preserve owner info
		let primaryInstallResult: InstallResult | null = null;
		const allFilesCreated: string[] = [];

		if (extensionsToInstall.length > 0) {
			onProgress?.({ phase: "installing", message: "Installing extension(s)..." });

			for (const ext of extensionsToInstall) {
				const extIdString = ext.id.owner ? `${ext.id.owner}/${ext.id.name}` : ext.id.name;
				onProgress?.({ phase: "installing", message: `Installing ${extIdString}...` });

				const result = await installSingleExtension(
					ext,
					projectDir,
					effectiveSourceDisplay,
					true, // force
					(p) => onProgress?.({ phase: p.phase, message: p.message }),
				);

				if (!primaryInstallResult) {
					primaryInstallResult = result;
				}
				allFilesCreated.push(...result.filesCreated);
			}
		}

		// Copy selected template files (ONCE, after all extensions installed)
		// This happens even if no extensions were installed (all skipped)
		onProgress?.({ phase: "copying", message: "Copying template files..." });

		const { templateFiles, skippedFiles } = await copyTemplateFiles(sourceRoot, projectDir, {
			filesToCopy: selectionResult.selectedFiles,
			overwriteAll: selectionResult.overwriteExisting,
			targetSubdir: effectiveTargetSubdir,
			onProgress: (file) => {
				onProgress?.({ phase: "copying", message: `Copying ${file}...`, file });
			},
		});

		// Use primary install result or create a success result if no extensions installed
		const installResult: InstallResult = primaryInstallResult ?? {
			success: true,
			extension: dryRunResult.extension,
			filesCreated: [],
			source: effectiveSourceDisplay,
		};

		return {
			install: { ...installResult, filesCreated: allFilesCreated },
			templateFiles,
			skippedFiles,
		};
	} finally {
		// Clean up the extracted source
		if (dryRunResult?.sourceRoot) {
			await cleanupExtraction(dryRunResult.sourceRoot);
		}
	}
}

/**
 * Install an extension and optionally copy template files.
 *
 * @param source - Extension source (string or InstallSource)
 * @param options - Use options
 * @returns Use result
 */
export async function use(source: string | InstallSource, options: UseOptions): Promise<UseResult> {
	const {
		projectDir,
		auth,
		noTemplate = false,
		include,
		exclude = [],
		confirmOverwrite,
		confirmOverwriteBatch,
		selectFiles,
		selectFilesFirst = false,
		selectExtension,
		onProgress,
		dryRun = false,
		sourceDisplay,
		targetSubdir,
	} = options;

	const installSource = typeof source === "string" ? parseInstallSource(source) : source;

	// Use two-phase flow when selectFilesFirst is enabled
	// This shows file selection before installing, allowing full cancellation
	if (selectFilesFirst && selectFiles && !noTemplate && !dryRun) {
		return twoPhaseUse(installSource, options);
	}

	onProgress?.({ phase: "installing", message: "Installing extension..." });

	// Keep source directory so we can copy template files from the repo root
	const installResult = await install(installSource, {
		projectDir,
		auth,
		force: true,
		keepSourceDir: !noTemplate || dryRun,
		dryRun,
		sourceDisplay,
		selectExtension,
		onProgress: (p) => {
			onProgress?.({ phase: p.phase, message: p.message });
		},
	});

	if (noTemplate) {
		return {
			install: installResult,
			templateFiles: [],
			skippedFiles: [],
		};
	}

	try {
		// Use sourceRoot (the GitHub repo root) for template copying
		const sourceRoot = installResult.sourceRoot;
		if (!sourceRoot) {
			throw new ExtensionError("No source root available for template copying", {
				suggestion: "This may be a bug in the extension installation",
			});
		}

		// Compute effective target directory for template files
		const effectiveTargetDir = targetSubdir ? path.join(projectDir, targetSubdir) : projectDir;

		let filesToCopy: string[];
		let overwriteAll = false;

		if (selectFiles) {
			// Interactive file selection mode
			onProgress?.({ phase: "selecting", message: "Preparing file selection..." });

			// Get all available files (only exclude _extensions/), including hidden files
			const allFiles = await globFiles(sourceRoot, {
				includeHidden: true,
				ignore: ["_extensions/**"],
			});

			// Find which files already exist in the target directory
			const existingFiles: string[] = [];
			for (const file of allFiles) {
				const targetPath = path.join(effectiveTargetDir, file);
				if (fs.existsSync(targetPath)) {
					existingFiles.push(file);
				}
			}

			// Call the selection callback
			const selectionResult = await selectFiles(
				allFiles,
				existingFiles,
				DEFAULT_EXCLUDE_PATTERNS.filter((p) => p !== "_extensions/**"),
			);

			if (!selectionResult) {
				// User cancelled
				return {
					install: installResult,
					templateFiles: [],
					skippedFiles: allFiles,
				};
			}

			filesToCopy = selectionResult.selectedFiles;
			overwriteAll = selectionResult.overwriteExisting;
		} else {
			// Legacy mode: use include/exclude patterns
			filesToCopy = await globFiles(sourceRoot, {
				ignore: [...DEFAULT_EXCLUDE_PATTERNS, ...exclude],
			});

			if (include && include.length > 0) {
				filesToCopy = filesToCopy.filter((f) => include.some((pattern) => minimatch(f, pattern)));
			}
		}

		// In dry-run mode, return what would happen without copying
		if (dryRun) {
			// Find which files would conflict in the target directory
			const wouldConflict: string[] = [];
			for (const file of filesToCopy) {
				const targetPath = path.join(effectiveTargetDir, file);
				if (fs.existsSync(targetPath)) {
					wouldConflict.push(file);
				}
			}

			return {
				install: installResult,
				templateFiles: [],
				skippedFiles: [],
				dryRun: true,
				wouldCopy: filesToCopy,
				wouldConflict,
			};
		}

		onProgress?.({ phase: "copying", message: "Copying template files..." });

		const { templateFiles, skippedFiles } = await copyTemplateFiles(sourceRoot, projectDir, {
			filesToCopy,
			overwriteAll,
			targetSubdir,
			confirmOverwrite: selectFiles ? undefined : confirmOverwrite,
			confirmOverwriteBatch: selectFiles ? undefined : confirmOverwriteBatch,
			onProgress: (file) => {
				onProgress?.({ phase: "copying", message: `Copying ${file}...`, file });
			},
		});

		return {
			install: installResult,
			templateFiles,
			skippedFiles,
		};
	} finally {
		// Clean up the source directory after template copying
		if (installResult.sourceRoot) {
			await cleanupExtraction(installResult.sourceRoot);
		}
	}
}

/**
 * Options for copying template files.
 */
interface CopyTemplateOptions {
	/** Explicit list of files to copy. */
	filesToCopy: string[];
	/** Whether to overwrite all existing files without prompting. */
	overwriteAll?: boolean;
	/** Callback to confirm overwrites (per-file). */
	confirmOverwrite?: OverwriteCallback;
	/** Callback to confirm overwrites in batch. */
	confirmOverwriteBatch?: OverwriteBatchCallback;
	/** Progress callback. */
	onProgress?: (file: string) => void;
	/** Subdirectory within projectDir where files should be copied. */
	targetSubdir?: string;
}

/**
 * Copy template files from repo root to project.
 */
async function copyTemplateFiles(
	sourceRoot: string,
	projectDir: string,
	options: CopyTemplateOptions,
): Promise<{ templateFiles: string[]; skippedFiles: string[] }> {
	const { filesToCopy, overwriteAll, confirmOverwrite, confirmOverwriteBatch, onProgress, targetSubdir } = options;

	if (filesToCopy.length === 0) {
		return { templateFiles: [], skippedFiles: [] };
	}

	// Compute effective target directory
	const effectiveTargetDir = targetSubdir ? path.join(projectDir, targetSubdir) : projectDir;

	const templateFiles: string[] = [];
	const skippedFiles: string[] = [];

	// Collect all conflicting files first
	const conflictingFiles: string[] = [];
	for (const file of filesToCopy) {
		const targetPath = path.join(effectiveTargetDir, file);
		if (fs.existsSync(targetPath)) {
			conflictingFiles.push(file);
		}
	}

	// Determine which files to overwrite
	let filesToOverwrite: Set<string>;

	if (overwriteAll) {
		// Overwrite all existing files
		filesToOverwrite = new Set(conflictingFiles);
	} else if (conflictingFiles.length > 0 && confirmOverwriteBatch) {
		// Use batch confirmation
		const result = await confirmOverwriteBatch(conflictingFiles);
		if (result === "all") {
			filesToOverwrite = new Set(conflictingFiles);
		} else if (result === "none") {
			filesToOverwrite = new Set();
		} else {
			filesToOverwrite = new Set(result);
		}
	} else if (conflictingFiles.length > 0 && confirmOverwrite) {
		// Fall back to per-file confirmation
		filesToOverwrite = new Set();
		for (const file of conflictingFiles) {
			const shouldOverwrite = await confirmOverwrite(file);
			if (shouldOverwrite) {
				filesToOverwrite.add(file);
			}
		}
	} else {
		// No confirmation callback provided, skip all conflicting files
		filesToOverwrite = new Set();
	}

	// Copy files
	for (const file of filesToCopy) {
		const sourcePath = path.join(sourceRoot, file);
		const targetPath = path.join(effectiveTargetDir, file);

		if (fs.existsSync(targetPath)) {
			if (!filesToOverwrite.has(file)) {
				skippedFiles.push(file);
				continue;
			}
		}

		await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
		await fs.promises.copyFile(sourcePath, targetPath);

		templateFiles.push(file);
		onProgress?.(file);
	}

	return { templateFiles, skippedFiles };
}

/**
 * Get list of template files that would be copied from repo root.
 *
 * @param sourceRoot - Repository root directory
 * @param exclude - Patterns to exclude
 * @returns List of template file paths
 */
export async function getTemplateFiles(
	sourceRoot: string,
	exclude: string[] = DEFAULT_EXCLUDE_PATTERNS,
): Promise<string[]> {
	return globFiles(sourceRoot, { ignore: exclude });
}
