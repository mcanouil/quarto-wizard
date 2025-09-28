import * as vscode from "vscode";
import { QW_EXTENSIONS, QW_EXTENSIONS_CACHE, QW_EXTENSIONS_CACHE_TIME } from "../constants";
import { logMessage, debouncedLogMessage } from "./log";
import { generateHashKey } from "./hash";

/**
 * Interface representing the details of a Quarto extension.
 */
export interface ExtensionDetails {
	id: string; // Unique identifier for the extension
	name: string; // Display name of the extension
	full_name: string; // "owner/repo" format
	owner: string; // Owner/organisation name
	description: string; // Extension description
	stars: number; // GitHub star count
	license: string; // license information
	html_url: string; // GitHub repository URL
	version: string; // Current version (without 'v' prefix)
	tag: string; // Release tag
	template: boolean; // Whether this extension is a template
	templateContent: string; // Content of the template if applicable
}

/**
 * Fetches the list of Quarto extensions, using cached data if available.
 * @param {vscode.ExtensionContext} context - The extension context used for caching.
 * @param {number} timeoutMs - Timeout in milliseconds (default: 10000ms).
 * @returns {Promise<ExtensionDetails[]>} - A promise that resolves to an array of extension details or empty array on error.
 */
async function fetchExtensions(context: vscode.ExtensionContext, timeoutMs = 10000): Promise<ExtensionDetails[]> {
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
		// Create AbortController for timeout handling
		const controller = new AbortController();
		const timeoutId = setTimeout(() => {
			controller.abort();
		}, timeoutMs);

		const response: Response = await fetch(url, {
			signal: controller.signal,
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			message = `${message}. ${response.statusText}`;
			throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
		}
		const data = await response.text();
		const extensionsDetailsList = await parseExtensionsDetails(data);
		await context.globalState.update(cacheKey, { data: extensionsDetailsList, timestamp: Date.now() });
		return extensionsDetailsList;
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			logMessage(`${message} Request timed out after ${timeoutMs}ms`, "error");
		} else {
			logMessage(`${message} ${error}`, "error");
		}
		return [];
	}
}

/**
 * Parses the details of Quarto extensions from JSON data.
 * @param {string} data - The extensions details as JSON with extension keys and metadata.
 * @returns {Promise<ExtensionDetails[]>} - A promise that resolves to an array of extension details or empty array on error.
 */
async function parseExtensionsDetails(data: string): Promise<ExtensionDetails[]> {
	try {
		const parsedData = JSON.parse(data);
		const extensionDetailsList: ExtensionDetails[] = Object.keys(parsedData).map((key) => {
			const extension = parsedData[key];
			return {
				id: key,
				name: extension.title,
				full_name: extension.nameWithOwner,
				owner: extension.owner,
				description: extension.description,
				stars: extension.stargazerCount,
				license: extension.licenseInfo,
				html_url: extension.url,
				version: extension.latestRelease.replace(/^v/, ""),
				tag: extension.latestRelease,
				template: extension.template,
				templateContent: extension.templateContent,
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
 * Fetches the details of all valid Quarto extensions and filters out any undefined entries.
 * @param {vscode.ExtensionContext} context - The extension context used for caching.
 * @param {number} timeoutMs - Timeout in milliseconds (default: 10000ms).
 * @returns {Promise<ExtensionDetails[]>} - A promise that resolves to an array of validated extension details.
 */
export async function getExtensionsDetails(context: vscode.ExtensionContext, timeoutMs = 10000): Promise<ExtensionDetails[]> {
	const extensions = await fetchExtensions(context, timeoutMs);

	return extensions.filter((extension): extension is ExtensionDetails => extension !== undefined);
}
