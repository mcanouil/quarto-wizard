import { discoverInstalledExtensions, type InstalledExtension } from "@quarto-wizard/core";

/**
 * Formats an extension ID as a display string.
 *
 * @param id - The extension identifier with owner and name.
 * @returns The formatted string (e.g., "owner/name" or "name").
 */
export function formatExtensionId(id: { owner: string | null; name: string }): string {
	return id.owner ? `${id.owner}/${id.name}` : id.name;
}

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

export { type InstalledExtension } from "@quarto-wizard/core";
