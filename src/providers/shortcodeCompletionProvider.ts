import * as vscode from "vscode";
import type { ShortcodeSchema, FieldDescriptor, SchemaCache } from "@quarto-wizard/core";
import { discoverInstalledExtensions } from "@quarto-wizard/core";
import { parseShortcodeAtPosition } from "../utils/shortcodeParser";
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

			const parsed = parseShortcodeAtPosition(text, offset);
			if (!parsed) {
				return null;
			}

			const schemas = await this.collectShortcodeSchemas();
			if (schemas.size === 0) {
				return null;
			}

			switch (parsed.cursorContext) {
				case "name":
					return this.completeShortcodeName(schemas, parsed.name);

				case "attributeKey":
					return this.completeAttributeKey(schemas, parsed.name, parsed.attributes);

				case "attributeValue":
					return this.completeAttributeValue(schemas, parsed.name, parsed.currentAttributeKey);

				case "argument":
					return this.completeArgument(schemas, parsed.name, parsed.arguments);

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
	): vscode.CompletionItem[] {
		const items: vscode.CompletionItem[] = [];

		for (const [name, schema] of schemas) {
			if (partial && !name.startsWith(partial)) {
				continue;
			}

			const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
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

		for (const [attrName, descriptor] of Object.entries(schema.attributes)) {
			// Skip attributes already present
			if (attrName in existingAttributes) {
				continue;
			}

			const item = new vscode.CompletionItem(attrName, vscode.CompletionItemKind.Property);
			item.insertText = new vscode.SnippetString(`${attrName}=`);

			const docs = this.buildAttributeDocumentation(descriptor);
			if (docs) {
				item.documentation = docs;
			}

			if (descriptor.required) {
				item.sortText = `0_${attrName}`;
			}

			if (descriptor.deprecated) {
				item.tags = [vscode.CompletionItemTag.Deprecated];
			}

			items.push(item);

			// Include aliases
			if (descriptor.aliases) {
				for (const alias of descriptor.aliases) {
					if (alias in existingAttributes) {
						continue;
					}
					const aliasItem = new vscode.CompletionItem(alias, vscode.CompletionItemKind.Property);
					aliasItem.insertText = new vscode.SnippetString(`${alias}=`);
					aliasItem.detail = `Alias for ${attrName}`;
					if (docs) {
						aliasItem.documentation = docs;
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

		const descriptor = this.resolveAttribute(schema, attributeKey);
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
		return this.buildValueCompletions(argDescriptor);
	}

	/**
	 * Resolve an attribute descriptor, checking aliases.
	 */
	private resolveAttribute(schema: ShortcodeSchema, key: string): FieldDescriptor | undefined {
		if (!schema.attributes) {
			return undefined;
		}

		if (key in schema.attributes) {
			return schema.attributes[key];
		}

		// Check aliases
		for (const descriptor of Object.values(schema.attributes)) {
			if (descriptor.aliases?.includes(key)) {
				return descriptor;
			}
		}

		return undefined;
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
	 * Build a markdown documentation string for an attribute.
	 */
	private buildAttributeDocumentation(descriptor: FieldDescriptor): vscode.MarkdownString | undefined {
		const parts: string[] = [];

		if (descriptor.description) {
			parts.push(descriptor.description);
		}

		const meta: string[] = [];
		if (descriptor.type) {
			meta.push(`Type: \`${descriptor.type}\``);
		}
		if (descriptor.required) {
			meta.push("Required");
		}
		if (descriptor.default !== undefined) {
			meta.push(`Default: \`${String(descriptor.default)}\``);
		}
		if (descriptor.enum) {
			meta.push(`Values: ${descriptor.enum.map((v) => `\`${String(v)}\``).join(", ")}`);
		}
		if (descriptor.deprecated) {
			const msg = typeof descriptor.deprecated === "string" ? descriptor.deprecated : "This attribute is deprecated.";
			meta.push(`Deprecated: ${msg}`);
		}

		if (meta.length > 0) {
			parts.push(meta.join(" | "));
		}

		if (parts.length === 0) {
			return undefined;
		}

		return new vscode.MarkdownString(parts.join("\n\n"));
	}

	/**
	 * Discover all shortcode schemas from installed extensions in the workspace.
	 */
	private async collectShortcodeSchemas(): Promise<Map<string, ShortcodeSchema>> {
		const result = new Map<string, ShortcodeSchema>();
		const workspaceFolders = vscode.workspace.workspaceFolders;

		if (!workspaceFolders) {
			return result;
		}

		for (const folder of workspaceFolders) {
			try {
				const extensions = await discoverInstalledExtensions(folder.uri.fsPath);

				for (const ext of extensions) {
					const schema = this.schemaCache.get(ext.directory);
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
}

/**
 * Register the shortcode completion provider.
 *
 * @param context - The extension context.
 * @param schemaCache - Shared schema cache instance.
 * @returns The disposable for the registered provider.
 */
export function registerShortcodeCompletionProvider(
	context: vscode.ExtensionContext,
	schemaCache: SchemaCache,
): vscode.Disposable {
	const provider = new ShortcodeCompletionProvider(schemaCache);
	const selector: vscode.DocumentSelector = { language: "quarto" };
	const triggerCharacters = [" ", "=", "<"];

	const disposable = vscode.languages.registerCompletionItemProvider(selector, provider, ...triggerCharacters);
	context.subscriptions.push(disposable);

	logMessage("Shortcode completion provider registered.", "info");

	return disposable;
}
