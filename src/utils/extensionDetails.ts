import * as vscode from "vscode";
import { fetchRegistry, type RegistryEntry } from "@quarto-wizard/core";
import {
	getDefaultRegistryUrl,
	QW_EXTENSIONS_CACHE,
	STORAGE_KEY_RECENTLY_INSTALLED,
	STORAGE_KEY_RECENTLY_USED,
} from "../constants";
import { logMessage, logMessageDebounced, showMessageWithLogs } from "./log";
import { generateHashKey } from "./hash";

/**
 * Default cache TTL in minutes.
 */
const DEFAULT_CACHE_TTL_MINUTES = 30;

/**
 * Gets the configured cache TTL in milliseconds.
 * @returns Cache TTL in milliseconds.
 */
export function getCacheTTL(): number {
	const config = vscode.workspace.getConfiguration("quartoWizard");
	const ttlMinutes = config.get<number>("cache.ttlMinutes", DEFAULT_CACHE_TTL_MINUTES);
	return ttlMinutes * 60 * 1000;
}

/**
 * Gets the configured registry URL.
 * @returns The registry URL from settings or the default.
 */
export function getRegistryUrl(): string {
	const config = vscode.workspace.getConfiguration("quartoWizard");
	return config.get<string>("registry.url", getDefaultRegistryUrl());
}

/**
 * Interface representing the details of a Quarto extension.
 */
export interface ExtensionDetails {
	id: string; // Unique identifier for the extension
	name: string; // Display name of the extension
	fullName: string; // "owner/repo" format
	owner: string; // Owner/organisation name
	description: string; // Extension description
	stars: number; // GitHub star count
	license: string; // license information
	htmlUrl: string; // GitHub repository URL
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
		fullName: entry.fullName,
		owner: entry.owner,
		description: entry.description ?? "",
		stars: entry.stars,
		license: entry.licence ?? "",
		htmlUrl: entry.htmlUrl,
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
	const url = getRegistryUrl();
	const cacheKey = `${QW_EXTENSIONS_CACHE}_${generateHashKey(url)}`;
	const cachedData = context.globalState.get<{ data: ExtensionDetails[]; timestamp: number }>(cacheKey);

	if (cachedData && Date.now() - cachedData.timestamp < getCacheTTL()) {
		logMessageDebounced(`Using cached registry: ${new Date(cachedData.timestamp).toISOString()}`, "debug");
		return cachedData.data;
	}

	logMessageDebounced(`Fetching registry: ${url}`, "info");

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
		const errorMsg = error instanceof Error ? error.message : String(error);
		const message = `Error fetching list of extensions from ${url}.`;
		logMessage(`${message} ${errorMsg}.`, "error");
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
	return fetchExtensions(context, timeoutMs);
}

/**
 * Clears all cached extension data and recently used/installed lists.
 * @param {vscode.ExtensionContext} context - The extension context.
 * @returns {Promise<void>}
 */
export async function clearExtensionsCache(context: vscode.ExtensionContext): Promise<void> {
	const url = getRegistryUrl();
	const cacheKey = `${QW_EXTENSIONS_CACHE}_${generateHashKey(url)}`;

	// Clear extension registry cache
	await context.globalState.update(cacheKey, undefined);

	// Clear recently installed/used lists
	await context.globalState.update(STORAGE_KEY_RECENTLY_INSTALLED, []);
	await context.globalState.update(STORAGE_KEY_RECENTLY_USED, []);

	const message = "Extension cache and recent lists cleared successfully.";
	logMessage(message, "info");
	showMessageWithLogs(message, "info");
}
