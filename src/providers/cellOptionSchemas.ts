import type { ExtensionSchema, SchemaCache } from "@quarto-wizard/schema";
import { formatExtensionId, getErrorMessage } from "@quarto-wizard/core";
import { getInstalledExtensionsCached } from "../utils/installedExtensionsCache";
import { ensureProjectRoots } from "../utils/projectRootsRegistry";
import { logMessage } from "../utils/log";
import type { AttributeWithSource } from "./elementAttributeCompletionProvider";

/**
 * A cell option paired with the extension that provides it.
 * `conflicts` maps each contested name or alias to the sources of the other extensions that declare that spelling,
 * so a conflict is reported only on the spellings that overlap.
 */
export interface CellOptionWithSource extends AttributeWithSource {
	conflicts: Map<string, string[]>;
}

/**
 * Merged cell option schemas: lower-cased language to option name to sourced descriptor.
 */
export type CellOptionSchemas = Record<string, Record<string, CellOptionWithSource>>;

/**
 * The `cells` source of one installed extension.
 * `id` identifies the extension, so one installed in several project roots counts once.
 */
export interface CellSchemaEntry {
	source: string;
	schema: ExtensionSchema;
	id?: string;
}

interface OwnedOption {
	name: string;
	option: CellOptionWithSource;
	owner: number;
}

function optionKeys(name: string, aliases: readonly string[] | undefined): string[] {
	return [name, ...(aliases ?? [])];
}

function addConflict(option: CellOptionWithSource, source: string, contested: readonly string[]): void {
	for (const key of contested) {
		const sources = option.conflicts.get(key) ?? [];
		if (!sources.includes(source)) {
			sources.push(source);
		}
		option.conflicts.set(key, sources);
	}
}

/**
 * Merge the `cells` sections of several extension schemas, in load order.
 *
 * The first extension to declare an option name or alias for a language wins.
 * Every extension that declares an overlapping name or alias is recorded in `conflicts`.
 * An entry whose `id` repeats an earlier one is skipped.
 * Maps have no prototype, so a language or option named `constructor` is an ordinary key.
 */
export function mergeCellSchemas(entries: readonly CellSchemaEntry[]): CellOptionSchemas {
	const result: CellOptionSchemas = Object.create(null);
	const owned = new Map<string, OwnedOption[]>();
	const seen = new Set<string>();

	entries.forEach(({ source, schema, id }, owner) => {
		if (id !== undefined) {
			if (seen.has(id)) {
				return;
			}
			seen.add(id);
		}
		for (const [rawLanguage, cell] of Object.entries(schema.cells ?? {})) {
			const language = rawLanguage.toLowerCase();
			const options = (result[language] ??= Object.create(null) as Record<string, CellOptionWithSource>);
			let languageOwned = owned.get(language);
			if (languageOwned === undefined) {
				languageOwned = [];
				owned.set(language, languageOwned);
			}

			for (const [name, descriptor] of Object.entries(cell.options ?? {})) {
				const keys = optionKeys(name, descriptor.aliases);
				const option: CellOptionWithSource = { descriptor, source, conflicts: new Map() };
				let sameName = false;

				for (const earlier of languageOwned) {
					if (earlier.owner === owner) {
						continue;
					}
					const earlierKeys = optionKeys(earlier.name, earlier.option.descriptor.aliases);
					const shared = keys.filter((key) => earlierKeys.includes(key));
					if (shared.length === 0) {
						continue;
					}
					addConflict(earlier.option, source, shared);
					addConflict(option, earlier.option.source, shared);
					if (earlier.name === name) {
						sameName = true;
					}
				}

				if (!sameName) {
					options[name] = option;
					languageOwned.push({ name, option, owner });
				}
			}
		}
	});

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
