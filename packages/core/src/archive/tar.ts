/**
 * TAR.GZ archive extraction with security checks.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as tar from "tar";
import { SecurityError } from "../errors.js";

/** Default maximum extraction size: 100 MB. */
const DEFAULT_MAX_SIZE = 100 * 1024 * 1024;

/**
 * Options for TAR extraction.
 */
export interface TarExtractOptions {
  /** Maximum total extraction size in bytes. */
  maxSize?: number;
  /** Progress callback. */
  onProgress?: (file: string) => void;
}

/**
 * Check for path traversal attempts.
 */
function checkPathTraversal(filePath: string): void {
  const normalised = path.normalize(filePath);

  if (normalised.includes("..") || path.isAbsolute(normalised)) {
    throw new SecurityError(
      `Path traversal detected in archive: "${filePath}"`
    );
  }
}

/**
 * Extract a TAR.GZ archive to a directory.
 *
 * @param archivePath - Path to the TAR.GZ file
 * @param destDir - Destination directory
 * @param options - Extraction options
 * @returns List of extracted file paths
 */
export async function extractTar(
  archivePath: string,
  destDir: string,
  options: TarExtractOptions = {}
): Promise<string[]> {
  const { maxSize = DEFAULT_MAX_SIZE, onProgress } = options;

  await fs.promises.mkdir(destDir, { recursive: true });

  const extractedFiles: string[] = [];
  let totalSize = 0;

  await tar.extract({
    file: archivePath,
    cwd: destDir,
    filter: (entryPath) => {
      checkPathTraversal(entryPath);
      return true;
    },
    onReadEntry: (entry) => {
      totalSize += entry.size ?? 0;

      if (totalSize > maxSize) {
        throw new SecurityError(
          `Archive exceeds maximum size: ${formatSize(totalSize)} > ${formatSize(maxSize)}`
        );
      }

      const entryPath = entry.path;
      if (entry.type === "File" || entry.type === "ContiguousFile") {
        extractedFiles.push(path.join(destDir, entryPath));
        onProgress?.(entryPath);
      }
    },
  });

  return extractedFiles;
}

/**
 * Format size for display.
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
