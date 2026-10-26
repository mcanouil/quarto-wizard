import type { ExtensionSchema, FieldDescriptor, SchemaCache } from "@quarto-wizard/schema";
import { formatExtensionId, getErrorMessage } from "@quarto-wizard/core";
import { getInstalledExtensionsCached } from "../utils/installedExtensionsCache";
import { ensureProjectRoots } from "../utils/projectRootsRegistry";
import { logMessage } from "../utils/log";
import { cellLanguageKey } from "../utils/cellOptions";
import {
	type ApplicableDeclarations,
	type ExtensionDeclarations,
	type GroupOrigin,
	combineDeclarations,
} from "./attributeDeclarations";

/**
 * Merged cell option schemas: language key (see `cellLanguageKey`) to the declarations of every extension.
 */
export type CellOptionSchemas = Record<string, ApplicableDeclarations>;

/**
 * The `cells` source of one installed extension.
 * `id` identifies the extension, so one installed in several project roots counts once.
 */
export interface CellSchemaEntry {
	source: string;
	schema: ExtensionSchema;
	id?: string;
}

/**
 * Merge the `cells` sections of several extension schemas, in load order.
 *
 * Every extension that declares an option for a language keeps its declaration.
 * An entry whose `id` repeats an earlier one is skipped.
 * Maps have no prototype, so a language or option named `constructor` is an ordinary key.
 */
export function mergeCellSchemas(entries: readonly CellSchemaEntry[]): CellOptionSchemas {
	const perLanguage = new Map<string, ExtensionDeclarations[]>();

	entries.forEach(({ source, schema, id }, index) => {
		const sourceId = id ?? `#${index}`;
		for (const [rawLanguage, cell] of Object.entries(schema.cells ?? {})) {
			const language = cellLanguageKey(rawLanguage);
			const descriptors: Record<string, FieldDescriptor> = Object.create(null);
			const origins: Record<string, GroupOrigin> = Object.create(null);
			for (const [name, descriptor] of Object.entries(cell.options ?? {})) {
				descriptors[name] = descriptor;
				origins[name] = "any";
			}
			const declarations = perLanguage.get(language) ?? [];
			declarations.push({ source, sourceId, descriptors, origins });
			perLanguage.set(language, declarations);
		}
	});

	const result: CellOptionSchemas = Object.create(null);
	for (const [language, declarations] of perLanguage) {
		result[language] = combineDeclarations(declarations);
	}
	return result;
}

/**
 * Collect cell option schemas from all installed extensions in the workspace.
 */
export async function collectCellOptionSchemas(schemaCache: SchemaCache): Promise<CellOptionSchemas> {
	const roots = await ensureProjectRoots();
	const perRoot = await Promise.all(
		roots.map(async (root) => {
			try {
				return await getInstalledExtensionsCached(root.fsPath);
			} catch (error) {
				logMessage(`Failed to discover cell option schemas in ${root.fsPath}: ${getErrorMessage(error)}.`, "warn");
				return [];
			}
		}),
	);

	const entries: CellSchemaEntry[] = [];
	for (const extensions of perRoot) {
		for (const ext of extensions) {
			const schema: ExtensionSchema | null = schemaCache.get(ext.directory);
			if (schema?.cells) {
				entries.push({ source: ext.manifest.title || ext.id.name, schema, id: formatExtensionId(ext.id) });
			}
		}
	}

	return mergeCellSchemas(entries);
}
