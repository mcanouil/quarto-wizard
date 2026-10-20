import type { SchemaCache, ExtensionSchema } from "@quarto-wizard/schema";
import { formatExtensionId, type InstalledExtension } from "@quarto-wizard/core";
import { getInstalledExtensionsCached } from "./installedExtensionsCache";
import { AsyncKeyedCache } from "./asyncKeyedCache";

export interface WorkspaceSchemaIndex {
	schemaMap: Map<string, ExtensionSchema>;
	extMap: Map<string, InstalledExtension>;
}

const caches = new Map<SchemaCache, AsyncKeyedCache<WorkspaceSchemaIndex>>();

function ensureCache(schemaCache: SchemaCache): AsyncKeyedCache<WorkspaceSchemaIndex> {
	let cache = caches.get(schemaCache);
	if (!cache) {
		cache = new AsyncKeyedCache((workspacePath: string) => buildWorkspaceSchemaIndex(workspacePath, schemaCache));
		caches.set(schemaCache, cache);
	}
	return cache;
}

async function buildWorkspaceSchemaIndex(
	workspacePath: string,
	schemaCache: SchemaCache,
): Promise<WorkspaceSchemaIndex> {
	const extensions = await getInstalledExtensionsCached(workspacePath);
	const schemaMap = new Map<string, ExtensionSchema>();
	const extMap = new Map<string, InstalledExtension>();

	for (const ext of extensions) {
		const schema = schemaCache.get(ext.directory);
		if (!schema) {
			continue;
		}

		const id = formatExtensionId(ext.id);
		const shortName = ext.id.name;
		schemaMap.set(id, schema);
		extMap.set(id, ext);
		// The short name of an ownerless extension is its full id, so it wins
		// over an owned extension of the same name, which only borrows the key.
		if (id !== shortName && !schemaMap.has(shortName)) {
			schemaMap.set(shortName, schema);
			extMap.set(shortName, ext);
		}
	}

	return { schemaMap, extMap };
}

export async function getWorkspaceSchemaIndex(
	workspacePath: string,
	schemaCache: SchemaCache,
): Promise<WorkspaceSchemaIndex> {
	return ensureCache(schemaCache).get(workspacePath);
}

export function invalidateWorkspaceSchemaIndex(workspacePath?: string): void {
	for (const cache of caches.values()) {
		cache.invalidate(workspacePath);
	}
}
