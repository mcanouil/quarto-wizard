/**
 * Unified archive extraction.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { ExtensionError } from "../errors.js";
import { extractZip, type ZipExtractOptions } from "./zip.js";
import { extractTar, type TarExtractOptions } from "./tar.js";

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

  if (
    lower.endsWith(".tar.gz") ||
    lower.endsWith(".tgz") ||
    lower.endsWith(".tar")
  ) {
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
export async function extractArchive(
  archivePath: string,
  options: ExtractOptions = {}
): Promise<ExtractResult> {
  const format = detectArchiveFormat(archivePath);

  if (!format) {
    throw new ExtensionError(
      `Unsupported archive format: ${path.basename(archivePath)}`,
      "Supported formats: .zip, .tar.gz, .tgz"
    );
  }

  const extractDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "quarto-ext-")
  );

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
 * Find the extension root in an extracted archive.
 *
 * GitHub archives typically have a top-level directory like "repo-tag/".
 * This function finds the directory containing _extension.yml.
 *
 * @param extractDir - Extraction directory
 * @returns Path to extension root or null if not found
 */
export async function findExtensionRoot(extractDir: string): Promise<string | null> {
  const manifestNames = ["_extension.yml", "_extension.yaml"];

  for (const name of manifestNames) {
    const directPath = path.join(extractDir, name);
    if (fs.existsSync(directPath)) {
      return extractDir;
    }
  }

  const entries = await fs.promises.readdir(extractDir, { withFileTypes: true });
  const directories = entries.filter((e) => e.isDirectory());

  for (const dir of directories) {
    const dirPath = path.join(extractDir, dir.name);

    for (const name of manifestNames) {
      const manifestPath = path.join(dirPath, name);
      if (fs.existsSync(manifestPath)) {
        return dirPath;
      }
    }
  }

  for (const dir of directories) {
    const subRoot = await findExtensionRoot(path.join(extractDir, dir.name));
    if (subRoot) {
      return subRoot;
    }
  }

  return null;
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
    // Ignore cleanup errors
  }
}
