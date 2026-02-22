import * as os from "node:os";
import * as path from "node:path";
import {
	discoverInstalledExtensions,
	formatExtensionId,
	getExtensionTypes,
	type InstalledExtension,
	type SourceType,
} from "@quarto-wizard/core";
import { logMessage } from "./log";

const GITHUB_REPOSITORY_PATTERN = /^[^/\s:]+\/[^/\s:]+(?:\/[^/\s:]+)*(?:@[^/\s:]+)?$/;

function splitSourceRef(source: string): { base: string; hasRef: boolean } {
	const atIndex = source.lastIndexOf("@");
	if (atIndex <= 0) {
		return { base: source, hasRef: false };
	}
	return {
		base: source.substring(0, atIndex),
		hasRef: true,
	};
}

function isLocalSourcePath(source: string): boolean {
	return (
		source.startsWith("file://") ||
		source.startsWith("/") ||
		source.startsWith("~/") ||
		source.startsWith("\\\\") ||
		source.startsWith(".") ||
		/^[A-Za-z]:[/\\]/.test(source)
	);
}

function isLegacyGitHubSource(source: string): boolean {
	return GITHUB_REPOSITORY_PATTERN.test(source) && !source.startsWith(".");
}

function inferLegacySourceType(source: string): SourceType | undefined {
	if (/^https?:\/\//.test(source)) {
		return "url";
	}
	if (isLocalSourcePath(source)) {
		return "local";
	}
	if (isLegacyGitHubSource(splitSourceRef(source).base)) {
		return "registry";
	}
	return undefined;
}

export function getSourceBase(source: string, sourceType?: SourceType): string {
	if (sourceType === "github" || sourceType === "registry") {
		return splitSourceRef(source).base;
	}
	return source;
}

export function hasPinnedSourceRef(ext: InstalledExtension): boolean {
	if (!ext.manifest.source) {
		return false;
	}
	const sourceType = getEffectiveSourceType(ext);
	if (sourceType !== "github" && sourceType !== "registry") {
		return false;
	}
	return splitSourceRef(ext.manifest.source).hasRef;
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
	const source = ext.manifest.source;
	if (!source) {
		return undefined;
	}
	const type = getEffectiveSourceType(ext);
	if (type === "github" || type === "registry") {
		return getSourceBase(source, type);
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
	const type = getEffectiveSourceType(ext);
	const base = getSourceBase(source, type);
	if (type === "github" || type === "registry") {
		return `https://github.com/${base}`;
	}
	if (type === "url" || type === "local") {
		return base;
	}
	return undefined;
}

/**
 * Determines the effective source type from an installed extension.
 * Uses the explicit sourceType field if available, otherwise infers from the source string.
 *
 * @param ext - The installed extension.
 * @returns The source type or undefined if not determinable.
 */
export function getEffectiveSourceType(ext: InstalledExtension): SourceType | undefined {
	if (ext.manifest.sourceType) {
		return ext.manifest.sourceType;
	}
	const source = ext.manifest.source;
	if (!source) {
		return undefined;
	}
	return inferLegacySourceType(source);
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
