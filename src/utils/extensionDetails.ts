import * as vscode from "vscode";
import { fetchRegistry, type RegistryEntry } from "@quarto-wizard/core";
import {
	QW_EXTENSIONS,
	QW_EXTENSIONS_CACHE,
	QW_EXTENSIONS_CACHE_TIME,
	QW_RECENTLY_INSTALLED,
	QW_RECENTLY_USED,
} from "../constants";
import { logMessage, debouncedLogMessage, showLogsCommand } from "./log";
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
	contributes: string[]; // What the extension contributes (filters, formats, shortcodes, etc.)
}

/**
 * Converts a RegistryEntry from core library to ExtensionDetails.
 */
function convertRegistryEntry(entry: RegistryEntry): ExtensionDetails {
	return {
		id: entry.id,
		name: entry.name,
		full_name: entry.fullName,
		owner: entry.owner,
		description: entry.description ?? "",
		stars: entry.stars,
		license: entry.licence ?? "",
		html_url: entry.htmlUrl,
		version: entry.latestVersion ?? "",
		tag: entry.latestTag ?? "",
		template: entry.template,
		contributes: entry.contributes ?? [],
	};
}

/**
 * Fetches the list of Quarto extensions using the core library, with VSCode caching.
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

	try {
		const registry = await fetchRegistry({
			registryUrl: url,
			timeout: timeoutMs,
			forceRefresh: true, // Use VSCode cache, not filesystem cache
		});

		const extensionDetailsList: ExtensionDetails[] = Object.values(registry).map((entry) =>
			convertRegistryEntry(entry),
		);

		await context.globalState.update(cacheKey, {
			data: extensionDetailsList,
			timestamp: Date.now(),
		});

		return extensionDetailsList;
	} catch (error) {
		const message = `Error fetching list of extensions from ${url}.`;
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
export async function getExtensionsDetails(
	context: vscode.ExtensionContext,
	timeoutMs = 10000,
): Promise<ExtensionDetails[]> {
	const extensions = await fetchExtensions(context, timeoutMs);

	return extensions.filter((extension): extension is ExtensionDetails => extension !== undefined);
}

/**
 * Searches for extensions matching a query using the core library.
 * @param {vscode.ExtensionContext} context - The extension context.
 * @param {string} query - The search query.
 * @param {number} limit - Maximum number of results (default: 50).
 * @returns {Promise<ExtensionDetails[]>} - A promise that resolves to matching extensions.
 */
export async function searchExtensionsDetails(
	context: vscode.ExtensionContext,
	query: string,
	limit = 50,
): Promise<ExtensionDetails[]> {
	const extensions = await fetchExtensions(context);

	if (!query.trim()) {
		return extensions.slice(0, limit);
	}

	// Simple search: filter by query matching name, description, or owner
	const queryLower = query.toLowerCase();
	const results = extensions.filter((ext) => {
		const searchable = [ext.name, ext.full_name, ext.owner, ext.description].filter(Boolean).join(" ").toLowerCase();
		return searchable.includes(queryLower);
	});

	// Sort by stars (descending) and limit
	results.sort((a, b) => b.stars - a.stars);
	return results.slice(0, limit);
}

/**
 * Lists available extensions filtered by type.
 * @param {vscode.ExtensionContext} context - The extension context.
 * @param {object} options - Filter options.
 * @returns {Promise<ExtensionDetails[]>} - A promise that resolves to filtered extensions.
 */
export async function listExtensionsByType(
	context: vscode.ExtensionContext,
	options: {
		templatesOnly?: boolean;
		extensionsOnly?: boolean;
		limit?: number;
	} = {},
): Promise<ExtensionDetails[]> {
	const extensions = await fetchExtensions(context);

	let filtered = extensions;

	if (options.templatesOnly) {
		filtered = filtered.filter((ext) => ext.template);
	} else if (options.extensionsOnly) {
		filtered = filtered.filter((ext) => !ext.template);
	}

	if (options.limit) {
		filtered = filtered.slice(0, options.limit);
	}

	return filtered;
}

/**
 * Clears all cached extension data and recently used/installed lists.
 * @param {vscode.ExtensionContext} context - The extension context.
 * @returns {Promise<void>}
 */
export async function clearExtensionsCache(context: vscode.ExtensionContext): Promise<void> {
	const url = QW_EXTENSIONS;
	const cacheKey = `${QW_EXTENSIONS_CACHE}_${generateHashKey(url)}`;

	// Clear extension registry cache
	await context.globalState.update(cacheKey, undefined);

	// Clear recently installed/used lists
	await context.globalState.update(QW_RECENTLY_INSTALLED, []);
	await context.globalState.update(QW_RECENTLY_USED, []);

	const message = "Extension cache and recent lists cleared successfully.";
	logMessage(message, "info");
	vscode.window.showInformationMessage(`${message} ${showLogsCommand()}.`);
}
