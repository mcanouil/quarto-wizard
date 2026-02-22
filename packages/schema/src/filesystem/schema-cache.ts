/**
 * @title Schema Cache Module
 * @description In-memory cache for parsed extension schemas.
 *
 * Provides lazy-loading schema caching without file watchers.
 * File watching belongs in the VSCode extension layer.
 *
 * @module filesystem
 */

import type { ExtensionSchema } from "../types/schema.js";
import { readSchema } from "./schema.js";
import { getErrorMessage } from "@quarto-wizard/core";

/**
 * Cache for parsed extension schemas.
 * Schemas are loaded lazily on first access.
 */
export class SchemaCache {
	private cache = new Map<string, ExtensionSchema>();
	private errors = new Map<string, string>();

	/**
	 * Get the schema for an extension directory.
	 * Loads and caches the schema on first access.
	 *
	 * @param extensionDir - Path to the extension directory
	 * @returns Parsed schema or null if no schema file exists
	 */
	get(extensionDir: string): ExtensionSchema | null {
		if (this.cache.has(extensionDir)) {
			return this.cache.get(extensionDir)!;
		}

		try {
			const result = readSchema(extensionDir);

			if (!result) {
				return null;
			}

			this.errors.delete(extensionDir);
			this.cache.set(extensionDir, result.schema);
			return result.schema;
		} catch (error) {
			this.errors.set(extensionDir, getErrorMessage(error));
			return null;
		}
	}

	/**
	 * Get the parse error for a schema in the given directory, if any.
	 *
	 * @param extensionDir - Path to the extension directory
	 * @returns Error message or null if no error occurred
	 */
	getError(extensionDir: string): string | null {
		return this.errors.get(extensionDir) ?? null;
	}

	/**
	 * Check whether a schema is cached for the given directory.
	 *
	 * @param extensionDir - Path to the extension directory
	 * @returns True if a schema is cached
	 */
	has(extensionDir: string): boolean {
		return this.cache.has(extensionDir);
	}

	/**
	 * Invalidate the cached schema for a specific extension directory.
	 *
	 * @param extensionDir - Path to the extension directory
	 */
	invalidate(extensionDir: string): void {
		this.cache.delete(extensionDir);
		this.errors.delete(extensionDir);
	}

	/**
	 * Invalidate all cached schemas.
	 */
	invalidateAll(): void {
		this.cache.clear();
		this.errors.clear();
	}
}
