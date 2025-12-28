/**
 * "Use extension" operation - install + copy template files.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { glob } from "glob";
import { minimatch } from "minimatch";
import type { AuthConfig } from "../types/auth.js";
import { ExtensionError } from "../errors.js";
import {
  install,
  parseInstallSource,
  type InstallSource,
  type InstallResult,
} from "./install.js";
import { cleanupExtraction } from "../archive/extract.js";

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
  // Node/build artifacts
  "node_modules/**",
  // OS files
  ".DS_Store",
  "Thumbs.db",
  // Temporary files
  "*.log",
  "*.bak",
  "*.tmp",
  // IDE files
  ".vscode/**",
  ".idea/**",
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
export type OverwriteBatchCallback = (
  files: string[]
) => Promise<OverwriteBatchResult>;

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
  /** Progress callback. */
  onProgress?: (info: { phase: string; message: string; file?: string }) => void;
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
}

/**
 * Install an extension and optionally copy template files.
 *
 * @param source - Extension source (string or InstallSource)
 * @param options - Use options
 * @returns Use result
 */
export async function use(
  source: string | InstallSource,
  options: UseOptions
): Promise<UseResult> {
  const {
    projectDir,
    auth,
    noTemplate = false,
    include,
    exclude = [],
    confirmOverwrite,
    confirmOverwriteBatch,
    onProgress,
  } = options;

  const installSource = typeof source === "string" ? parseInstallSource(source) : source;

  onProgress?.({ phase: "installing", message: "Installing extension..." });

  // Keep source directory so we can copy template files from the repo root
  const installResult = await install(installSource, {
    projectDir,
    auth,
    force: true,
    keepSourceDir: !noTemplate,
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
    onProgress?.({ phase: "copying", message: "Copying template files..." });

    // Use sourceRoot (the GitHub repo root) for template copying
    const sourceRoot = installResult.sourceRoot;
    if (!sourceRoot) {
      throw new ExtensionError(
        "No source root available for template copying",
        "This may be a bug in the extension installation"
      );
    }

    const { templateFiles, skippedFiles } = await copyTemplateFiles(
      sourceRoot,
      projectDir,
      {
        include,
        exclude: [...DEFAULT_EXCLUDE_PATTERNS, ...exclude],
        confirmOverwrite,
        confirmOverwriteBatch,
        onProgress: (file) => {
          onProgress?.({ phase: "copying", message: `Copying ${file}...`, file });
        },
      }
    );

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
  /** Patterns to include. */
  include?: string[];
  /** Patterns to exclude. */
  exclude: string[];
  /** Callback to confirm overwrites (per-file). */
  confirmOverwrite?: OverwriteCallback;
  /** Callback to confirm overwrites in batch. */
  confirmOverwriteBatch?: OverwriteBatchCallback;
  /** Progress callback. */
  onProgress?: (file: string) => void;
}

/**
 * Copy template files from repo root to project.
 */
async function copyTemplateFiles(
  sourceRoot: string,
  projectDir: string,
  options: CopyTemplateOptions
): Promise<{ templateFiles: string[]; skippedFiles: string[] }> {
  const { include, exclude, confirmOverwrite, confirmOverwriteBatch, onProgress } = options;

  // Glob all files from repo root, excluding patterns
  let files = await glob("**/*", {
    cwd: sourceRoot,
    nodir: true,
    dot: false,
    ignore: exclude,
  });

  if (files.length === 0) {
    return { templateFiles: [], skippedFiles: [] };
  }

  // Filter by include patterns if provided
  if (include && include.length > 0) {
    files = files.filter((f) => include.some((pattern) => minimatch(f, pattern)));
  }

  const templateFiles: string[] = [];
  const skippedFiles: string[] = [];

  // Collect all conflicting files first
  const conflictingFiles: string[] = [];
  for (const file of files) {
    const targetPath = path.join(projectDir, file);
    if (fs.existsSync(targetPath)) {
      conflictingFiles.push(file);
    }
  }

  // Determine which files to overwrite
  let filesToOverwrite: Set<string>;

  if (conflictingFiles.length > 0 && confirmOverwriteBatch) {
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
  for (const file of files) {
    const sourcePath = path.join(sourceRoot, file);
    const targetPath = path.join(projectDir, file);

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
  exclude: string[] = DEFAULT_EXCLUDE_PATTERNS
): Promise<string[]> {
  return await glob("**/*", {
    cwd: sourceRoot,
    nodir: true,
    dot: false,
    ignore: exclude,
  });
}
