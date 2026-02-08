/**
 * @title ZIP Archive Extraction Module
 * @description ZIP archive extraction with security checks.
 *
 * Includes protection against path traversal and zip bomb attacks.
 *
 * @module archive
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as unzipper from "unzipper";
import { SecurityError } from "../errors.js";
import { checkPathTraversal, formatSize, DEFAULT_MAX_SIZE, MAX_COMPRESSION_RATIO, MAX_FILE_COUNT } from "./security.js";

/**
 * Options for ZIP extraction.
 */
export interface ZipExtractOptions {
	/** Maximum total extraction size in bytes. */
	maxSize?: number;
	/** Progress callback. */
	onProgress?: (file: string) => void;
}

/**
 * Extract a ZIP archive to a directory.
 *
 * @param archivePath - Path to the ZIP file
 * @param destDir - Destination directory
 * @param options - Extraction options
 * @returns List of extracted file paths
 */
export async function extractZip(
	archivePath: string,
	destDir: string,
	options: ZipExtractOptions = {},
): Promise<string[]> {
	const { maxSize = DEFAULT_MAX_SIZE, onProgress } = options;

	const stats = await fs.promises.stat(archivePath);
	const compressedSize = stats.size;

	const directory = await unzipper.Open.file(archivePath);

	if (directory.files.length > MAX_FILE_COUNT) {
		throw new SecurityError(
			`Archive contains too many entries: ${directory.files.length} > ${MAX_FILE_COUNT}. This may indicate a file bomb.`,
		);
	}

	let totalUncompressedSize = 0;
	for (const file of directory.files) {
		checkPathTraversal(file.path);

		totalUncompressedSize += file.uncompressedSize;

		if (totalUncompressedSize > maxSize) {
			throw new SecurityError(
				`Archive exceeds maximum size: ${formatSize(totalUncompressedSize)} > ${formatSize(maxSize)}`,
			);
		}
	}

	if (compressedSize > 0) {
		const ratio = totalUncompressedSize / compressedSize;
		if (ratio > MAX_COMPRESSION_RATIO) {
			throw new SecurityError(
				`Suspicious compression ratio detected: ${ratio.toFixed(1)}:1. ` + "This may indicate a zip bomb.",
			);
		}
	}

	await fs.promises.mkdir(destDir, { recursive: true });

	const extractedFiles: string[] = [];

	let extractedSize = 0;

	for (const file of directory.files) {
		const destPath = path.join(destDir, file.path);

		if (file.type === "Directory") {
			await fs.promises.mkdir(destPath, { recursive: true });
			continue;
		}

		// Reject symlinks: the Unix mode is stored in the upper 16 bits of externalFileAttributes.
		const unixMode = (file.externalFileAttributes >>> 16) & 0xffff;
		const isSymlink = (unixMode & 0o170000) === 0o120000;
		if (isSymlink) {
			throw new SecurityError(`Archive contains a symbolic link ("${file.path}"), which is not permitted.`);
		}

		const dir = path.dirname(destPath);
		await fs.promises.mkdir(dir, { recursive: true });

		onProgress?.(file.path);

		const content = await file.buffer();

		// Incremental size check using actual extracted content size
		extractedSize += content.length;
		if (extractedSize > maxSize) {
			throw new SecurityError(`Archive exceeds maximum size: ${formatSize(extractedSize)} > ${formatSize(maxSize)}`);
		}

		await fs.promises.writeFile(destPath, content);

		extractedFiles.push(destPath);
	}

	return extractedFiles;
}
