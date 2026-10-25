import type { ExtensionSchema, SchemaCache } from "@quarto-wizard/schema";
import { getErrorMessage } from "@quarto-wizard/core";
import { getInstalledExtensionsCached } from "../utils/installedExtensionsCache";
import { ensureProjectRoots } from "../utils/projectRootsRegistry";
import { logMessage } from "../utils/log";
import type { AttributeWithSource } from "./elementAttributeCompletionProvider";

/**
 * A cell option paired with the extension that provides it.
 * `conflicts` holds the sources of the other extensions that declare the same name or alias.
 */
export interface CellOptionWithSource extends AttributeWithSource {
	conflicts: string[];
}

/**
 * Merged cell option schemas: lower-cased language to option name to sourced descriptor.
 */
export type CellOptionSchemas = Record<string, Record<string, CellOptionWithSource>>;

interface OwnedOption {
	name: string;
	option: CellOptionWithSource;
	owner: number;
}

function optionKeys(name: string, aliases: readonly string[] | undefined): string[] {
	return [name, ...(aliases ?? [])];
}

function addConflict(option: CellOptionWithSource, source: string): void {
	if (!option.conflicts.includes(source)) {
		option.conflicts.push(source);
	}
}

/**
 * Merge the `cells` sections of several extension schemas, in load order.
 *
 * The first extension to declare an option name or alias for a language wins.
 * Every extension that declares an overlapping name or alias is recorded in `conflicts`.
 * Maps have no prototype, so a language or option named `constructor` is an ordinary key.
 */
export function mergeCellSchemas(entries: readonly { source: string; schema: ExtensionSchema }[]): CellOptionSchemas {
	const result: CellOptionSchemas = Object.create(null);
	const owned = new Map<string, OwnedOption[]>();

	entries.forEach(({ source, schema }, owner) => {
		for (const [rawLanguage, cell] of Object.entries(schema.cells ?? {})) {
			const language = rawLanguage.toLowerCase();
			const options = (result[language] ??= Object.create(null) as Record<string, CellOptionWithSource>);
			const languageOwned = owned.get(language) ?? [];
			owned.set(language, languageOwned);

			for (const [name, descriptor] of Object.entries(cell.options ?? {})) {
				const keys = optionKeys(name, descriptor.aliases);
				const option: CellOptionWithSource = { descriptor, source, conflicts: [] };
				let sameName = false;

				for (const earlier of languageOwned) {
					if (earlier.owner === owner) {
						continue;
					}
					const earlierKeys = optionKeys(earlier.name, earlier.option.descriptor.aliases);
					if (!keys.some((key) => earlierKeys.includes(key))) {
						continue;
					}
					addConflict(earlier.option, source);
					addConflict(option, earlier.option.source);
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

	const entries: { source: string; schema: ExtensionSchema }[] = [];
	for (const extensions of perRoot) {
		for (const ext of extensions) {
			const schema: ExtensionSchema | null = schemaCache.get(ext.directory);
			if (schema?.cells) {
				entries.push({ source: ext.manifest.title || ext.id.name, schema });
			}
		}
	}

	return mergeCellSchemas(entries);
}
