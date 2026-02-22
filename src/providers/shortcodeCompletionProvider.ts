import * as vscode from "vscode";
import type { ShortcodeSchema, FieldDescriptor, SchemaCache } from "@quarto-wizard/schema";
import { typeIncludes } from "@quarto-wizard/schema";
import { discoverInstalledExtensions, getErrorMessage } from "@quarto-wizard/core";
import { parseShortcodeAtPosition } from "../utils/shortcodeParser";
import { getWordAtOffset, hasCompletableValues, buildAttributeDoc } from "../utils/schemaDocumentation";
import { isFilePathDescriptor, buildFilePathCompletions } from "../utils/filePathCompletion";
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
	): Promise<vscode.CompletionItem[] | vscode.CompletionList | null> {
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

				case "attributeValue": {
					const items = await this.completeAttributeValue(
						schemas,
						parsed.name,
						parsed.currentAttributeKey,
						document.uri,
					);
					const hasFilePaths = items.some(
						(i) => i.kind === vscode.CompletionItemKind.File || i.kind === vscode.CompletionItemKind.Folder,
					);
					if (hasFilePaths) {
						const tokenStart = this.getTokenStart(text, offset);
						const filtered = this.filterToCurrentLevel(items, text, tokenStart, offset);
						this.setFilePathRange(filtered, tokenStart, document, position);
						return new vscode.CompletionList(filtered, true);
					}
					return items;
				}

				case "argument": {
					const argItems = await this.completeArgument(schemas, parsed.name, parsed.arguments, document.uri);
					const attrItems = this.completeAttributeKey(schemas, parsed.name, parsed.attributes);

					// Look up whether the current positional argument is required.
					const argSchema = parsed.name ? schemas.get(parsed.name) : undefined;
					const argIndex = parsed.arguments.length;
					const argRequired = argSchema?.arguments?.[argIndex]?.required ?? false;

					// Shift argument value tiers: required args to 0-1, optional args to 2-3.
					for (const item of argItems) {
						if (item.sortText?.startsWith("!1")) {
							item.sortText = (argRequired ? "!0" : "!2") + item.sortText.slice(2);
						} else if (item.sortText?.startsWith("!2")) {
							item.sortText = (argRequired ? "!1" : "!3") + item.sortText.slice(2);
						}
					}

					// Shift attribute key tiers below all argument values.
					for (const item of attrItems) {
						if (item.sortText?.startsWith("!0")) {
							item.sortText = "!4" + item.sortText.slice(2);
						} else if (item.sortText?.startsWith("!1")) {
							item.sortText = "!5" + item.sortText.slice(2);
						}
					}

					const allItems = [...argItems, ...attrItems];
					const hasFilePaths = argItems.some(
						(i) => i.kind === vscode.CompletionItemKind.File || i.kind === vscode.CompletionItemKind.Folder,
					);
					if (hasFilePaths) {
						const tokenStart = this.getTokenStart(text, offset);
						const filtered = this.filterToCurrentLevel(allItems, text, tokenStart, offset);
						this.setFilePathRange(filtered, tokenStart, document, position);
						return new vscode.CompletionList(filtered, true);
					}
					return allItems;
				}

				default:
					return null;
			}
		} catch (error) {
			logMessage(`Shortcode completion error: ${getErrorMessage(error)}.`, "warn");
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
			item.sortText = `!1_${name}`;
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

			const tier = descriptor.deprecated ? "9" : descriptor.required ? "0" : "1";
			item.sortText = `!${tier}_${attrName}`;

			if (descriptor.deprecated) {
				item.tags = [vscode.CompletionItemTag.Deprecated];
			}

			if (hasCompletableValues(descriptor)) {
				item.command = { command: "editor.action.triggerSuggest", title: "Trigger Suggest" };
			}

			items.push(item);

			if (descriptor.aliases) {
				const aliasTier = descriptor.deprecated ? "9" : "1";
				for (const alias of descriptor.aliases) {
					const aliasItem = new vscode.CompletionItem(alias, vscode.CompletionItemKind.Property);
					aliasItem.insertText = new vscode.SnippetString(`${alias}=`);
					aliasItem.detail = `Alias for ${attrName}`;
					aliasItem.sortText = `!${aliasTier}_${alias}`;
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
	private async completeAttributeValue(
		schemas: Map<string, ShortcodeSchema>,
		name: string | null,
		attributeKey: string | undefined,
		documentUri: vscode.Uri,
	): Promise<vscode.CompletionItem[]> {
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

		return this.buildValueCompletions(descriptor, documentUri);
	}

	/**
	 * Suggest positional argument values.
	 */
	private async completeArgument(
		schemas: Map<string, ShortcodeSchema>,
		name: string | null,
		existingArgs: string[],
		documentUri: vscode.Uri,
	): Promise<vscode.CompletionItem[]> {
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
		const items = await this.buildValueCompletions(argDescriptor, documentUri);

		// Trigger the next completion automatically after accepting a positional argument.
		// File items are excluded: accepting a file should close the suggest widget.
		for (const item of items) {
			if (item.kind !== vscode.CompletionItemKind.File) {
				item.command = { command: "editor.action.triggerSuggest", title: "Trigger Suggest" };
			}
		}

		return items;
	}

	/**
	 * Build completion items from a field descriptor's enum, completion spec, or file paths.
	 */
	private async buildValueCompletions(
		descriptor: FieldDescriptor,
		documentUri: vscode.Uri,
	): Promise<vscode.CompletionItem[]> {
		const items: vscode.CompletionItem[] = [];

		if (descriptor.enum) {
			for (const value of descriptor.enum) {
				const label = String(value);
				const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Value);
				item.sortText = `!1_${label}`;
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
				item.sortText = `!1_${value}`;
				items.push(item);
			}
		}

		if (isFilePathDescriptor(descriptor)) {
			const fileItems = await buildFilePathCompletions(descriptor, documentUri, { includeFolders: true });
			items.push(...fileItems);
		}

		if (typeIncludes(descriptor.type, "boolean") && items.length === 0) {
			const trueItem = new vscode.CompletionItem("true", vscode.CompletionItemKind.Value);
			trueItem.sortText = "!1_true";
			items.push(trueItem);
			const falseItem = new vscode.CompletionItem("false", vscode.CompletionItemKind.Value);
			falseItem.sortText = "!1_false";
			items.push(falseItem);
		}

		return items;
	}

	/**
	 * Compute the start offset of the current token by scanning backwards
	 * from the cursor until hitting a shortcode delimiter.
	 */
	private getTokenStart(text: string, offset: number): number {
		let i = offset;
		while (i > 0) {
			const ch = text[i - 1];
			if (ch === " " || ch === "\t" || ch === "=" || ch === '"' || ch === "'" || ch === "<") {
				break;
			}
			i--;
		}
		return i;
	}

	/**
	 * Filter file-path and folder items to show only the current directory
	 * level.  Files in subdirectories are hidden until the user navigates
	 * into the containing folder.
	 */
	private filterToCurrentLevel(
		items: vscode.CompletionItem[],
		text: string,
		tokenStart: number,
		offset: number,
	): vscode.CompletionItem[] {
		const typedText = text.slice(tokenStart, offset);
		const lastSlash = typedText.lastIndexOf("/");
		const dirPrefix = lastSlash >= 0 ? typedText.slice(0, lastSlash + 1) : "";

		return items.filter((item) => {
			if (item.kind === vscode.CompletionItemKind.File) {
				const label = typeof item.label === "string" ? item.label : item.label.label;
				if (!label.startsWith(dirPrefix)) {
					return false;
				}
				return !label.slice(dirPrefix.length).includes("/");
			}
			if (item.kind === vscode.CompletionItemKind.Folder) {
				const ft = item.filterText || (typeof item.label === "string" ? item.label : item.label.label);
				if (!ft.startsWith(dirPrefix)) {
					return false;
				}
				const segments = ft.slice(dirPrefix.length).split("/").filter(Boolean);
				return segments.length === 1;
			}
			return true;
		});
	}

	/**
	 * Set an explicit replacement range on file-path and folder completion items.
	 * This ensures path separators (/ and .) that fall outside the language's
	 * word pattern are included in the replaced text.
	 */
	private setFilePathRange(
		items: vscode.CompletionItem[],
		tokenStart: number,
		document: vscode.TextDocument,
		position: vscode.Position,
	): void {
		const range = new vscode.Range(document.positionAt(tokenStart), position);
		for (const item of items) {
			if (item.kind === vscode.CompletionItemKind.File || item.kind === vscode.CompletionItemKind.Folder) {
				item.range = range;
			}
		}
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
			logMessage(`Failed to discover shortcode schemas in ${folder.uri.fsPath}: ${getErrorMessage(error)}.`, "warn");
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

				case "argument":
					return this.hoverArgument(schemas, parsed.name, parsed.arguments, word, text, offset);

				default:
					return null;
			}
		} catch (error) {
			logMessage(`Shortcode hover error: ${getErrorMessage(error)}.`, "warn");
			return null;
		}
	}

	private hoverArgument(
		schemas: Map<string, ShortcodeSchema>,
		name: string | null,
		existingArgs: string[],
		word: string,
		text: string,
		offset: number,
	): vscode.Hover | null {
		if (!name) {
			return null;
		}

		// The parser returns "argument" when no prior named attributes
		// exist, but the word might be an attribute key.  Check whether
		// the character after the word is "=" to distinguish the two.
		let end = offset;
		while (end < text.length && /[\w-]/.test(text[end])) {
			end++;
		}
		if (end < text.length && text[end] === "=") {
			return this.hoverAttributeKey(schemas, name, word);
		}

		// Positional argument: show the argument descriptor.
		const schema = schemas.get(name);
		if (!schema?.arguments) {
			return null;
		}
		const argIndex = existingArgs.length;
		if (argIndex >= schema.arguments.length) {
			return null;
		}
		const docs = buildAttributeDoc(schema.arguments[argIndex]);
		if (!docs) {
			return null;
		}
		return new vscode.Hover(docs);
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

	logMessage("Shortcode completion and hover providers registered.", "debug");
}
