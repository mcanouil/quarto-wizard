import * as vscode from "vscode";
import { QW_EXTENSIONS, QW_EXTENSIONS_CACHE, QW_EXTENSIONS_CACHE_TIME } from "../constants";
import { logMessage, debouncedLogMessage } from "./log";
import { generateHashKey } from "./hash";

/**
 * Interface representing the details of a Quarto extension.
 */
export interface ExtensionDetails {
	id: string;
	name: string;
	full_name: string; // "owner/repo"
	owner: string;
	description: string;
	stars: number;
	license: string;
	html_url: string;
	version: string;
	tag: string;
}

/**
 * Fetches the list of Quarto extensions.
 * @param {vscode.ExtensionContext} context - The extension context.
 * @returns {Promise<ExtensionDetails[]>} - A promise that resolves to an array of extension details.
 */
async function fetchExtensions(context: vscode.ExtensionContext): Promise<ExtensionDetails[]> {
	const url = QW_EXTENSIONS;
	const cacheKey = `${QW_EXTENSIONS_CACHE}_${generateHashKey(url)}`;
	const cachedData = context.globalState.get<{ data: ExtensionDetails[]; timestamp: number }>(cacheKey);

	if (cachedData && Date.now() - cachedData.timestamp < QW_EXTENSIONS_CACHE_TIME) {
		debouncedLogMessage(`Using cached extensions: ${new Date(cachedData.timestamp).toISOString()}`, "info");
		return cachedData.data;
	}

	debouncedLogMessage(`Fetching extensions: ${url}`, "info");
	let message = `Error fetching list of extensions from ${url}.`;
	try {
		const response: Response = await fetch(url);
		if (!response.ok) {
			message = `${message}. ${response.statusText}`;
			throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
		}
		const data = await response.text();
		const extensionsDetailsList = await parseExtensionsDetails(data);
		await context.globalState.update(cacheKey, { data: extensionsDetailsList, timestamp: Date.now() });
		return extensionsDetailsList;
	} catch (error) {
		logMessage(`${message} ${error}`, "error");
		return [];
	}
}

/**
 * Formats the label of a Quarto extension.
 * @param {string} extension - The extension name.
 * @returns {string} - The formatted extension label.
 */
function formatExtensionLabel(extension: string): string {
	const [, name, subDirectory] = extension.split("/");
	let extensionName = name
		.replace(/[-_]/g, " ")
		.replace(/quarto/gi, "")
		.trim();
	if (subDirectory !== undefined) {
		const extensionNameSubDirectory = subDirectory
			.replace(/[-_]/g, " ")
			.replace(/quarto/gi, "")
			.trim();
		if (extensionNameSubDirectory !== "") {
			extensionName = extensionNameSubDirectory;
		}
	}
	extensionName = extensionName
		.split(" ")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join(" ");
	return extensionName;
}

/**
 * Parses the details of a Quarto extensions from JSON data.
 * @param {string} data - The extensions details as JSON.
 * @returns {Promise<ExtensionDetails[]>} - A promise that resolves to an array of extension details.
 */
async function parseExtensionsDetails(data: string): Promise<ExtensionDetails[]> {
	try {
		const parsedData = JSON.parse(data);
		const extensionDetailsList: ExtensionDetails[] = Object.keys(parsedData).map((key) => {
			const extension = parsedData[key];
			return {
				id: key,
				name: formatExtensionLabel(key),
				full_name: extension.nameWithOwner,
				owner: extension.owner,
				description: extension.description || "none",
				stars: extension.stargazerCount,
				license: extension.licenseInfo || "none",
				html_url: extension.url,
				version: extension.latestRelease ? extension.latestRelease.replace(/^v/, "") : "none",
				tag: extension.latestRelease || "none",
			};
		});
		return extensionDetailsList;
	} catch (error) {
		const message = "Error parsing extension details.";
		logMessage(`${message} ${error}`, "error");
		return [];
	}
}

/**
 * Fetches the details of all Quarto extensions.
 * @param {vscode.ExtensionContext} context - The extension context.
 * @returns {Promise<ExtensionDetails[]>} - A promise that resolves to an array of extension details.
 */
export async function getExtensionsDetails(context: vscode.ExtensionContext): Promise<ExtensionDetails[]> {
	const extensions = await fetchExtensions(context);

	return extensions.filter((extension): extension is ExtensionDetails => extension !== undefined);
}
