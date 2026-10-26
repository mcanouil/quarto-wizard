import * as vscode from "vscode";
import type { FieldDescriptor, SchemaCache, ExtensionSchema } from "@quarto-wizard/schema";
import { typeIncludes } from "@quarto-wizard/schema";
import { formatExtensionId, getErrorMessage } from "@quarto-wizard/core";
import { getInstalledExtensionsCached } from "../utils/installedExtensionsCache";
import { ensureProjectRoots } from "../utils/projectRootsRegistry";
import { parseAttributeAtPosition, type PandocElementType } from "../utils/elementAttributeParser";
import { getWordAtOffset, hasCompletableValues, buildDeclarationsDoc } from "../utils/schemaDocumentation";
import { isFilePathDescriptor, buildFilePathCompletions } from "../utils/filePathCompletion";
import { getDocumentFencedBlocks } from "../utils/documentScan";
import { logMessage } from "../utils/log";
import {
	type ApplicableDeclarations,
	type AttributeDeclaration,
	type ExtensionDeclarations,
	type GroupOrigin,
	combineDeclarations,
	resolveDeclarations,
} from "./attributeDeclarations";

/**
 * The `attributes` section of one installed extension: group name to attribute name to descriptor.
 * `sourceId` identifies the extension, so one installed in several project roots counts once.
 */
export interface ExtensionAttributeSchema {
	source: string;
	sourceId: string;
	groups: Record<string, Record<string, FieldDescriptor>>;
}

/**
 * Group names reserved for Pandoc element types and the catch-all group.
 * These are not treated as implicit class names when collecting class definitions.
 */
const RESERVED_GROUP_NAMES = new Set(["Div", "Span", "Code", "CodeBlock", "Header", "_any"]);

/**
 * A class name paired with its description and the extension that provides it.
 */
export interface ClassWithSource {
	description?: string;
	source: string;
}

/**
 * Collection of class definitions keyed by class name.
 */
export type ClassDefinitions = Record<string, ClassWithSource>;

/**
 * Collect the element attribute schemas of all installed extensions in the workspace, in discovery order.
 * An extension installed in several project roots is collected once.
 */
export async function collectElementAttributeSchemas(schemaCache: SchemaCache): Promise<ExtensionAttributeSchema[]> {
	const result: ExtensionAttributeSchema[] = [];
	const seen = new Set<string>();
	const roots = await ensureProjectRoots();
	const perRoot = await Promise.all(
		roots.map(async (root) => {
			try {
				return await getInstalledExtensionsCached(root.fsPath);
			} catch (error) {
				logMessage(
					`Failed to discover element attribute schemas in ${root.fsPath}: ${getErrorMessage(error)}.`,
					"warn",
				);
				return [];
			}
		}),
	);

	for (const extensions of perRoot) {
		for (const ext of extensions) {
			const schema: ExtensionSchema | null = schemaCache.get(ext.directory);
			if (!schema?.attributes) {
				continue;
			}

			const sourceId = formatExtensionId(ext.id);
			if (seen.has(sourceId)) {
				continue;
			}
			seen.add(sourceId);
			result.push({ source: ext.manifest.title || ext.id.name, sourceId, groups: schema.attributes });
		}
	}

	return result;
}

/**
 * Collect class definitions from all installed extensions in the workspace.
 *
 * Gathers explicit class definitions from `schema.classes` and implicit class
 * names from `schema.attributes` group keys (excluding reserved element-type
 * and catch-all groups).
 */
export async function collectClassDefinitions(schemaCache: SchemaCache): Promise<ClassDefinitions> {
	const result: ClassDefinitions = {};
	const roots = await ensureProjectRoots();
	const perRoot = await Promise.all(
		roots.map(async (root) => {
			try {
				return await getInstalledExtensionsCached(root.fsPath);
			} catch (error) {
				logMessage(`Failed to discover class definitions in ${root.fsPath}: ${getErrorMessage(error)}.`, "warn");
				return [];
			}
		}),
	);

	for (const extensions of perRoot) {
		for (const ext of extensions) {
			const schema: ExtensionSchema | null = schemaCache.get(ext.directory);
			if (!schema) {
				continue;
			}

			const source = ext.manifest.title || ext.id.name;

			if (schema.classes) {
				for (const [className, classDef] of Object.entries(schema.classes)) {
					if (!(className in result)) {
						result[className] = {
							description: classDef.description,
							source,
						};
					}
				}
			}

			if (schema.attributes) {
				for (const groupKey of Object.keys(schema.attributes)) {
					if (RESERVED_GROUP_NAMES.has(groupKey)) {
						continue;
					}
					if (!(groupKey in result)) {
						result[groupKey] = { source };
					}
				}
			}
		}
	}

	return result;
}

/**
 * Merge applicable attribute groups based on extracted classes and IDs.
 * Always includes the "_any" group.  ID prefixes (the part before the
 * first hyphen, e.g. "modal" from "modal-example") are matched against
 * group keys so that extensions using ID-prefix conventions (like
 * `modal-*` divs) get their attributes resolved.
 *
 * Inside one extension the most specific group wins.  The declarations
 * of different extensions are kept side by side.
 */
export function mergeApplicableAttributes(
	schemas: readonly ExtensionAttributeSchema[],
	classes: string[],
	ids: string[],
	elementType: PandocElementType,
): ApplicableDeclarations {
	const perExtension = schemas
		.map((schema) => mergeExtensionGroups(schema, classes, ids, elementType))
		.filter((ext) => Object.keys(ext.descriptors).length > 0);
	return combineDeclarations(perExtension);
}

/**
 * Merge the applicable groups of one extension.
 */
function mergeExtensionGroups(
	schema: ExtensionAttributeSchema,
	classes: string[],
	ids: string[],
	elementType: PandocElementType,
): ExtensionDeclarations {
	const merged: ExtensionDeclarations = {
		source: schema.source,
		sourceId: schema.sourceId,
		descriptors: Object.create(null),
		origins: Object.create(null),
	};
	const { groups } = schema;

	// Include groups matching extracted classes.
	for (const cls of classes) {
		mergeGroup(groups, cls, merged, "classOrId");
	}

	// Include groups matching ID prefixes (text before the first hyphen).
	for (const id of ids) {
		const hyphenIndex = id.indexOf("-");
		if (hyphenIndex > 0) {
			mergeGroup(groups, id.substring(0, hyphenIndex), merged, "classOrId");
		}
	}

	// Include groups matching the Pandoc element type (Div, Span, Code, Header).
	mergeGroup(groups, elementType, merged, "elementType");
	// Also match CodeBlock for Code elements (common schema convention).
	if (elementType.toLowerCase() === "code") {
		mergeGroup(groups, "CodeBlock", merged, "elementType");
	}

	// Include _any last so specific groups take precedence, and tag entries
	// so they sort after specific-group attributes.
	mergeGroup(groups, "_any", merged, "any");

	return merged;
}

/**
 * Merge a single group of one extension into its merged fields (first-write wins).
 */
function mergeGroup(
	groups: Record<string, Record<string, FieldDescriptor>>,
	groupKey: string,
	merged: ExtensionDeclarations,
	origin: GroupOrigin,
): void {
	const lowerKey = groupKey.toLowerCase();
	for (const schemaKey of Object.keys(groups)) {
		if (schemaKey.toLowerCase() !== lowerKey) {
			continue;
		}
		for (const [attrName, descriptor] of Object.entries(groups[schemaKey])) {
			if (!Object.hasOwn(merged.descriptors, attrName)) {
				merged.descriptors[attrName] = descriptor;
				merged.origins[attrName] = origin;
			}
		}
	}
}

/**
 * Compute a single-character sort tier for an attribute.
 *
 * Lower values sort first (top of the completion menu):
 * - 0: class/ID required
 * - 1: class/ID optional or alias
 * - 2: element-type required
 * - 3: element-type optional or alias
 * - 4: _any required
 * - 5: _any optional or alias
 * - 9: deprecated
 *
 * Aliases are never "required", so they use the optional tier within their group.
 */
function attributeSortTier(descriptor: FieldDescriptor, origin: GroupOrigin = "any", isAlias?: boolean): string {
	if (descriptor.deprecated) {
		return "9";
	}
	const req = descriptor.required && !isAlias;
	switch (origin) {
		case "classOrId":
			return req ? "0" : "1";
		case "elementType":
			return req ? "2" : "3";
		case "any":
			return req ? "4" : "5";
	}
}

/**
 * Provides autocompletion for Pandoc element attributes ({.class attr=value}).
 *
 * Completion is offered in two contexts:
 * 1. Attribute keys: suggests attribute names from the applicable schema groups.
 * 2. Attribute values: suggests enum values or completion spec hints.
 */
export class ElementAttributeCompletionProvider implements vscode.CompletionItemProvider {
	private schemaCache: SchemaCache;

	constructor(schemaCache: SchemaCache) {
		this.schemaCache = schemaCache;
	}

	async provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
	): Promise<vscode.CompletionItem[] | null> {
		try {
			const text = document.getText();
			const offset = document.offsetAt(position);

			// Suppress suggestions when the cursor is immediately followed by
			// an alphanumeric character or a quote, which indicates the cursor
			// is in the middle of an existing token rather than at a boundary.
			if (offset < text.length && /[\w"']/.test(text[offset])) {
				return null;
			}

			const codeBlockRanges = getDocumentFencedBlocks(document, text);
			const parsed = parseAttributeAtPosition(text, offset, codeBlockRanges);
			if (!parsed) {
				return null;
			}

			// Handle class name completion before checking attribute schemas,
			// as class names can be suggested even without applicable attributes.
			if (parsed.cursorContext === "className") {
				return this.completeClassName(parsed.classes, parsed.currentWord);
			}

			const schemas = await collectElementAttributeSchemas(this.schemaCache);
			if (schemas.length === 0) {
				return null;
			}

			const applicable = mergeApplicableAttributes(schemas, parsed.classes, parsed.ids, parsed.elementType);
			if (Object.keys(applicable.byName).length === 0) {
				return null;
			}

			switch (parsed.cursorContext) {
				case "attributeKey":
					return this.completeAttributeKey(applicable, parsed.attributes, parsed.classes);

				case "attributeValue":
					return this.completeAttributeValue(applicable, parsed.currentAttributeKey, document.uri);

				default:
					return null;
			}
		} catch (error) {
			logMessage(`Element attribute completion error: ${getErrorMessage(error)}.`, "warn");
			return null;
		}
	}

	private async completeAttributeKey(
		attributes: ApplicableDeclarations,
		existingAttributes: Record<string, string>,
		existingClasses: string[],
	): Promise<vscode.CompletionItem[]> {
		const items = attributeKeyItems(attributes, new Set(Object.keys(existingAttributes)), "=");

		// Include .classname suggestions (class names prefixed with dot), sorted
		// after attribute suggestions so attributes appear first.
		const classDefs = await collectClassDefinitions(this.schemaCache);
		const presentClasses = new Set(existingClasses);

		for (const [className, classDef] of Object.entries(classDefs)) {
			if (presentClasses.has(className)) {
				continue;
			}

			const label = `.${className}`;
			const classItem = new vscode.CompletionItem(label, vscode.CompletionItemKind.EnumMember);
			classItem.insertText = label;
			classItem.detail = classDef.source;
			classItem.sortText = `#0_${classDef.source}_${className}`;

			if (classDef.description) {
				classItem.documentation = new vscode.MarkdownString(classDef.description);
			}

			items.push(classItem);
		}

		return items;
	}

	private async completeClassName(
		existingClasses: string[],
		currentWord: string | undefined,
	): Promise<vscode.CompletionItem[]> {
		const classDefs = await collectClassDefinitions(this.schemaCache);
		const presentClasses = new Set(existingClasses);
		const items: vscode.CompletionItem[] = [];

		for (const [className, classDef] of Object.entries(classDefs)) {
			if (presentClasses.has(className)) {
				continue;
			}

			// Filter by prefix when the user has partially typed a class name.
			if (currentWord && !className.startsWith(currentWord)) {
				continue;
			}

			const item = new vscode.CompletionItem(className, vscode.CompletionItemKind.EnumMember);
			// The dot is already typed, so insert only the class name.
			item.insertText = className;
			item.detail = classDef.source;
			item.sortText = `!0_${classDef.source}_${className}`;

			if (classDef.description) {
				item.documentation = new vscode.MarkdownString(classDef.description);
			}

			items.push(item);
		}

		return items;
	}

	private async completeAttributeValue(
		applicable: ApplicableDeclarations,
		attributeKey: string | undefined,
		documentUri: vscode.Uri,
	): Promise<vscode.CompletionItem[]> {
		if (!attributeKey) {
			return [];
		}

		const declarations = resolveDeclarations(applicable, attributeKey);
		if (declarations.length === 0) {
			return [];
		}

		return attributeValueItems(declarations, documentUri);
	}
}

/**
 * Build the completion items for the attribute names of the applicable declarations.
 * A name has one item whose detail lists every declaring extension.
 * A field is skipped when its name or one of its aliases is in `occupied`.
 *
 * @param separator - What the inserted name ends with, such as `=` or `: `.
 */
export function attributeKeyItems(
	applicable: ApplicableDeclarations,
	occupied: ReadonlySet<string>,
	separator: string,
): vscode.CompletionItem[] {
	const items: vscode.CompletionItem[] = [];
	const aliasLabels = new Set<string>();

	for (const [attrName, declarations] of Object.entries(applicable.byName)) {
		// Skip the entire field (canonical + aliases) when any name is already present.
		const isOccupied =
			occupied.has(attrName) || declarations.some(({ descriptor }) => descriptor.aliases?.some((a) => occupied.has(a)));
		if (isOccupied) {
			continue;
		}

		const sources = declarations.map(({ source }) => source).join(", ");
		const tier = declarations
			.map(({ descriptor, groupOrigin }) => attributeSortTier(descriptor, groupOrigin))
			.reduce((lowest, candidate) => (candidate < lowest ? candidate : lowest));
		const completable = declarations.some(({ descriptor }) => hasCompletableValues(descriptor));
		const docs = buildDeclarationsDoc(declarations);

		const item = new vscode.CompletionItem(attrName, vscode.CompletionItemKind.Property);
		item.insertText = new vscode.SnippetString(`${attrName}${separator}`);
		if (docs) {
			item.documentation = docs;
		}
		item.detail = sources;
		item.sortText = `!${tier}_${sources}_${attrName}`;

		// The tag shows only when every declaring extension deprecates the field.
		if (declarations.every(({ descriptor }) => descriptor.deprecated)) {
			item.tags = [vscode.CompletionItemTag.Deprecated];
		}

		if (completable) {
			item.command = { command: "editor.action.triggerSuggest", title: "Trigger Suggest" };
		}

		items.push(item);

		const aliases = new Set(declarations.flatMap(({ descriptor }) => descriptor.aliases ?? []));
		for (const alias of aliases) {
			if (aliasLabels.has(alias)) {
				continue;
			}
			aliasLabels.add(alias);
			const declaring = declarations.filter(({ descriptor }) => descriptor.aliases?.includes(alias));
			const aliasSources = declaring.map(({ source }) => source).join(", ");
			const aliasTier = declaring
				.map(({ descriptor, groupOrigin }) => attributeSortTier(descriptor, groupOrigin, true))
				.reduce((lowest, candidate) => (candidate < lowest ? candidate : lowest));

			const aliasItem = new vscode.CompletionItem(alias, vscode.CompletionItemKind.Property);
			aliasItem.insertText = new vscode.SnippetString(`${alias}${separator}`);
			aliasItem.detail = `${aliasSources} (alias for ${attrName})`;
			aliasItem.sortText = `!${aliasTier}_${aliasSources}_${alias}`;
			if (docs) {
				aliasItem.documentation = docs;
			}
			if (completable) {
				aliasItem.command = { command: "editor.action.triggerSuggest", title: "Trigger Suggest" };
			}
			items.push(aliasItem);
		}
	}

	return items;
}

/**
 * Build the completion items for the value of one attribute: enum values,
 * completion hints, file paths, and `true` or `false` for a boolean.
 * The items of every declaration are combined, and a value that several declare is offered once.
 */
export async function attributeValueItems(
	declarations: readonly AttributeDeclaration[],
	documentUri: vscode.Uri,
): Promise<vscode.CompletionItem[]> {
	const items: vscode.CompletionItem[] = [];
	const byLabel = new Map<string, vscode.CompletionItem>();

	for (const declaration of declarations) {
		for (const item of await declarationValueItems(declaration, documentUri)) {
			const label = typeof item.label === "string" ? item.label : item.label.label;
			const seen = byLabel.get(label);
			if (seen) {
				if (!String(seen.detail).split(", ").includes(declaration.source)) {
					seen.detail = `${seen.detail}, ${declaration.source}`;
				}
				continue;
			}
			byLabel.set(label, item);
			items.push(item);
		}
	}

	return items;
}

async function declarationValueItems(
	{ descriptor, source }: AttributeDeclaration,
	documentUri: vscode.Uri,
): Promise<vscode.CompletionItem[]> {
	const items: vscode.CompletionItem[] = [];

	if (descriptor.enum) {
		for (const value of descriptor.enum) {
			const label = String(value);
			const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Value);
			item.detail = source;
			item.sortText = `!1_${label}`;
			if (descriptor.description) {
				item.documentation = new vscode.MarkdownString(descriptor.description);
			}
			items.push(item);
		}
	}

	if (descriptor.completion?.values) {
		for (const value of descriptor.completion.values) {
			if (descriptor.enum?.includes(value)) {
				continue;
			}
			const item = new vscode.CompletionItem(value, vscode.CompletionItemKind.Value);
			item.detail = source;
			item.sortText = `!1_${value}`;
			items.push(item);
		}
	}

	if (isFilePathDescriptor(descriptor)) {
		const fileItems = await buildFilePathCompletions(descriptor, documentUri);
		for (const fileItem of fileItems) {
			fileItem.detail = source;
			items.push(fileItem);
		}
	}

	if (typeIncludes(descriptor.type, "boolean") && items.length === 0) {
		for (const label of ["true", "false"]) {
			const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Value);
			item.detail = source;
			item.sortText = `!1_${label}`;
			items.push(item);
		}
	}

	return items;
}

/**
 * Provides hover information for Pandoc element attributes ({.class attr=value}).
 *
 * Shows documentation for attribute keys and values based on the applicable schema groups.
 */
export class ElementAttributeHoverProvider implements vscode.HoverProvider {
	private schemaCache: SchemaCache;

	constructor(schemaCache: SchemaCache) {
		this.schemaCache = schemaCache;
	}

	async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | null> {
		try {
			const text = document.getText();
			const offset = document.offsetAt(position);

			const codeBlockRanges = getDocumentFencedBlocks(document, text);
			const parsed = parseAttributeAtPosition(text, offset, codeBlockRanges);
			if (!parsed) {
				return null;
			}

			// Handle class name hover before checking attribute schemas.
			if (parsed.cursorContext === "className") {
				const word = getWordAtOffset(text, offset);
				if (!word) {
					return null;
				}

				const classDefs = await collectClassDefinitions(this.schemaCache);
				const classDef = classDefs[word];
				if (!classDef) {
					return null;
				}

				const parts: string[] = [];
				parts.push(`*From extension:* **${classDef.source}**`);

				if (classDef.description) {
					parts.push(classDef.description);
				}

				// Check whether this class has attributes defined in the attribute schemas.
				const schemas = await collectElementAttributeSchemas(this.schemaCache);
				const lowerWord = word.toLowerCase();
				const attrNames = new Set<string>();
				for (const { groups } of schemas) {
					const schemaKey = Object.keys(groups).find((key) => key.toLowerCase() === lowerWord);
					for (const name of schemaKey === undefined ? [] : Object.keys(groups[schemaKey])) {
						attrNames.add(name);
					}
				}
				if (attrNames.size > 0) {
					parts.push(`Attributes: ${[...attrNames].map((n) => `\`${n}\``).join(", ")}`);
				}

				return new vscode.Hover(new vscode.MarkdownString(parts.join("\n\n")));
			}

			const schemas = await collectElementAttributeSchemas(this.schemaCache);
			if (schemas.length === 0) {
				return null;
			}

			const applicable = mergeApplicableAttributes(schemas, parsed.classes, parsed.ids, parsed.elementType);
			if (Object.keys(applicable.byName).length === 0) {
				return null;
			}

			// Extract the word at the hover position directly from the text
			// rather than relying on the language's word pattern via
			// getWordRangeAtPosition, which may not include hyphens or may
			// behave unexpectedly inside attribute blocks.
			const word = getWordAtOffset(text, offset);
			if (!word) {
				return null;
			}

			switch (parsed.cursorContext) {
				case "attributeKey": {
					const docs = buildDeclarationsDoc(resolveDeclarations(applicable, word));
					if (!docs) {
						return null;
					}
					return new vscode.Hover(docs);
				}

				case "attributeValue": {
					if (!parsed.currentAttributeKey) {
						return null;
					}
					const docs = buildDeclarationsDoc(resolveDeclarations(applicable, parsed.currentAttributeKey));
					if (!docs) {
						return null;
					}
					return new vscode.Hover(docs);
				}

				default:
					return null;
			}
		} catch (error) {
			logMessage(`Element attribute hover error: ${getErrorMessage(error)}.`, "warn");
			return null;
		}
	}
}

/**
 * Register the element attribute completion and hover providers.
 *
 * @param context - The extension context.
 * @param schemaCache - Shared schema cache instance.
 */
export function registerElementAttributeProviders(context: vscode.ExtensionContext, schemaCache: SchemaCache): void {
	const selector: vscode.DocumentSelector = { language: "quarto" };

	const completionProvider = new ElementAttributeCompletionProvider(schemaCache);
	const completionDisposable = vscode.languages.registerCompletionItemProvider(
		selector,
		completionProvider,
		" ",
		"=",
		"{",
		".",
	);
	context.subscriptions.push(completionDisposable);

	const hoverProvider = new ElementAttributeHoverProvider(schemaCache);
	const hoverDisposable = vscode.languages.registerHoverProvider(selector, hoverProvider);
	context.subscriptions.push(hoverDisposable);

	logMessage("Element attribute completion and hover providers registered.", "debug");
}
