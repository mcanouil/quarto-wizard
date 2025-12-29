/**
 * Extension removal operations.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionId } from "../types/extension.js";
import { formatExtensionId } from "../types/extension.js";
import { ExtensionError } from "../errors.js";
import { findInstalledExtension, getExtensionsDir, type InstalledExtension } from "../filesystem/discovery.js";
import { collectFiles } from "../filesystem/walk.js";

/**
 * Options for removal.
 */
export interface RemoveOptions {
	/** Project directory. */
	projectDir: string;
	/** Clean up empty parent directories. */
	cleanupEmpty?: boolean;
}

/**
 * Result of removal.
 */
export interface RemoveResult {
	/** Whether removal succeeded. */
	success: boolean;
	/** Removed extension details. */
	extension: InstalledExtension;
	/** Files removed. */
	filesRemoved: string[];
	/** Directories cleaned up. */
	directoriesRemoved: string[];
}

/**
 * Remove an installed extension.
 *
 * @param extensionId - Extension to remove
 * @param options - Removal options
 * @returns Removal result
 */
export async function remove(extensionId: ExtensionId, options: RemoveOptions): Promise<RemoveResult> {
	const { projectDir, cleanupEmpty = true } = options;

	const extension = await findInstalledExtension(projectDir, extensionId);

	if (!extension) {
		throw new ExtensionError(
			`Extension not found: ${formatExtensionId(extensionId)}`,
			"Use 'list' to see installed extensions",
		);
	}

	const filesRemoved = await collectFiles(extension.directory);
	const directoriesRemoved: string[] = [];

	await fs.promises.rm(extension.directory, { recursive: true, force: true });
	directoriesRemoved.push(extension.directory);

	if (cleanupEmpty && extension.id.owner) {
		const ownerDir = path.dirname(extension.directory);
		const cleaned = await cleanupEmptyDirectories(ownerDir, getExtensionsDir(projectDir));
		directoriesRemoved.push(...cleaned);
	}

	return {
		success: true,
		extension,
		filesRemoved,
		directoriesRemoved,
	};
}

/**
 * Remove multiple extensions.
 *
 * @param extensionIds - Extensions to remove
 * @param options - Removal options
 * @returns Array of removal results
 */
export async function removeMultiple(
	extensionIds: ExtensionId[],
	options: RemoveOptions,
): Promise<Array<RemoveResult | { extensionId: ExtensionId; error: string }>> {
	const results: Array<RemoveResult | { extensionId: ExtensionId; error: string }> = [];

	for (const id of extensionIds) {
		try {
			const result = await remove(id, options);
			results.push(result);
		} catch (error) {
			results.push({
				extensionId: id,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return results;
}

/**
 * Clean up empty parent directories up to a limit.
 */
async function cleanupEmptyDirectories(startDir: string, stopAt: string): Promise<string[]> {
	const removed: string[] = [];
	let currentDir = startDir;

	while (currentDir !== stopAt && currentDir.startsWith(stopAt)) {
		try {
			const entries = await fs.promises.readdir(currentDir);

			if (entries.length === 0) {
				await fs.promises.rmdir(currentDir);
				removed.push(currentDir);
				currentDir = path.dirname(currentDir);
			} else {
				break;
			}
		} catch {
			break;
		}
	}

	return removed;
}
