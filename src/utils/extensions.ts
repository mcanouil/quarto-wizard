import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { discoverInstalledExtensions, type InstalledExtension } from "@quarto-wizard/core";
import { logMessage } from "./log";

/**
 * Interface representing the data of a Quarto extension.
 */
export interface ExtensionData {
	title?: string;
	author?: string;
	version?: string;
	contributes?: string;
	source?: string;
	repository?: string;
}

/**
 * Raw YAML structure for a Quarto extension manifest.
 * This represents the expected shape of _extension.yml files.
 */
interface RawExtensionManifest {
	title?: unknown;
	author?: unknown;
	version?: unknown;
	contributes?: unknown;
	source?: unknown;
}

/**
 * Type guard to validate that parsed YAML is a valid extension manifest object.
 * Ensures the data is a non-null object before accessing properties.
 *
 * @param data - Parsed YAML data
 * @returns True if data is a valid manifest object
 */
function isValidManifestObject(data: unknown): data is RawExtensionManifest {
	return typeof data === "object" && data !== null && !Array.isArray(data);
}

/**
 * Safely extract a string value from an unknown field.
 *
 * @param value - Unknown value from parsed YAML
 * @returns String value or undefined if not a string
 */
function asOptionalString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

/**
 * Finds Quarto extensions in a directory.
 * @param {string} directory - The directory to search.
 * @returns {string[]} - An array of relative paths to the found extensions.
 */
export function findQuartoExtensions(directory: string): string[] {
	if (!fs.existsSync(directory)) {
		return [];
	}
	return findQuartoExtensionsRecurse(directory).map((filePath) => path.relative(directory, path.dirname(filePath)));
}

/**
 * Finds Quarto extensions in a directory using the core library (async version).
 * @param {string} directory - The directory to search.
 * @returns {Promise<string[]>} - A promise that resolves to an array of relative paths to the found extensions.
 */
export async function findQuartoExtensionsAsync(directory: string): Promise<string[]> {
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
 * Recursively finds Quarto extension files in a directory.
 * @param {string} directory - The directory to search.
 * @returns {string[]} - An array of file paths to the found extension files.
 */
function findQuartoExtensionsRecurse(directory: string): string[] {
	if (!fs.existsSync(directory)) {
		return [];
	}

	const list = fs.readdirSync(directory);
	const results = list.flatMap((file) => {
		const filePath = path.join(directory, file);
		const stat = fs.statSync(filePath);
		if (stat && stat.isDirectory() && path.basename(filePath) !== "_extensions") {
			return findQuartoExtensionsRecurse(filePath);
		} else if (file.endsWith("_extension.yml") || file.endsWith("_extension.yaml")) {
			return [filePath];
		}
		return [];
	});
	return results;
}

/**
 * Gets the modification times of Quarto extensions in a directory.
 * @param {string} directory - The directory to search.
 * @returns {{ [key: string]: Date }} - An object mapping extension paths to their modification times.
 */
export function getMtimeExtensions(directory: string): Record<string, Date> {
	if (!fs.existsSync(directory)) {
		return {};
	}
	const extensions = findQuartoExtensions(directory);
	const extensionsMtimeDict: Record<string, Date> = Object.fromEntries(
		extensions.map((extension) => [extension, fs.statSync(path.join(directory, extension)).mtime]),
	);
	return extensionsMtimeDict;
}

/**
 * Finds modified Quarto extensions in a directory.
 * @param {{ [key: string]: Date }} extensions - An object mapping extension paths to their previous modification times.
 * @param {string} directory - The directory to search.
 * @returns {string[]} - An array of relative paths to the modified extensions.
 */
export function findModifiedExtensions(extensions: Record<string, Date>, directory: string): string[] {
	if (!fs.existsSync(directory)) {
		return [];
	}
	const currentExtensions = findQuartoExtensions(directory);
	const modifiedExtensions = currentExtensions.filter((extension: string) => {
		const extensionPath = path.join(directory, extension);
		const extensionMtime = fs.statSync(extensionPath).mtime;
		return !extensions[extension] || extensions[extension] < extensionMtime;
	});
	return modifiedExtensions;
}

/**
 * Reads Quarto extensions data from a workspace folder using the core library.
 * @param {string} workspaceFolder - The workspace folder to search.
 * @returns {Promise<Record<string, ExtensionData>>} - A promise that resolves to an object mapping extension names to their data.
 */
export async function readExtensionsAsync(workspaceFolder: string): Promise<Record<string, ExtensionData>> {
	try {
		const extensions = await discoverInstalledExtensions(workspaceFolder);
		const extensionsData: Record<string, ExtensionData> = {};

		for (const ext of extensions) {
			const key = ext.id.owner ? `${ext.id.owner}/${ext.id.name}` : ext.id.name;
			extensionsData[key] = convertInstalledExtension(ext);
		}

		return extensionsData;
	} catch {
		return {};
	}
}

/**
 * Converts an InstalledExtension from core library to ExtensionData.
 */
function convertInstalledExtension(ext: InstalledExtension): ExtensionData {
	const manifest = ext.manifest;
	return {
		title: manifest.title,
		author: manifest.author,
		version: manifest.version,
		contributes: manifest.contributes ? Object.keys(manifest.contributes).join(", ") : undefined,
		source: manifest.source,
		repository: manifest.source ? manifest.source.replace(/@.*$/, "") : undefined,
	};
}

/**
 * Reads Quarto extensions data from a workspace folder (synchronous version for backwards compatibility).
 * @param {string} workspaceFolder - The workspace folder to search.
 * @param {string[]} extensions - An array of extension names to read.
 * @returns {Record<string, ExtensionData>} - An object mapping extension names to their data.
 */
export function readExtensions(workspaceFolder: string, extensions: string[]): Record<string, ExtensionData> {
	const extensionsData: Record<string, ExtensionData> = {};
	for (const ext of extensions) {
		let filePath = path.join(workspaceFolder, "_extensions", ext, "_extension.yml");
		if (!fs.existsSync(filePath)) {
			filePath = path.join(workspaceFolder, "_extensions", ext, "_extension.yaml");
		}
		const extData = readYamlFile(filePath);
		if (extData) {
			extensionsData[ext] = extData;
		}
	}
	return extensionsData;
}

/**
 * Reads a YAML file and returns its data as an ExtensionData object.
 * @param {string} filePath - The path to the YAML file.
 * @returns {ExtensionData | null} - The parsed data or null if the file does not exist or is invalid.
 */
function readYamlFile(filePath: string): ExtensionData | null {
	if (!fs.existsSync(filePath)) {
		return null;
	}
	const fileContent = fs.readFileSync(filePath, "utf8");
	const data: unknown = yaml.load(fileContent);

	if (!isValidManifestObject(data)) {
		return null;
	}

	const source = asOptionalString(data.source);
	const contributes =
		typeof data.contributes === "object" && data.contributes !== null
			? Object.keys(data.contributes).join(", ")
			: undefined;

	return {
		title: asOptionalString(data.title),
		author: asOptionalString(data.author),
		version: asOptionalString(data.version),
		contributes,
		source,
		repository: source ? source.replace(/@.*$/, "") : undefined,
	};
}

/**
 * Removes a specified extension and its parent directories if they become empty.
 *
 * @param extension - The name of the extension to remove.
 * @param root - The root directory where the extension is located.
 * @returns {boolean} - Status (true for success, false for failure).
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

/**
 * Gets installed extensions with full details using the core library.
 * @param {string} workspaceFolder - The workspace folder to search.
 * @returns {Promise<InstalledExtension[]>} - A promise that resolves to an array of installed extensions.
 */
export async function getInstalledExtensions(workspaceFolder: string): Promise<InstalledExtension[]> {
	try {
		return await discoverInstalledExtensions(workspaceFolder);
	} catch {
		return [];
	}
}

export { type InstalledExtension } from "@quarto-wizard/core";
