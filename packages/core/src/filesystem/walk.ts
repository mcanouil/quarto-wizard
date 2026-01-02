/**
 * @description Directory walking and file collection utilities.
 *
 * Provides recursive directory traversal and file copying operations.
 *
 * @module filesystem
 */

import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Entry information for directory walking.
 */
export interface WalkEntry {
	/** Full path to the entry. */
	path: string;
	/** Entry name (basename). */
	name: string;
	/** Whether entry is a directory. */
	isDirectory: boolean;
}

/**
 * Callback for directory walking.
 * Return false to skip processing children of a directory.
 */
export type WalkCallback = (entry: WalkEntry) => boolean | void | Promise<boolean | void>;

/**
 * Walk a directory recursively, calling the callback for each entry.
 *
 * @param directory - Directory to walk
 * @param callback - Callback for each entry
 */
export async function walkDirectory(directory: string, callback: WalkCallback): Promise<void> {
	const entries = await fs.promises.readdir(directory, { withFileTypes: true });

	for (const entry of entries) {
		const fullPath = path.join(directory, entry.name);
		const walkEntry: WalkEntry = {
			path: fullPath,
			name: entry.name,
			isDirectory: entry.isDirectory(),
		};

		const result = await callback(walkEntry);

		if (entry.isDirectory() && result !== false) {
			await walkDirectory(fullPath, callback);
		}
	}
}

/**
 * Collect all file paths in a directory recursively.
 *
 * @param directory - Directory to walk
 * @returns Array of file paths
 */
export async function collectFiles(directory: string): Promise<string[]> {
	const files: string[] = [];

	await walkDirectory(directory, (entry) => {
		if (!entry.isDirectory) {
			files.push(entry.path);
		}
	});

	return files;
}

/**
 * Copy a directory recursively.
 *
 * @param sourceDir - Source directory
 * @param targetDir - Target directory
 * @returns Array of created file paths
 */
export async function copyDirectory(sourceDir: string, targetDir: string): Promise<string[]> {
	await fs.promises.mkdir(targetDir, { recursive: true });

	const filesCreated: string[] = [];

	await walkDirectory(sourceDir, async (entry) => {
		const relativePath = path.relative(sourceDir, entry.path);
		const destPath = path.join(targetDir, relativePath);

		if (entry.isDirectory) {
			await fs.promises.mkdir(destPath, { recursive: true });
		} else {
			await fs.promises.copyFile(entry.path, destPath);
			filesCreated.push(destPath);
		}
	});

	return filesCreated;
}
