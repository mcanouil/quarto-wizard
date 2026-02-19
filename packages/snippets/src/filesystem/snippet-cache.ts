/**
 * @title Snippet Cache Module
 * @description In-memory cache for parsed extension snippets.
 *
 * Provides lazy-loading snippet caching without file watchers.
 * File watching belongs in the VSCode extension layer.
 *
 * @module filesystem
 */

import type { SnippetCollection } from "../types.js";
import { readSnippets } from "./snippets.js";

/**
 * Cache for parsed extension snippets.
 * Snippets are loaded lazily on first access.
 */
export class SnippetCache {
	private cache = new Map<string, SnippetCollection>();
	private errors = new Map<string, string>();

	/**
	 * Get the snippets for an extension directory.
	 * Loads and caches the snippets on first access.
	 *
	 * @param extensionDir - Path to the extension directory.
	 * @returns Parsed snippet collection or null if no snippet file exists.
	 */
	get(extensionDir: string): SnippetCollection | null {
		if (this.cache.has(extensionDir)) {
			return this.cache.get(extensionDir)!;
		}

		try {
			const result = readSnippets(extensionDir);

			if (!result) {
				return null;
			}

			this.errors.delete(extensionDir);
			this.cache.set(extensionDir, result.snippets);
			return result.snippets;
		} catch (error) {
			this.errors.set(extensionDir, error instanceof Error ? error.message : String(error));
			return null;
		}
	}

	/**
	 * Get the parse error for snippets in the given directory, if any.
	 *
	 * @param extensionDir - Path to the extension directory.
	 * @returns Error message or null if no error occurred.
	 */
	getError(extensionDir: string): string | null {
		return this.errors.get(extensionDir) ?? null;
	}

	/**
	 * Check whether snippets are cached for the given directory.
	 *
	 * @param extensionDir - Path to the extension directory.
	 * @returns True if snippets are cached.
	 */
	has(extensionDir: string): boolean {
		return this.cache.has(extensionDir);
	}

	/**
	 * Invalidate the cached snippets for a specific extension directory.
	 *
	 * @param extensionDir - Path to the extension directory.
	 */
	invalidate(extensionDir: string): void {
		this.cache.delete(extensionDir);
		this.errors.delete(extensionDir);
	}

	/**
	 * Invalidate all cached snippets.
	 */
	invalidateAll(): void {
		this.cache.clear();
		this.errors.clear();
	}
}
