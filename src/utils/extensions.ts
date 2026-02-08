import { discoverInstalledExtensions, formatExtensionId, type InstalledExtension } from "@quarto-wizard/core";
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
		return extensions.map((ext) => formatExtensionId(ext.id));
	} catch (error) {
		logMessage(
			`Failed to discover extensions in ${directory}: ${error instanceof Error ? error.message : String(error)}.`,
			"warn",
		);
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
	} catch (error) {
		logMessage(
			`Failed to get installed extensions in ${workspaceFolder}: ${error instanceof Error ? error.message : String(error)}.`,
			"warn",
		);
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
		const key = formatExtensionId(ext.id);
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

export { formatExtensionId, type InstalledExtension } from "@quarto-wizard/core";
