import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { logMessage } from "./log";

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
 * Finds Quarto extensions in a directory.
 * @param {string} directory - The directory to search.
 * @returns {string[]} - An array of relative paths to the found extensions.
 */
export function findQuartoExtensions(directory: string): string[] {
	return findQuartoExtensionsRecurse(directory).map((filePath) => path.relative(directory, path.dirname(filePath)));
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
		extensions.map((extension) => [extension, fs.statSync(path.join(directory, extension)).mtime])
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
	const modifiedExtensions = currentExtensions.filter((extension) => {
		const extensionPath = path.join(directory, extension);
		const extensionMtime = fs.statSync(extensionPath).mtime;
		return !extensions[extension] || extensions[extension] < extensionMtime;
	});
	return modifiedExtensions;
}

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
 * Reads a YAML file and returns its data as an ExtensionData object.
 * @param {string} filePath - The path to the YAML file.
 * @returns {ExtensionData | null} - The parsed data or null if the file does not exist.
 */
function readYamlFile(filePath: string): ExtensionData | null {
	if (!fs.existsSync(filePath)) {
		return null;
	}
	const fileContent = fs.readFileSync(filePath, "utf8");
	const data = yaml.load(fileContent) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
	return {
		title: data.title,
		author: data.author,
		version: data.version,
		contributes: Object.keys(data.contributes).join(", "),
		source: data.source,
		repository: data.source ? data.source.replace(/@.*$/, "") : undefined,
	};
}

/**
 * Reads Quarto extensions data from a workspace folder.
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
			fs.rmSync(extensionPath, { recursive: true, force: true });

			const ownerPath = path.dirname(extensionPath);
			if (fs.readdirSync(ownerPath).length === 0) {
				fs.rmdirSync(ownerPath);
			}

			if (fs.readdirSync(root).length === 0) {
				fs.rmdirSync(root);
			}
			return true;
		} catch (error) {
			logMessage(`Failed to remove extension: ${error}`);
			return false;
		}
	} else {
		logMessage(`Extension path does not exist: ${extensionPath}`);
		return false;
	}
}
