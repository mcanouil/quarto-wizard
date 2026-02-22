import type { SchemaCache, ExtensionSchema } from "@quarto-wizard/schema";
import { formatExtensionId, type InstalledExtension } from "@quarto-wizard/core";
import { getInstalledExtensionsCached } from "./installedExtensionsCache";

interface WorkspaceSchemaIndexEntry {
	expiresAt: number;
	value: WorkspaceSchemaIndex;
	inFlight?: Promise<WorkspaceSchemaIndex>;
}

export interface WorkspaceSchemaIndex {
	schemaMap: Map<string, ExtensionSchema>;
	extMap: Map<string, InstalledExtension>;
}

const cache = new Map<string, WorkspaceSchemaIndexEntry>();
const DEFAULT_TTL_MS = 2000;

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
		if (!schemaMap.has(shortName)) {
			schemaMap.set(shortName, schema);
		}

		if (!extMap.has(id)) {
			extMap.set(id, ext);
		}
		if (!extMap.has(shortName)) {
			extMap.set(shortName, ext);
		}
	}

	return { schemaMap, extMap };
}

export async function getWorkspaceSchemaIndex(
	workspacePath: string,
	schemaCache: SchemaCache,
	ttlMs = DEFAULT_TTL_MS,
): Promise<WorkspaceSchemaIndex> {
	const now = Date.now();
	const entry = cache.get(workspacePath);

	if (entry?.value && entry.expiresAt > now) {
		return entry.value;
	}
	if (entry?.inFlight) {
		return entry.inFlight;
	}

	const inFlight = buildWorkspaceSchemaIndex(workspacePath, schemaCache)
		.then((value) => {
			const currentEntry = cache.get(workspacePath);
			if (currentEntry?.inFlight === inFlight) {
				cache.set(workspacePath, {
					value,
					expiresAt: Date.now() + ttlMs,
				});
			}
			return value;
		})
		.catch((error) => {
			const currentEntry = cache.get(workspacePath);
			if (currentEntry?.inFlight === inFlight) {
				cache.delete(workspacePath);
			}
			throw error;
		});

	cache.set(workspacePath, {
		value: entry?.value ?? { schemaMap: new Map(), extMap: new Map() },
		expiresAt: entry?.expiresAt ?? 0,
		inFlight,
	});

	return inFlight;
}

export function invalidateWorkspaceSchemaIndex(workspacePath?: string): void {
	if (workspacePath) {
		cache.delete(workspacePath);
		return;
	}
	cache.clear();
}
