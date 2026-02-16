import * as vscode from "vscode";
import type { ShortcodeSchema, FieldDescriptor, SchemaCache } from "@quarto-wizard/core";
import { discoverInstalledExtensions } from "@quarto-wizard/core";
import { parseShortcodeAtPosition } from "../utils/shortcodeParser";
import { getWordAtOffset, hasCompletableValues, buildAttributeDoc } from "../utils/schemaDocumentation";
import { logMessage } from "../utils/log";

/**
 * Provides autocompletion for Quarto shortcodes ({{< name key="value" >}}).
 *
 * Completion is offered in three contexts:
 * 1. After {{< : suggests known shortcode names from discovered extension schemas.
 * 2. After the shortcode name: suggests attribute names from the schema.
 * 3. After an attribute = sign: suggests enum values or completion spec hints.
 */
export class ShortcodeCompletionProvider implements vscode.CompletionItemProvider {
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

			const parsed = parseShortcodeAtPosition(text, offset);
			if (!parsed) {
				return null;
			}

			const schemas = await this.collectShortcodeSchemas();
			if (schemas.size === 0) {
				return null;
			}

			switch (parsed.cursorContext) {
				case "name": {
					const needsLeadingSpace = offset > 0 && text[offset - 1] !== " ";
					return this.completeShortcodeName(schemas, parsed.name, needsLeadingSpace);
				}

				case "attributeKey":
					return this.completeAttributeKey(schemas, parsed.name, parsed.attributes);

				case "attributeValue":
					return this.completeAttributeValue(schemas, parsed.name, parsed.currentAttributeKey);

				case "argument": {
					const argItems = this.completeArgument(schemas, parsed.name, parsed.arguments);
					const attrItems = this.completeAttributeKey(schemas, parsed.name, parsed.attributes);
					return [...argItems, ...attrItems];
				}

				default:
					return null;
			}
		} catch (error) {
			logMessage(`Shortcode completion error: ${error instanceof Error ? error.message : String(error)}.`, "warn");
			return null;
		}
	}

	/**
	 * Suggest shortcode names matching the partial input.
	 */
	private completeShortcodeName(
		schemas: Map<string, ShortcodeSchema>,
		partial: string | null,
		needsLeadingSpace: boolean,
	): vscode.CompletionItem[] {
		const items: vscode.CompletionItem[] = [];

		for (const [name, schema] of schemas) {
			if (partial && !name.startsWith(partial)) {
				continue;
			}

			const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
			if (needsLeadingSpace) {
				item.insertText = ` ${name}`;
			}
			if (schema.description) {
				item.documentation = new vscode.MarkdownString(schema.description);
			}
			item.detail = "Quarto shortcode";
			items.push(item);
		}

		return items;
	}

	/**
	 * Suggest attribute names for the given shortcode.
	 */
	private completeAttributeKey(
		schemas: Map<string, ShortcodeSchema>,
		name: string | null,
		existingAttributes: Record<string, string>,
	): vscode.CompletionItem[] {
		if (!name) {
			return [];
		}

		const schema = schemas.get(name);
		if (!schema?.attributes) {
			return [];
		}

		const items: vscode.CompletionItem[] = [];
		const occupied = new Set(Object.keys(existingAttributes));

		for (const [attrName, descriptor] of Object.entries(schema.attributes)) {
			// Skip the entire field (canonical + aliases) when any name is already present.
			const isOccupied = occupied.has(attrName) || descriptor.aliases?.some((a) => occupied.has(a));
			if (isOccupied) {
				continue;
			}

			const item = new vscode.CompletionItem(attrName, vscode.CompletionItemKind.Property);
			item.insertText = new vscode.SnippetString(`${attrName}=`);

			const docs = buildAttributeDoc(descriptor);
			if (docs) {
				item.documentation = docs;
			}

			if (descriptor.required) {
				item.sortText = `0_${attrName}`;
			}

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
					aliasItem.detail = `Alias for ${attrName}`;
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

	/**
	 * Suggest values for the given attribute.
	 */
	private completeAttributeValue(
		schemas: Map<string, ShortcodeSchema>,
		name: string | null,
		attributeKey: string | undefined,
	): vscode.CompletionItem[] {
		if (!name || !attributeKey) {
			return [];
		}

		const schema = schemas.get(name);
		if (!schema?.attributes) {
			return [];
		}

		const descriptor = resolveShortcodeAttribute(schema, attributeKey);
		if (!descriptor) {
			return [];
		}

		return this.buildValueCompletions(descriptor);
	}

	/**
	 * Suggest positional argument values.
	 */
	private completeArgument(
		schemas: Map<string, ShortcodeSchema>,
		name: string | null,
		existingArgs: string[],
	): vscode.CompletionItem[] {
		if (!name) {
			return [];
		}

		const schema = schemas.get(name);
		if (!schema?.arguments) {
			return [];
		}

		const argIndex = existingArgs.length;
		if (argIndex >= schema.arguments.length) {
			return [];
		}

		const argDescriptor = schema.arguments[argIndex];
		const items = this.buildValueCompletions(argDescriptor);

		// Trigger the next completion automatically after accepting a positional argument.
		for (const item of items) {
			item.command = { command: "editor.action.triggerSuggest", title: "Trigger Suggest" };
		}

		return items;
	}

	/**
	 * Build completion items from a field descriptor's enum or completion spec.
	 */
	private buildValueCompletions(descriptor: FieldDescriptor): vscode.CompletionItem[] {
		const items: vscode.CompletionItem[] = [];

		if (descriptor.enum) {
			for (const value of descriptor.enum) {
				const label = String(value);
				const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Value);
				if (descriptor.description) {
					item.documentation = new vscode.MarkdownString(descriptor.description);
				}
				items.push(item);
			}
		}

		if (descriptor.completion?.values) {
			for (const value of descriptor.completion.values) {
				// Avoid duplicating items already added from enum
				if (descriptor.enum?.includes(value)) {
					continue;
				}
				const item = new vscode.CompletionItem(value, vscode.CompletionItemKind.Value);
				items.push(item);
			}
		}

		if (descriptor.type === "boolean" && items.length === 0) {
			items.push(new vscode.CompletionItem("true", vscode.CompletionItemKind.Value));
			items.push(new vscode.CompletionItem("false", vscode.CompletionItemKind.Value));
		}

		return items;
	}

	/**
	 * Discover all shortcode schemas from installed extensions in the workspace.
	 */
	private async collectShortcodeSchemas(): Promise<Map<string, ShortcodeSchema>> {
		return collectShortcodeSchemas(this.schemaCache);
	}
}

/**
 * Discover all shortcode schemas from installed extensions in the workspace.
 *
 * @param schemaCache - Shared schema cache instance.
 * @returns A map of shortcode name to schema.
 */
export async function collectShortcodeSchemas(schemaCache: SchemaCache): Promise<Map<string, ShortcodeSchema>> {
	const result = new Map<string, ShortcodeSchema>();
	const workspaceFolders = vscode.workspace.workspaceFolders;

	if (!workspaceFolders) {
		return result;
	}

	for (const folder of workspaceFolders) {
		try {
			const extensions = await discoverInstalledExtensions(folder.uri.fsPath);

			for (const ext of extensions) {
				const schema = schemaCache.get(ext.directory);
				if (!schema?.shortcodes) {
					continue;
				}

				for (const [name, shortcodeSchema] of Object.entries(schema.shortcodes)) {
					if (!result.has(name)) {
						result.set(name, shortcodeSchema);
					}
				}
			}
		} catch (error) {
			logMessage(
				`Failed to discover shortcode schemas in ${folder.uri.fsPath}: ${error instanceof Error ? error.message : String(error)}.`,
				"warn",
			);
		}
	}

	return result;
}

/**
 * Resolve an attribute descriptor by name or alias from a shortcode schema.
 */
export function resolveShortcodeAttribute(schema: ShortcodeSchema, key: string): FieldDescriptor | undefined {
	if (!schema.attributes) {
		return undefined;
	}

	if (key in schema.attributes) {
		return schema.attributes[key];
	}

	for (const descriptor of Object.values(schema.attributes)) {
		if (descriptor.aliases?.includes(key)) {
			return descriptor;
		}
	}

	return undefined;
}

/**
 * Provides hover information for Quarto shortcodes ({{< name key="value" >}}).
 *
 * Shows documentation for:
 * 1. Shortcode names: the shortcode description.
 * 2. Attribute keys: the attribute description, type, default, enum values, deprecation.
 * 3. Attribute values: the parent attribute description.
 */
export class ShortcodeHoverProvider implements vscode.HoverProvider {
	private schemaCache: SchemaCache;

	constructor(schemaCache: SchemaCache) {
		this.schemaCache = schemaCache;
	}

	async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | null> {
		try {
			const text = document.getText();
			const offset = document.offsetAt(position);

			const parsed = parseShortcodeAtPosition(text, offset);
			if (!parsed) {
				return null;
			}

			const schemas = await collectShortcodeSchemas(this.schemaCache);
			if (schemas.size === 0) {
				return null;
			}

			const word = getWordAtOffset(text, offset);
			if (!word) {
				return null;
			}

			switch (parsed.cursorContext) {
				case "name":
					return this.hoverShortcodeName(schemas, word);

				case "attributeKey":
					return this.hoverAttributeKey(schemas, parsed.name, word);

				case "attributeValue":
					return this.hoverAttributeValue(schemas, parsed.name, parsed.currentAttributeKey);

				default:
					return null;
			}
		} catch (error) {
			logMessage(`Shortcode hover error: ${error instanceof Error ? error.message : String(error)}.`, "warn");
			return null;
		}
	}

	private hoverShortcodeName(schemas: Map<string, ShortcodeSchema>, word: string): vscode.Hover | null {
		const schema = schemas.get(word);
		if (!schema?.description) {
			return null;
		}

		const md = new vscode.MarkdownString();
		md.appendMarkdown(`**Shortcode: \`${word}\`**\n\n`);
		md.appendMarkdown(schema.description);
		return new vscode.Hover(md);
	}

	private hoverAttributeKey(
		schemas: Map<string, ShortcodeSchema>,
		name: string | null,
		word: string,
	): vscode.Hover | null {
		if (!name) {
			return null;
		}

		const schema = schemas.get(name);
		if (!schema) {
			return null;
		}

		const descriptor = resolveShortcodeAttribute(schema, word);
		if (!descriptor) {
			return null;
		}

		const docs = buildAttributeDoc(descriptor);
		if (!docs) {
			return null;
		}

		return new vscode.Hover(docs);
	}

	private hoverAttributeValue(
		schemas: Map<string, ShortcodeSchema>,
		name: string | null,
		attributeKey: string | undefined,
	): vscode.Hover | null {
		if (!name || !attributeKey) {
			return null;
		}

		const schema = schemas.get(name);
		if (!schema) {
			return null;
		}

		const descriptor = resolveShortcodeAttribute(schema, attributeKey);
		if (!descriptor) {
			return null;
		}

		const docs = buildAttributeDoc(descriptor);
		if (!docs) {
			return null;
		}

		return new vscode.Hover(docs);
	}
}

/**
 * Register the shortcode completion and hover providers.
 *
 * @param context - The extension context.
 * @param schemaCache - Shared schema cache instance.
 */
export function registerShortcodeCompletionProvider(context: vscode.ExtensionContext, schemaCache: SchemaCache): void {
	const selector: vscode.DocumentSelector = { language: "quarto" };

	const completionProvider = new ShortcodeCompletionProvider(schemaCache);
	const completionDisposable = vscode.languages.registerCompletionItemProvider(
		selector,
		completionProvider,
		" ",
		"=",
		"<",
	);
	context.subscriptions.push(completionDisposable);

	const hoverProvider = new ShortcodeHoverProvider(schemaCache);
	const hoverDisposable = vscode.languages.registerHoverProvider(selector, hoverProvider);
	context.subscriptions.push(hoverDisposable);

	logMessage("Shortcode completion and hover providers registered.", "info");
}
