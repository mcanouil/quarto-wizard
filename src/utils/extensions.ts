import * as os from "node:os";
import * as path from "node:path";
import {
	discoverInstalledExtensions,
	formatExtensionId,
	getEffectiveSourceType,
	getExtensionTypes,
	type InstalledExtension,
	type SourceType,
	getErrorMessage,
	parseGitHubLocator,
	splitSourceRef,
	ExtensionError,
	type GitHubLocator,
} from "@quarto-wizard/core";
import { logMessage } from "./log";

export function getSourceBase(source: string, sourceType?: SourceType): string {
	if (sourceType === "github" || sourceType === "registry") {
		return splitSourceRef(source).base;
	}
	return source;
}

/**
 * Repository and subdirectory of a GitHub source base, or null when the base
 * names no repository or a subdirectory that could leave it.
 */
function toGitHubLocator(base: string): GitHubLocator | null {
	try {
		return parseGitHubLocator(base);
	} catch (error) {
		if (error instanceof ExtensionError) {
			return null;
		}
		throw error;
	}
}

export function resolveLocalSourcePath(sourcePath: string, workspaceFolder: string): string {
	let candidate = sourcePath;
	if (candidate === "~") {
		candidate = os.homedir();
	} else if (candidate.startsWith("~/") || candidate.startsWith("~\\")) {
		candidate = path.join(os.homedir(), candidate.slice(2));
	}
	if (path.isAbsolute(candidate) || /^[A-Za-z]:[/\\]/.test(candidate) || candidate.startsWith("\\\\")) {
		return candidate;
	}
	return path.resolve(workspaceFolder, candidate);
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
	} catch (error) {
		logMessage(`Failed to discover extensions in ${directory}: ${getErrorMessage(error)}.`, "warn");
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
		logMessage(`Failed to get installed extensions in ${workspaceFolder}: ${getErrorMessage(error)}.`, "warn");
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
 * A subdirectory source such as "owner/repo/sub/dir" gives "owner/repo".
 *
 * @param ext - The installed extension.
 * @returns The repository identifier (e.g., "owner/repo") or undefined if not available.
 */
export function getExtensionRepository(ext: InstalledExtension): string | undefined {
	const source = ext.manifest.source;
	if (!source) {
		return undefined;
	}
	const type = getEffectiveSourceType(ext.manifest);
	if (type === "github" || type === "registry") {
		const locator = toGitHubLocator(getSourceBase(source, type));
		return locator ? `${locator.owner}/${locator.repo}` : undefined;
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
	const source = ext.manifest.source;
	if (!source) {
		return undefined;
	}
	const type = getEffectiveSourceType(ext.manifest);
	const base = getSourceBase(source, type);
	if (type === "github" || type === "registry") {
		const locator = toGitHubLocator(base);
		if (!locator?.subdirectory) {
			return `https://github.com/${base}`;
		}
		const ref = splitSourceRef(source).hasRef ? source.slice(base.length + 1) : "HEAD";
		return `https://github.com/${locator.owner}/${locator.repo}/tree/${ref}/${locator.subdirectory}`;
	}
	if (type === "url" || type === "local") {
		return base;
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

export { formatExtensionId, getEffectiveSourceType, type InstalledExtension } from "@quarto-wizard/core";
