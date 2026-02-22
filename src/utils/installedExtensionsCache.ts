import { discoverInstalledExtensions, type InstalledExtension } from "@quarto-wizard/core";

interface CacheEntry {
	expiresAt: number;
	value: InstalledExtension[];
	inFlight?: Promise<InstalledExtension[]>;
}

const cache = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 2000;

export async function getInstalledExtensionsCached(
	workspacePath: string,
	ttlMs = DEFAULT_TTL_MS,
): Promise<InstalledExtension[]> {
	const now = Date.now();
	const entry = cache.get(workspacePath);

	if (entry?.value && entry.expiresAt > now) {
		return entry.value;
	}
	if (entry?.inFlight) {
		return entry.inFlight;
	}

	const inFlight = discoverInstalledExtensions(workspacePath)
		.then((extensions) => {
			cache.set(workspacePath, {
				value: extensions,
				expiresAt: Date.now() + ttlMs,
			});
			return extensions;
		})
		.catch((error) => {
			cache.delete(workspacePath);
			throw error;
		});

	cache.set(workspacePath, {
		value: entry?.value ?? [],
		expiresAt: entry?.expiresAt ?? 0,
		inFlight,
	});

	return inFlight;
}

export function invalidateInstalledExtensionsCache(workspacePath?: string): void {
	if (workspacePath) {
		cache.delete(workspacePath);
		return;
	}
	cache.clear();
}
