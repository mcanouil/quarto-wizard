/**
 * @title TAR.GZ Archive Extraction Module
 * @description TAR.GZ archive extraction with security checks.
 *
 * Includes protection against path traversal and oversized archives.
 *
 * @module archive
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as tar from "tar";
import { SecurityError } from "../errors.js";
import {
	checkPathTraversal,
	checkSymlinkTarget,
	formatSize,
	DEFAULT_MAX_SIZE,
	MAX_COMPRESSION_RATIO,
	MAX_FILE_COUNT,
} from "./security.js";

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
	options: TarExtractOptions = {},
): Promise<string[]> {
	const { maxSize = DEFAULT_MAX_SIZE, onProgress } = options;

	const stats = await fs.promises.stat(archivePath);
	const compressedSize = stats.size;

	await fs.promises.mkdir(destDir, { recursive: true });

	const extractedFiles: string[] = [];
	let totalSize = 0;
	let entryCount = 0;

	await tar.extract({
		file: archivePath,
		cwd: destDir,
		filter: (entryPath) => {
			checkPathTraversal(entryPath);
			return true;
		},
		onReadEntry: (entry) => {
			entryCount++;
			if (entryCount > MAX_FILE_COUNT) {
				throw new SecurityError(
					`Archive contains too many entries: ${entryCount} > ${MAX_FILE_COUNT}. This may indicate a file bomb.`,
				);
			}

			totalSize += entry.size ?? 0;

			if (totalSize > maxSize) {
				throw new SecurityError(`Archive exceeds maximum size: ${formatSize(totalSize)} > ${formatSize(maxSize)}`);
			}

			// Check compression ratio incrementally to detect tar bombs early.
			if (compressedSize > 0) {
				const ratio = totalSize / compressedSize;
				if (ratio > MAX_COMPRESSION_RATIO) {
					throw new SecurityError(
						`Suspicious compression ratio detected: ${ratio.toFixed(1)}:1. ` + "This may indicate a tar bomb.",
					);
				}
			}

			const entryPath = entry.path;

			// Validate symlink targets stay within the extraction directory.
			if (entry.type === "SymbolicLink" && entry.linkpath) {
				const entryDir = path.resolve(destDir, path.dirname(entryPath));
				checkSymlinkTarget(entry.linkpath, entryDir, destDir);
			}

			if (entry.type === "File" || entry.type === "ContiguousFile") {
				extractedFiles.push(path.join(destDir, entryPath));
				onProgress?.(entryPath);
			}
		},
	});

	return extractedFiles;
}
