/**
 * @title Registry Search Module
 * @description Registry search and listing functions.
 *
 * Provides search and filtering capabilities for the extensions registry.
 *
 * @module registry
 */

import type { RegistryEntry } from "../types/registry.js";
import type { ExtensionType } from "../types/extension.js";
import { fetchRegistry, type RegistryOptions } from "./fetcher.js";

/**
 * Options for listing available extensions.
 */
export interface ListAvailableOptions extends RegistryOptions {
	/** Filter by extension type (based on topics). */
	type?: ExtensionType;
	/** Filter to templates only. */
	templatesOnly?: boolean;
	/** Maximum number of results. */
	limit?: number;
}

/**
 * Options for searching extensions.
 */
export interface SearchOptions extends ListAvailableOptions {
	/** Minimum star count. */
	minStars?: number;
}

/**
 * List all available extensions from the registry.
 *
 * @param options - List options
 * @returns Array of registry entries
 *
 * @example
 * ```typescript
 * // List all filters
 * const filters = await listAvailable({ type: "filter" });
 *
 * // List templates only
 * const templates = await listAvailable({ templatesOnly: true, limit: 10 });
 * ```
 */
export async function listAvailable(options: ListAvailableOptions = {}): Promise<RegistryEntry[]> {
	const { type, templatesOnly, limit, ...registryOptions } = options;

	const registry = await fetchRegistry(registryOptions);
	let results = Object.values(registry);

	if (type) {
		results = filterByType(results, type);
	}

	if (templatesOnly) {
		results = results.filter((entry) => entry.template);
	}

	results.sort((a, b) => b.stars - a.stars);

	if (limit && limit > 0) {
		results = results.slice(0, limit);
	}

	return results;
}

/**
 * Search for extensions in the registry.
 *
 * @param query - Search query (searches name, description, topics)
 * @param options - Search options
 * @returns Array of matching registry entries
 *
 * @example
 * ```typescript
 * // Search for table-related extensions
 * const results = await search("table", { limit: 10 });
 *
 * // Search for popular filters only
 * const filters = await search("code", { type: "filter", minStars: 50 });
 * ```
 */
export async function search(query: string, options: SearchOptions = {}): Promise<RegistryEntry[]> {
	const { type, templatesOnly, limit = 20, minStars, ...registryOptions } = options;

	const registry = await fetchRegistry(registryOptions);
	const queryLower = query.toLowerCase().trim();

	let results: RegistryEntry[];

	if (queryLower === "") {
		results = Object.values(registry);
	} else {
		results = Object.values(registry).filter((entry) => {
			const searchable = buildSearchableText(entry);
			return searchable.includes(queryLower);
		});
	}

	if (type) {
		results = filterByType(results, type);
	}

	if (templatesOnly) {
		results = results.filter((entry) => entry.template);
	}

	if (minStars !== undefined && minStars > 0) {
		results = results.filter((entry) => entry.stars >= minStars);
	}

	results = rankResults(results, queryLower);

	if (limit && limit > 0) {
		results = results.slice(0, limit);
	}

	return results;
}

/**
 * Get a specific extension by ID from the registry.
 *
 * @param id - Extension ID (e.g., "quarto-ext/lightbox")
 * @param options - Registry options
 * @returns Registry entry or null if not found
 */
export async function getExtension(id: string, options: RegistryOptions = {}): Promise<RegistryEntry | null> {
	const registry = await fetchRegistry(options);
	return registry[id] ?? null;
}

/**
 * Get extensions by owner.
 *
 * @param owner - Owner name
 * @param options - Registry options
 * @returns Array of registry entries
 */
export async function getExtensionsByOwner(owner: string, options: RegistryOptions = {}): Promise<RegistryEntry[]> {
	const registry = await fetchRegistry(options);
	const ownerLower = owner.toLowerCase();

	return Object.values(registry).filter((entry) => entry.owner.toLowerCase() === ownerLower);
}

/**
 * Build searchable text from a registry entry.
 */
function buildSearchableText(entry: RegistryEntry): string {
	const parts = [entry.name, entry.fullName, entry.owner, entry.description ?? "", ...entry.topics];

	return parts.filter(Boolean).join(" ").toLowerCase();
}

/**
 * Filter entries by extension type based on topics.
 */
function filterByType(entries: RegistryEntry[], type: ExtensionType): RegistryEntry[] {
	const typeKeywords = getTypeKeywords(type);

	return entries.filter((entry) => {
		const topics = entry.topics.map((t) => t.toLowerCase());
		return typeKeywords.some((keyword) => topics.some((topic) => topic.includes(keyword)));
	});
}

/**
 * Get keywords for filtering by type.
 */
function getTypeKeywords(type: ExtensionType): string[] {
	switch (type) {
		case "filter":
			return ["filter", "lua-filter"];
		case "shortcode":
			return ["shortcode", "shortcodes"];
		case "format":
			return ["format", "template", "document"];
		case "project":
			return ["project"];
		case "revealjs-plugin":
			return ["revealjs", "reveal", "slides", "presentation"];
		case "metadata":
			return ["metadata"];
		default:
			return [];
	}
}

/**
 * Rank search results by relevance.
 */
function rankResults(entries: RegistryEntry[], query: string): RegistryEntry[] {
	if (query === "") {
		return entries.sort((a, b) => b.stars - a.stars);
	}

	return entries.sort((a, b) => {
		const scoreA = getRelevanceScore(a, query);
		const scoreB = getRelevanceScore(b, query);

		if (scoreA !== scoreB) {
			return scoreB - scoreA;
		}

		return b.stars - a.stars;
	});
}

/**
 * Calculate relevance score for a registry entry.
 */
function getRelevanceScore(entry: RegistryEntry, query: string): number {
	let score = 0;

	const nameLower = entry.name.toLowerCase();
	const fullNameLower = entry.fullName.toLowerCase();

	if (nameLower === query) {
		score += 100;
	} else if (nameLower.startsWith(query)) {
		score += 50;
	} else if (nameLower.includes(query)) {
		score += 25;
	}

	if (fullNameLower.includes(query)) {
		score += 20;
	}

	if (entry.description?.toLowerCase().includes(query)) {
		score += 10;
	}

	if (entry.topics.some((t) => t.toLowerCase().includes(query))) {
		score += 5;
	}

	score += Math.min(entry.stars / 10, 10);

	return score;
}
