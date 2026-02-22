import { discoverInstalledExtensions, type InstalledExtension } from "@quarto-wizard/core";
import { AsyncKeyedCache } from "./asyncKeyedCache";

const cache = new AsyncKeyedCache<InstalledExtension[]>(discoverInstalledExtensions, []);

export async function getInstalledExtensionsCached(workspacePath: string): Promise<InstalledExtension[]> {
	return cache.get(workspacePath);
}

export function invalidateInstalledExtensionsCache(workspacePath?: string): void {
	cache.invalidate(workspacePath);
}
