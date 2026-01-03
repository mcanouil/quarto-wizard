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

/** Default maximum extraction size: 100 MB. */
const DEFAULT_MAX_SIZE = 100 * 1024 * 1024;

/** Maximum compression ratio allowed. */
const MAX_COMPRESSION_RATIO = 100;

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
 * Check for path traversal attempts.
 */
function checkPathTraversal(filePath: string): void {
	const normalised = path.normalize(filePath);

	if (normalised.includes("..") || path.isAbsolute(normalised)) {
		throw new SecurityError(`Path traversal detected in archive: "${filePath}"`);
	}
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

	for (const file of directory.files) {
		const destPath = path.join(destDir, file.path);

		if (file.type === "Directory") {
			await fs.promises.mkdir(destPath, { recursive: true });
			continue;
		}

		const dir = path.dirname(destPath);
		await fs.promises.mkdir(dir, { recursive: true });

		onProgress?.(file.path);

		const content = await file.buffer();
		await fs.promises.writeFile(destPath, content);

		extractedFiles.push(destPath);
	}

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
