import {
	discoverInstalledExtensions,
	formatExtensionId,
	getExtensionTypes,
	type InstalledExtension,
} from "@quarto-wizard/core";
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
 * Returns a value only for GitHub and registry sources.
 *
 * @param ext - The installed extension.
 * @returns The repository identifier (e.g., "owner/repo") or undefined if not available.
 */
export function getExtensionRepository(ext: InstalledExtension): string | undefined {
	if (!ext.manifest.source) {
		return undefined;
	}
	const base = ext.manifest.source.replace(/@.*$/, "");
	const type = ext.manifest.sourceType;
	if (type) {
		return type === "github" || type === "registry" ? base : undefined;
	}
	// Fallback for legacy manifests without sourceType
	if (/^[^/\s:]+\/[^/\s]+$/.test(base) && !base.startsWith(".")) {
		return base;
	}
	return undefined;
}

/**
 * Gets the URL to open for an extension's source.
 *
 * @param ext - The installed extension.
 * @returns The source URL/path or undefined if not available.
 */
export function getExtensionSourceUrl(ext: InstalledExtension): string | undefined {
	if (!ext.manifest.source) {
		return undefined;
	}
	const base = ext.manifest.source.replace(/@.*$/, "");
	const type = ext.manifest.sourceType;
	if (type === "github" || type === "registry") {
		return `https://github.com/${base}`;
	}
	if (type === "url") {
		return base;
	}
	if (type === "local") {
		return base;
	}
	// Fallback for legacy manifests without sourceType
	if (/^https?:\/\//.test(base)) {
		return base;
	}
	if (/^[^/\s:]+\/[^/\s]+$/.test(base) && !base.startsWith(".")) {
		return `https://github.com/${base}`;
	}
	return base;
}

/**
 * Determines the effective source type from an installed extension.
 * Uses the explicit sourceType field if available, otherwise infers from the source string.
 *
 * @param ext - The installed extension.
 * @returns The source type or undefined if not determinable.
 */
export function getEffectiveSourceType(ext: InstalledExtension): "github" | "url" | "local" | "registry" | undefined {
	if (ext.manifest.sourceType) {
		return ext.manifest.sourceType;
	}
	if (!ext.manifest.source) {
		return undefined;
	}
	const base = ext.manifest.source.replace(/@.*$/, "");
	if (/^https?:\/\//.test(base)) {
		return "url";
	}
	if (base.startsWith("/") || base.startsWith("./") || base.startsWith("../") || /^[A-Za-z]:[/\\]/.test(base)) {
		return "local";
	}
	if (/^[^/\s:]+\/[^/\s]+$/.test(base)) {
		return "github";
	}
	return undefined;
}

/**
 * Gets a comma-separated list of contribution types from an extension.
 *
 * @param ext - The installed extension.
 * @returns A comma-separated list of contribution types or undefined.
 */
export function getExtensionContributes(ext: InstalledExtension): string | undefined {
	const types = getExtensionTypes(ext.manifest);
	return types.length > 0 ? types.join(", ") : undefined;
}

export { formatExtensionId, type InstalledExtension } from "@quarto-wizard/core";
