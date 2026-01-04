import * as fs from "fs";
import * as path from "path";
import { discoverInstalledExtensions, type InstalledExtension } from "@quarto-wizard/core";
import { logMessage } from "./log";

/**
 * Finds Quarto extensions in a directory using the core library.
 *
 * @param directory - The directory to search.
 * @returns A promise that resolves to an array of extension IDs (e.g., "owner/name" or "name").
 */
export async function findQuartoExtensions(directory: string): Promise<string[]> {
	try {
		const extensions = await discoverInstalledExtensions(directory);
		return extensions.map((ext) => {
			const id = ext.id;
			return id.owner ? `${id.owner}/${id.name}` : id.name;
		});
	} catch {
		return [];
	}
}

/**
 * Gets installed extensions with full details using the core library.
 *
 * @param workspaceFolder - The workspace folder to search.
 * @returns A promise that resolves to an array of installed extensions.
 */
export async function getInstalledExtensions(workspaceFolder: string): Promise<InstalledExtension[]> {
	try {
		return await discoverInstalledExtensions(workspaceFolder);
	} catch {
		return [];
	}
}

/**
 * Gets installed extensions as a record keyed by extension ID.
 *
 * @param workspaceFolder - The workspace folder to search.
 * @returns A promise that resolves to a record mapping extension IDs to their data.
 */
export async function getInstalledExtensionsRecord(
	workspaceFolder: string,
): Promise<Record<string, InstalledExtension>> {
	const extensions = await getInstalledExtensions(workspaceFolder);
	const record: Record<string, InstalledExtension> = {};
	for (const ext of extensions) {
		const key = ext.id.owner ? `${ext.id.owner}/${ext.id.name}` : ext.id.name;
		record[key] = ext;
	}
	return record;
}

/**
 * Gets the repository identifier from an installed extension's source.
 *
 * @param ext - The installed extension.
 * @returns The repository identifier (e.g., "owner/repo") or undefined if not available.
 */
export function getExtensionRepository(ext: InstalledExtension): string | undefined {
	return ext.manifest.source ? ext.manifest.source.replace(/@.*$/, "") : undefined;
}

/**
 * Gets a comma-separated list of contribution types from an extension.
 *
 * @param ext - The installed extension.
 * @returns A comma-separated list of contribution types or undefined.
 */
export function getExtensionContributes(ext: InstalledExtension): string | undefined {
	return ext.manifest.contributes ? Object.keys(ext.manifest.contributes).join(", ") : undefined;
}

/**
 * Removes a specified extension and its parent directories if they become empty.
 *
 * @param extension - The name of the extension to remove.
 * @param root - The root directory where the extension is located.
 * @returns True if the extension was removed successfully, false otherwise.
 */
export async function removeExtension(extension: string, root: string): Promise<boolean> {
	const extensionPath = path.join(root, extension);
	if (fs.existsSync(extensionPath)) {
		try {
			await fs.promises.rm(extensionPath, { recursive: true, force: true });

			// Try to remove parent directories if empty. Using rmdir (without recursive)
			// will fail with ENOTEMPTY if the directory has contents, which is the
			// desired behaviour. This avoids TOCTTOU race conditions where we check
			// if empty then delete; instead we just try to delete and handle failure.
			const ownerPath = path.dirname(extensionPath);
			try {
				await fs.promises.rmdir(ownerPath);
			} catch {
				// Directory not empty or already removed; either is fine.
			}

			try {
				await fs.promises.rmdir(root);
			} catch {
				// Directory not empty or already removed; either is fine.
			}
			return true;
		} catch (error) {
			logMessage(`Failed to remove extension: ${error}`, "error");
			return false;
		}
	} else {
		logMessage(`Extension path does not exist: ${extensionPath}`, "warn");
		return false;
	}
}

export { type InstalledExtension } from "@quarto-wizard/core";
