import * as vscode from "vscode";
import type { FieldDescriptor, SchemaCache, ExtensionSchema } from "@quarto-wizard/core";
import { discoverInstalledExtensions } from "@quarto-wizard/core";
import { parseAttributeAtPosition, type PandocElementType } from "../utils/elementAttributeParser";
import { getWordAtOffset, hasCompletableValues, buildAttributeDoc } from "../utils/schemaDocumentation";
import { isFilePathDescriptor, buildFilePathCompletions } from "../utils/filePathCompletion";
import { logMessage } from "../utils/log";

/**
 * A field descriptor paired with the name of the extension that provides it.
 */
export interface AttributeWithSource {
	descriptor: FieldDescriptor;
	source: string;
}

/**
 * Merged element attribute schemas: group name to attribute name to sourced descriptor.
 */
export type ElementAttributeSchemas = Record<string, Record<string, AttributeWithSource>>;

/**
 * Collect element attribute schemas from all installed extensions in the workspace.
 */
export async function collectElementAttributeSchemas(schemaCache: SchemaCache): Promise<ElementAttributeSchemas> {
	const result: ElementAttributeSchemas = {};
	const workspaceFolders = vscode.workspace.workspaceFolders;

	if (!workspaceFolders) {
		return result;
	}

	for (const folder of workspaceFolders) {
		try {
			const extensions = await discoverInstalledExtensions(folder.uri.fsPath);

			for (const ext of extensions) {
				const schema: ExtensionSchema | null = schemaCache.get(ext.directory);
				if (!schema?.elementAttributes) {
					continue;
				}

				const source = ext.manifest.title || ext.id.name;

				for (const [groupName, groupAttrs] of Object.entries(schema.elementAttributes)) {
					if (!result[groupName]) {
						result[groupName] = {};
					}
					for (const [attrName, descriptor] of Object.entries(groupAttrs)) {
						if (!(attrName in result[groupName])) {
							result[groupName][attrName] = { descriptor, source };
						}
					}
				}
			}
		} catch (error) {
			logMessage(
				`Failed to discover element attribute schemas in ${folder.uri.fsPath}: ${error instanceof Error ? error.message : String(error)}.`,
				"warn",
			);
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
 */
export function mergeApplicableAttributes(
	schemas: ElementAttributeSchemas,
	classes: string[],
	ids: string[],
	elementType: PandocElementType,
): Record<string, AttributeWithSource> {
	const merged: Record<string, AttributeWithSource> = {};

	// Always include _any.
	if (schemas["_any"]) {
		Object.assign(merged, schemas["_any"]);
	}

	// Include groups matching extracted classes.
	for (const cls of classes) {
		mergeGroup(schemas, cls, merged);
	}

	// Include groups matching ID prefixes (text before the first hyphen).
	for (const id of ids) {
		const hyphenIndex = id.indexOf("-");
		if (hyphenIndex > 0) {
			mergeGroup(schemas, id.substring(0, hyphenIndex), merged);
		}
	}

	// Include groups matching the Pandoc element type (Div, Span, Code, Header).
	mergeGroup(schemas, elementType, merged);
	// Also match CodeBlock for Code elements (common schema convention).
	if (elementType === "Code") {
		mergeGroup(schemas, "CodeBlock", merged);
	}

	return merged;
}

/**
 * Merge a single group into the merged attribute map (first-write wins).
 */
function mergeGroup(
	schemas: ElementAttributeSchemas,
	groupKey: string,
	merged: Record<string, AttributeWithSource>,
): void {
	if (!schemas[groupKey]) {
		return;
	}
	for (const [attrName, entry] of Object.entries(schemas[groupKey])) {
		if (!(attrName in merged)) {
			merged[attrName] = entry;
		}
	}
}

/**
 * Resolve an attribute entry by name or alias.
 */
export function resolveElementAttribute(
	attributes: Record<string, AttributeWithSource>,
	key: string,
): AttributeWithSource | undefined {
	if (key in attributes) {
		return attributes[key];
	}

	for (const entry of Object.values(attributes)) {
		if (entry.descriptor.aliases?.includes(key)) {
			return entry;
		}
	}

	return undefined;
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

			const parsed = parseAttributeAtPosition(text, offset);
			if (!parsed) {
				return null;
			}

			const schemas = await collectElementAttributeSchemas(this.schemaCache);
			if (Object.keys(schemas).length === 0) {
				return null;
			}

			const applicable = mergeApplicableAttributes(schemas, parsed.classes, parsed.ids, parsed.elementType);
			if (Object.keys(applicable).length === 0) {
				return null;
			}

			switch (parsed.cursorContext) {
				case "attributeKey":
					return this.completeAttributeKey(applicable, parsed.attributes);

				case "attributeValue":
					return this.completeAttributeValue(applicable, parsed.currentAttributeKey, document.uri);

				default:
					return null;
			}
		} catch (error) {
			logMessage(
				`Element attribute completion error: ${error instanceof Error ? error.message : String(error)}.`,
				"warn",
			);
			return null;
		}
	}

	private completeAttributeKey(
		attributes: Record<string, AttributeWithSource>,
		existingAttributes: Record<string, string>,
	): vscode.CompletionItem[] {
		const items: vscode.CompletionItem[] = [];
		const occupied = new Set(Object.keys(existingAttributes));

		for (const [attrName, { descriptor, source }] of Object.entries(attributes)) {
			// Skip the entire field (canonical + aliases) when any name is already present.
			const isOccupied = occupied.has(attrName) || descriptor.aliases?.some((a) => occupied.has(a));
			if (isOccupied) {
				continue;
			}

			const item = new vscode.CompletionItem(attrName, vscode.CompletionItemKind.Property);
			item.insertText = new vscode.SnippetString(`${attrName}=`);

			const docs = buildAttributeDoc(descriptor, source);
			if (docs) {
				item.documentation = docs;
			}

			item.detail = source;
			item.sortText = `${source}_${descriptor.required ? "0" : "1"}_${attrName}`;

			if (descriptor.deprecated) {
				item.tags = [vscode.CompletionItemTag.Deprecated];
			}

			if (hasCompletableValues(descriptor)) {
				item.command = { command: "editor.action.triggerSuggest", title: "Trigger Suggest" };
			}

			items.push(item);

			if (descriptor.aliases) {
				for (const alias of descriptor.aliases) {
					const aliasItem = new vscode.CompletionItem(alias, vscode.CompletionItemKind.Property);
					aliasItem.insertText = new vscode.SnippetString(`${alias}=`);
					aliasItem.detail = `${source} (alias for ${attrName})`;
					aliasItem.sortText = `${source}_1_${alias}`;
					if (docs) {
						aliasItem.documentation = docs;
					}
					if (hasCompletableValues(descriptor)) {
						aliasItem.command = { command: "editor.action.triggerSuggest", title: "Trigger Suggest" };
					}
					items.push(aliasItem);
				}
			}
		}

		return items;
	}

	private async completeAttributeValue(
		attributes: Record<string, AttributeWithSource>,
		attributeKey: string | undefined,
		documentUri: vscode.Uri,
	): Promise<vscode.CompletionItem[]> {
		if (!attributeKey) {
			return [];
		}

		const entry = resolveElementAttribute(attributes, attributeKey);
		if (!entry) {
			return [];
		}

		const { descriptor, source } = entry;
		const items: vscode.CompletionItem[] = [];

		if (descriptor.enum) {
			for (const value of descriptor.enum) {
				const label = String(value);
				const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Value);
				item.detail = source;
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

		if (descriptor.type === "boolean" && items.length === 0) {
			for (const label of ["true", "false"]) {
				const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Value);
				item.detail = source;
				items.push(item);
			}
		}

		return items;
	}
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

			const parsed = parseAttributeAtPosition(text, offset);
			if (!parsed) {
				return null;
			}

			const schemas = await collectElementAttributeSchemas(this.schemaCache);
			if (Object.keys(schemas).length === 0) {
				return null;
			}

			const applicable = mergeApplicableAttributes(schemas, parsed.classes, parsed.ids, parsed.elementType);
			if (Object.keys(applicable).length === 0) {
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
					const entry = resolveElementAttribute(applicable, word);
					if (!entry) {
						return null;
					}
					const docs = buildAttributeDoc(entry.descriptor, entry.source);
					if (!docs) {
						return null;
					}
					return new vscode.Hover(docs);
				}

				case "attributeValue": {
					if (!parsed.currentAttributeKey) {
						return null;
					}
					const entry = resolveElementAttribute(applicable, parsed.currentAttributeKey);
					if (!entry) {
						return null;
					}
					const docs = buildAttributeDoc(entry.descriptor, entry.source);
					if (!docs) {
						return null;
					}
					return new vscode.Hover(docs);
				}

				default:
					return null;
			}
		} catch (error) {
			logMessage(`Element attribute hover error: ${error instanceof Error ? error.message : String(error)}.`, "warn");
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
	const completionDisposable = vscode.languages.registerCompletionItemProvider(selector, completionProvider, " ", "=");
	context.subscriptions.push(completionDisposable);

	const hoverProvider = new ElementAttributeHoverProvider(schemaCache);
	const hoverDisposable = vscode.languages.registerHoverProvider(selector, hoverProvider);
	context.subscriptions.push(hoverDisposable);

	logMessage("Element attribute completion and hover providers registered.", "info");
}
