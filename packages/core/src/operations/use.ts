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

/**
 * Default patterns to exclude when copying templates.
 */
const DEFAULT_EXCLUDE_PATTERNS = [
  "_extensions/**",
  ".git/**",
  ".github/**",
  ".gitignore",
  ".gitattributes",
  "node_modules/**",
  ".DS_Store",
  "Thumbs.db",
  "*.log",
  "*.bak",
  "*.tmp",
  ".vscode/**",
  ".idea/**",
];

/**
 * Callback for confirming file overwrites.
 */
export type OverwriteCallback = (file: string) => Promise<boolean>;

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
  /** Callback to confirm overwrites. */
  confirmOverwrite?: OverwriteCallback;
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
    onProgress,
  } = options;

  const installSource = typeof source === "string" ? parseInstallSource(source) : source;

  onProgress?.({ phase: "installing", message: "Installing extension..." });

  const installResult = await install(installSource, {
    projectDir,
    auth,
    force: true,
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

  onProgress?.({ phase: "copying", message: "Copying template files..." });

  const { templateFiles, skippedFiles } = await copyTemplateFiles(
    installResult.extension.directory,
    projectDir,
    {
      include,
      exclude: [...DEFAULT_EXCLUDE_PATTERNS, ...exclude],
      confirmOverwrite,
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
}

/**
 * Options for copying template files.
 */
interface CopyTemplateOptions {
  /** Patterns to include. */
  include?: string[];
  /** Patterns to exclude. */
  exclude: string[];
  /** Callback to confirm overwrites. */
  confirmOverwrite?: OverwriteCallback;
  /** Progress callback. */
  onProgress?: (file: string) => void;
}

/**
 * Copy template files from extension to project.
 */
async function copyTemplateFiles(
  extensionDir: string,
  projectDir: string,
  options: CopyTemplateOptions
): Promise<{ templateFiles: string[]; skippedFiles: string[] }> {
  const { include, exclude, confirmOverwrite, onProgress } = options;

  const parentDir = path.dirname(extensionDir);

  let sourceDir: string;
  let files: string[];

  const parentFiles = await glob("**/*", {
    cwd: parentDir,
    nodir: true,
    dot: false,
    ignore: exclude,
  });

  const extensionName = path.basename(extensionDir);
  const extensionFiles = parentFiles.filter((f) =>
    f.startsWith(`${extensionName}/`)
  );

  if (extensionFiles.length === parentFiles.length) {
    sourceDir = extensionDir;
    files = await glob("**/*", {
      cwd: extensionDir,
      nodir: true,
      dot: false,
      ignore: exclude,
    });
  } else {
    sourceDir = parentDir;
    files = parentFiles.filter(
      (f) => !f.startsWith(`${extensionName}/`) && !f.startsWith("_extensions/")
    );
  }

  if (files.length === 0) {
    return { templateFiles: [], skippedFiles: [] };
  }

  if (include && include.length > 0) {
    files = files.filter((f) => include.some((pattern) => minimatch(f, pattern)));
  }

  const templateFiles: string[] = [];
  const skippedFiles: string[] = [];

  for (const file of files) {
    const sourcePath = path.join(sourceDir, file);
    const targetPath = path.join(projectDir, file);

    if (fs.existsSync(targetPath)) {
      if (confirmOverwrite) {
        const shouldOverwrite = await confirmOverwrite(file);

        if (!shouldOverwrite) {
          skippedFiles.push(file);
          continue;
        }
      } else {
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
 * Get list of template files that would be copied.
 *
 * @param extensionDir - Extension directory
 * @param exclude - Patterns to exclude
 * @returns List of template file paths
 */
export async function getTemplateFiles(
  extensionDir: string,
  exclude: string[] = DEFAULT_EXCLUDE_PATTERNS
): Promise<string[]> {
  const parentDir = path.dirname(extensionDir);

  const parentFiles = await glob("**/*", {
    cwd: parentDir,
    nodir: true,
    dot: false,
    ignore: exclude,
  });

  const extensionName = path.basename(extensionDir);

  return parentFiles.filter(
    (f) => !f.startsWith(`${extensionName}/`) && !f.startsWith("_extensions/")
  );
}
