/**
 * @title Registry Cache Module
 * @description Registry caching with TTL support.
 *
 * Provides filesystem-based caching for the extensions registry.
 *
 * @module registry
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Registry } from "../types/registry.js";

/** Default cache TTL: 24 hours in milliseconds. */
export const DEFAULT_CACHE_TTL = 24 * 60 * 60 * 1000;

/** Cache file name. */
const CACHE_FILENAME = "quarto-wizard-registry.json";

/**
 * Cached registry data structure.
 */
interface CachedRegistry {
	/** Timestamp when the cache was created. */
	timestamp: number;
	/** The cached registry data. */
	registry: Registry;
	/** URL the registry was fetched from. */
	url: string;
	/** Number of entries at time of write, used for integrity checking. */
	entryCount?: number;
}

/**
 * Get the default cache directory.
 *
 * @returns Path to cache directory
 */
export function getDefaultCacheDir(): string {
	const platform = process.platform;

	if (platform === "darwin") {
		return path.join(os.homedir(), "Library", "Caches", "quarto-wizard");
	} else if (platform === "win32") {
		return path.join(
			process.env["LOCALAPPDATA"] ?? path.join(os.homedir(), "AppData", "Local"),
			"quarto-wizard",
			"cache",
		);
	} else {
		return path.join(process.env["XDG_CACHE_HOME"] ?? path.join(os.homedir(), ".cache"), "quarto-wizard");
	}
}

/**
 * Get the cache file path.
 *
 * @param cacheDir - Cache directory (uses default if not provided)
 * @returns Path to cache file
 */
export function getCacheFilePath(cacheDir?: string): string {
	const dir = cacheDir ?? getDefaultCacheDir();
	return path.join(dir, CACHE_FILENAME);
}

/**
 * Read cached registry if valid.
 *
 * @param cacheDir - Cache directory
 * @param url - Expected registry URL
 * @param ttl - Cache TTL in milliseconds
 * @returns Cached registry or null if cache is invalid/expired
 */
export async function readCachedRegistry(
	cacheDir: string,
	url: string,
	ttl: number = DEFAULT_CACHE_TTL,
): Promise<Registry | null> {
	const cacheFile = getCacheFilePath(cacheDir);

	try {
		if (!fs.existsSync(cacheFile)) {
			return null;
		}

		const content = await fs.promises.readFile(cacheFile, "utf-8");
		const cached = JSON.parse(content) as CachedRegistry;

		if (cached.url !== url) {
			return null;
		}

		const age = Date.now() - cached.timestamp;
		if (ttl === 0 || age > ttl) {
			return null;
		}

		if (!isValidCachedRegistry(cached)) {
			return null;
		}

		return cached.registry;
	} catch {
		// Cache read/parse failed (corrupted JSON, partial write, permission issue).
		// Return null to trigger fresh fetch; cache corruption is self-healing since
		// successful registry fetches will overwrite the corrupted cache.
		return null;
	}
}

/**
 * Write registry to cache.
 *
 * @param cacheDir - Cache directory
 * @param url - Registry URL
 * @param registry - Registry data to cache
 */
export async function writeCachedRegistry(cacheDir: string, url: string, registry: Registry): Promise<void> {
	const cacheFile = getCacheFilePath(cacheDir);
	const dir = path.dirname(cacheFile);

	try {
		await fs.promises.mkdir(dir, { recursive: true });

		const cached: CachedRegistry = {
			timestamp: Date.now(),
			url,
			registry,
			entryCount: Object.keys(registry).length,
		};

		await fs.promises.writeFile(cacheFile, JSON.stringify(cached), "utf-8");
	} catch {
		// Cache write is best-effort; failure (permissions, disk full, etc.)
		// doesn't affect core functionality since we can always re-fetch.
		// No point notifying user about cache write failure.
	}
}

/**
 * Clear the registry cache.
 *
 * @param cacheDir - Cache directory (uses default if not provided)
 */
export async function clearRegistryCache(cacheDir?: string): Promise<void> {
	const cacheFile = getCacheFilePath(cacheDir);

	try {
		if (fs.existsSync(cacheFile)) {
			await fs.promises.unlink(cacheFile);
		}
	} catch {
		// Cache clear is best-effort; if file is locked or permissions changed,
		// it doesn't affect functionality. The next cache write will overwrite it
		// or the user can manually delete it if needed.
	}
}

/**
 * Validate cached registry data integrity.
 *
 * Checks that:
 * - The registry is a non-empty object.
 * - Entry count matches the stored count (when available).
 * - At least one entry has expected fields.
 *
 * @param cached - Cached registry data
 * @returns True if the cache appears valid
 */
function isValidCachedRegistry(cached: CachedRegistry): boolean {
	const { registry, entryCount } = cached;

	if (!registry || typeof registry !== "object" || Array.isArray(registry)) {
		return false;
	}

	const keys = Object.keys(registry);
	if (keys.length === 0) {
		return false;
	}

	if (entryCount !== undefined && keys.length !== entryCount) {
		return false;
	}

	const sample = registry[keys[0]];
	if (!sample || typeof sample.fullName !== "string") {
		return false;
	}

	return true;
}

/**
 * Get cache status information.
 *
 * @param cacheDir - Cache directory
 * @returns Cache status or null if no cache exists
 */
export async function getCacheStatus(
	cacheDir?: string,
): Promise<{ exists: boolean; age?: number; url?: string } | null> {
	const cacheFile = getCacheFilePath(cacheDir);

	try {
		if (!fs.existsSync(cacheFile)) {
			return { exists: false };
		}

		const content = await fs.promises.readFile(cacheFile, "utf-8");
		const cached = JSON.parse(content) as CachedRegistry;

		return {
			exists: true,
			age: Date.now() - cached.timestamp,
			url: cached.url,
		};
	} catch {
		// Cache status check failed (corrupted, permission issue, etc.).
		// Report as non-existent since we can't reliably use it anyway.
		return { exists: false };
	}
}
