import * as vscode from "vscode";
import { discoverInstalledExtensions, formatExtensionId, getExtensionTypes } from "@quarto-wizard/core";
import type { SchemaCache, ExtensionSchema, FieldDescriptor, InstalledExtension } from "@quarto-wizard/core";
import { getYamlKeyPath, getYamlIndentLevel, isInYamlRegion } from "../utils/yamlPosition";
import { logMessage } from "../utils/log";

/**
 * Provides YAML completions for Quarto extension options
 * defined in _schema.yml files.
 */
export class YamlCompletionProvider implements vscode.CompletionItemProvider {
	constructor(private schemaCache: SchemaCache) {}

	async provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
	): Promise<vscode.CompletionItem[] | undefined> {
		try {
			const lines = document.getText().split("\n");
			const languageId = document.languageId;

			if (!isInYamlRegion(lines, position.line, languageId)) {
				return undefined;
			}

			const currentLineText = lines[position.line];
			const isBlankLine = currentLineText.trim() === "";
			const keyPath = getYamlKeyPath(lines, position.line, languageId, isBlankLine ? position.character : undefined);

			const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
			if (!workspaceFolder) {
				return undefined;
			}

			const projectDir = workspaceFolder.uri.fsPath;
			const extensions = await discoverInstalledExtensions(projectDir);

			// Build maps of extension name to schema and metadata for quick lookup.
			const schemaMap = new Map<string, ExtensionSchema>();
			const extMap = new Map<string, InstalledExtension>();
			for (const ext of extensions) {
				const schema = this.schemaCache.get(ext.directory);
				if (schema) {
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
			}

			if (schemaMap.size === 0) {
				return undefined;
			}

			// Check whether the cursor sits after the colon on a key line.
			const currentLine = lines[position.line];
			const keyColonMatch = /^\s*(?:- )?([^\s:][^:]*?)\s*:/.exec(currentLine);
			const isValuePosition = keyColonMatch !== null && position.character > currentLine.indexOf(":");

			// At root level, suggest "extensions" as a top-level key.
			if (keyPath.length === 0 && !isValuePosition) {
				return this.completeTopLevelKeys(schemaMap);
			}

			const items = this.resolveCompletions(keyPath, schemaMap, extMap);
			if (!items || items.length === 0) {
				return undefined;
			}

			// When the cursor is after a colon, key completions must be
			// inserted on the next line with proper indentation so that the
			// resulting YAML is valid.
			if (isValuePosition) {
				this.adjustForValuePosition(items, position, currentLine);
			}

			return items;
		} catch (error) {
			logMessage(`YAML completion error: ${error instanceof Error ? error.message : String(error)}.`, "warn");
			return undefined;
		}
	}

	/**
	 * Transform completion items when the cursor is in value position (after
	 * a colon).  Key completions are moved to the next line with proper
	 * indentation.  Value completions get a replacement range covering
	 * everything after the colon so the leading space is not doubled.
	 */
	private adjustForValuePosition(items: vscode.CompletionItem[], position: vscode.Position, currentLine: string): void {
		const colonIndex = currentLine.indexOf(":");
		const replaceRange = new vscode.Range(position.line, colonIndex + 1, position.line, position.character);
		const currentIndent = getYamlIndentLevel(currentLine);
		const childIndent = " ".repeat(currentIndent + 2);

		for (const item of items) {
			const isKey = item.kind === vscode.CompletionItemKind.Module || item.kind === vscode.CompletionItemKind.Property;

			if (!isKey) {
				// Value completions (enum, boolean): set the range so the
				// leading space in insertText replaces any existing whitespace
				// between the colon and the cursor.
				item.range = replaceRange;
				continue;
			}

			const label = typeof item.label === "string" ? item.label : item.label.label;
			const isObject = item.kind === vscode.CompletionItemKind.Module;

			if (isObject) {
				item.insertText = `\n${childIndent}${label}:\n${childIndent}  `;
				item.command = { command: "editor.action.triggerSuggest", title: "Trigger Suggest" };
			} else {
				item.insertText = `\n${childIndent}${label}: `;
			}
			item.filterText = label;
			item.range = replaceRange;
		}
	}

	private completeTopLevelKeys(schemaMap: Map<string, ExtensionSchema>): vscode.CompletionItem[] | undefined {
		const hasOptions = Array.from(schemaMap.values()).some((schema) => schema.options);
		if (!hasOptions) {
			return undefined;
		}

		const item = new vscode.CompletionItem("extensions", vscode.CompletionItemKind.Module);
		item.detail = "Quarto extension options";
		item.documentation = new vscode.MarkdownString("Configure options for installed Quarto extensions.");
		item.insertText = new vscode.SnippetString("extensions:\n  $0");
		item.command = { command: "editor.action.triggerSuggest", title: "Trigger Suggest" };
		return [item];
	}

	private resolveCompletions(
		keyPath: string[],
		schemaMap: Map<string, ExtensionSchema>,
		extMap: Map<string, InstalledExtension>,
	): vscode.CompletionItem[] | undefined {
		if (keyPath.length === 0) {
			return undefined;
		}

		const topKey = keyPath[0];

		// Under "extensions:" suggest installed extension names that have schemas.
		if (topKey === "extensions" && keyPath.length === 1) {
			return this.completeExtensionNames(schemaMap, extMap);
		}

		// Under "extensions.<name>:" suggest option keys.
		if (topKey === "extensions" && keyPath.length >= 2) {
			const extName = keyPath[1];
			const schema = schemaMap.get(extName);
			if (!schema) {
				return undefined;
			}

			if (keyPath.length === 2) {
				return this.completeFieldKeys(schema.options);
			}

			return this.completeNestedFieldKeys(schema.options, keyPath.slice(2));
		}

		// Under "format.<format-name>:" suggest format-specific keys.
		if (topKey === "format" && keyPath.length >= 2) {
			const formatName = keyPath[1];
			const formatFields = this.collectFormatFields(formatName, schemaMap);
			if (!formatFields) {
				return undefined;
			}

			if (keyPath.length === 2) {
				return this.completeFieldKeys(formatFields);
			}

			return this.completeNestedFieldKeys(formatFields, keyPath.slice(2));
		}

		return undefined;
	}

	private completeExtensionNames(
		schemaMap: Map<string, ExtensionSchema>,
		extMap: Map<string, InstalledExtension>,
	): vscode.CompletionItem[] {
		const items: vscode.CompletionItem[] = [];
		const seen = new Set<string>();

		for (const [name, schema] of schemaMap.entries()) {
			if (seen.has(name) || !schema.options) {
				continue;
			}
			seen.add(name);

			const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Module);
			const ext = extMap.get(name);
			item.detail = ext?.manifest.title || "Quarto extension";
			if (ext) {
				const types = getExtensionTypes(ext.manifest);
				const docParts: string[] = [];
				if (types.length > 0) {
					docParts.push(`Provides: ${types.join(", ")}`);
				}
				if (ext.manifest.author) {
					docParts.push(`**Author:** ${ext.manifest.author}`);
				}
				if (docParts.length > 0) {
					item.documentation = new vscode.MarkdownString(docParts.join("  \n"));
				}
			}
			item.insertText = new vscode.SnippetString(`${name}:\n  $0`);
			item.command = { command: "editor.action.triggerSuggest", title: "Trigger Suggest" };
			items.push(item);
		}

		return items;
	}

	private completeFieldKeys(fields: Record<string, FieldDescriptor> | undefined): vscode.CompletionItem[] | undefined {
		if (!fields) {
			return undefined;
		}

		const items: vscode.CompletionItem[] = [];

		for (const [key, descriptor] of Object.entries(fields)) {
			const item = this.fieldToCompletionItem(key, descriptor);
			items.push(item);

			// Also include aliases.
			if (descriptor.aliases) {
				for (const alias of descriptor.aliases) {
					const aliasItem = this.fieldToCompletionItem(alias, descriptor);
					aliasItem.detail = `Alias for ${key}`;
					items.push(aliasItem);
				}
			}
		}

		return items.length > 0 ? items : undefined;
	}

	private completeNestedFieldKeys(
		fields: Record<string, FieldDescriptor> | undefined,
		remainingPath: string[],
	): vscode.CompletionItem[] | undefined {
		if (!fields || remainingPath.length === 0) {
			return this.completeFieldKeys(fields);
		}

		const currentKey = remainingPath[0];
		const descriptor = fields[currentKey];

		if (!descriptor) {
			return undefined;
		}

		// If the descriptor has properties (type "object"), walk deeper.
		if (descriptor.properties) {
			return this.completeNestedFieldKeys(descriptor.properties, remainingPath.slice(1));
		}

		// At a leaf: suggest enum values or boolean values.
		return this.completeFieldValues(descriptor);
	}

	private completeFieldValues(descriptor: FieldDescriptor): vscode.CompletionItem[] | undefined {
		const items: vscode.CompletionItem[] = [];

		if (descriptor.enum) {
			for (const value of descriptor.enum) {
				const label = String(value);
				const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.EnumMember);
				item.insertText = ` ${label}`;
				item.filterText = label;
				if (descriptor.description) {
					item.documentation = new vscode.MarkdownString(descriptor.description);
				}
				items.push(item);
			}
		}

		if (descriptor.type === "boolean") {
			for (const label of ["true", "false"]) {
				const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Value);
				item.insertText = ` ${label}`;
				item.filterText = label;
				items.push(item);
			}
		}

		return items.length > 0 ? items : undefined;
	}

	private fieldToCompletionItem(key: string, descriptor: FieldDescriptor): vscode.CompletionItem {
		const isObject = descriptor.type === "object" || descriptor.properties !== undefined;
		const kind = isObject ? vscode.CompletionItemKind.Module : vscode.CompletionItemKind.Property;
		const item = new vscode.CompletionItem(key, kind);

		if (descriptor.deprecated) {
			item.tags = [vscode.CompletionItemTag.Deprecated];
		}

		item.detail = descriptor.description;

		const meta: string[] = [];
		if (descriptor.type) {
			meta.push(`**Type:** \`${descriptor.type}\``);
		}
		if (descriptor.required) {
			meta.push("**Required**");
		}
		if (descriptor.default !== undefined) {
			meta.push(`**Default:** \`${String(descriptor.default)}\``);
		}
		if (descriptor.enum) {
			meta.push(`**Values:** ${descriptor.enum.map((v) => `\`${String(v)}\``).join(", ")}`);
		}
		if (descriptor.deprecated) {
			meta.push("**Deprecated**");
		}
		if (meta.length > 0) {
			const docParts: string[] = [];
			if (descriptor.description) {
				docParts.push(descriptor.description);
			}
			docParts.push(meta.join("  \n"));
			item.documentation = new vscode.MarkdownString(docParts.join("\n\n"));
		}

		// For object types or fields with nested properties, place the cursor
		// on the next line with increased indentation.
		if (isObject) {
			item.insertText = new vscode.SnippetString(`${key}:\n  $0`);
			item.command = { command: "editor.action.triggerSuggest", title: "Trigger Suggest" };
		} else {
			item.insertText = `${key}: `;
			// Chain to value completions for fields with known values.
			const hasCompletableValues = descriptor.enum || descriptor.type === "boolean";
			if (hasCompletableValues) {
				item.command = { command: "editor.action.triggerSuggest", title: "Trigger Suggest" };
			}
		}

		return item;
	}

	private collectFormatFields(
		formatName: string,
		schemaMap: Map<string, ExtensionSchema>,
	): Record<string, FieldDescriptor> | undefined {
		const merged: Record<string, FieldDescriptor> = {};
		let found = false;

		for (const schema of schemaMap.values()) {
			if (!schema.formats) {
				continue;
			}

			const formatFields = schema.formats[formatName];
			if (formatFields) {
				for (const [key, descriptor] of Object.entries(formatFields)) {
					if (!(key in merged)) {
						merged[key] = descriptor;
					}
				}
				found = true;
			}
		}

		return found ? merged : undefined;
	}
}

/**
 * File patterns for YAML documents that may contain Quarto configuration.
 */
export const YAML_DOCUMENT_SELECTOR: vscode.DocumentSelector = [
	{ language: "yaml", pattern: "**/_quarto.{yml,yaml}" },
	{ language: "yaml", pattern: "**/_metadata.{yml,yaml}" },
	{ language: "quarto", pattern: "**/*.qmd" },
];
