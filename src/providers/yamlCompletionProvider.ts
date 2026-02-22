import * as vscode from "vscode";
import { typeIncludes, formatType } from "@quarto-wizard/schema";
import type { SchemaCache, ExtensionSchema, FieldDescriptor } from "@quarto-wizard/schema";
import { formatExtensionId, getExtensionTypes, getErrorMessage, type InstalledExtension } from "@quarto-wizard/core";
import { getYamlKeyPath, getYamlIndentLevel, isInYamlRegion, getExistingKeysAtPath } from "../utils/yamlPosition";
import { isFilePathDescriptor, buildFilePathCompletions } from "../utils/filePathCompletion";
import { hasCompletableValues } from "../utils/schemaDocumentation";
import { getInstalledExtensionsCached } from "../utils/installedExtensionsCache";
import { logMessage } from "../utils/log";

/**
 * Provides YAML completions for Quarto extension options
 * defined in extension schema files.
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
			const extensions = await getInstalledExtensionsCached(projectDir);

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

			// Compute existing sibling keys at the current path for deduplication.
			const existingKeys = getExistingKeysAtPath(lines, keyPath, languageId);

			// At root level, suggest "extensions" as a top-level key.
			if (keyPath.length === 0 && !isValuePosition) {
				return this.completeTopLevelKeys(schemaMap, existingKeys);
			}

			const items = await this.resolveCompletions(keyPath, schemaMap, extMap, existingKeys, document.uri);
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
			logMessage(`YAML completion error: ${getErrorMessage(error)}.`, "warn");
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
				// Value completions (enum, boolean, file): set the range so the
				// leading space in insertText replaces any existing whitespace
				// between the colon and the cursor.
				item.range = replaceRange;
				continue;
			}

			const label = typeof item.label === "string" ? item.label : item.label.label;
			const isObject = item.kind === vscode.CompletionItemKind.Module;

			if (isObject) {
				item.insertText = new vscode.SnippetString(`\n${childIndent}${label}:\n${childIndent}  $0`);
				item.command = { command: "editor.action.triggerSuggest", title: "Trigger Suggest" };
			} else {
				item.insertText = new vscode.SnippetString(`\n${childIndent}${label}: $0`);
			}
			item.filterText = label;
			item.range = replaceRange;
		}
	}

	private completeTopLevelKeys(
		schemaMap: Map<string, ExtensionSchema>,
		existingKeys: Set<string>,
	): vscode.CompletionItem[] | undefined {
		const hasOptions = Array.from(schemaMap.values()).some((schema) => schema.options);
		if (!hasOptions || existingKeys.has("extensions")) {
			return undefined;
		}

		const item = new vscode.CompletionItem("extensions", vscode.CompletionItemKind.Module);
		item.detail = "Quarto extension options";
		item.documentation = new vscode.MarkdownString("Configure options for installed Quarto extensions.");
		item.insertText = new vscode.SnippetString("extensions:\n  $0");
		item.command = { command: "editor.action.triggerSuggest", title: "Trigger Suggest" };
		return [item];
	}

	private async resolveCompletions(
		keyPath: string[],
		schemaMap: Map<string, ExtensionSchema>,
		extMap: Map<string, InstalledExtension>,
		existingKeys: Set<string>,
		documentUri: vscode.Uri,
	): Promise<vscode.CompletionItem[] | undefined> {
		if (keyPath.length === 0) {
			return undefined;
		}

		const topKey = keyPath[0];

		// Under "extensions:" suggest installed extension names that have schemas.
		if (topKey === "extensions" && keyPath.length === 1) {
			return this.completeExtensionNames(schemaMap, extMap, existingKeys);
		}

		// Under "extensions.<name>:" suggest option keys.
		if (topKey === "extensions" && keyPath.length >= 2) {
			const extName = keyPath[1];
			const schema = schemaMap.get(extName);
			if (!schema) {
				return undefined;
			}

			if (keyPath.length === 2) {
				return this.completeFieldKeys(schema.options, existingKeys);
			}

			return this.completeNestedFieldKeys(schema.options, keyPath.slice(2), existingKeys, documentUri);
		}

		// Under "format.<format-name>:" suggest format-specific keys.
		if (topKey === "format" && keyPath.length >= 2) {
			const formatName = keyPath[1];
			const formatFields = this.collectFormatFields(formatName, schemaMap);
			if (!formatFields) {
				return undefined;
			}

			if (keyPath.length === 2) {
				return this.completeFieldKeys(formatFields, existingKeys);
			}

			return this.completeNestedFieldKeys(formatFields, keyPath.slice(2), existingKeys, documentUri);
		}

		return undefined;
	}

	private completeExtensionNames(
		schemaMap: Map<string, ExtensionSchema>,
		extMap: Map<string, InstalledExtension>,
		existingKeys: Set<string>,
	): vscode.CompletionItem[] {
		const items: vscode.CompletionItem[] = [];
		const seen = new Set<string>();

		for (const [name, schema] of schemaMap.entries()) {
			if (seen.has(name) || !schema.options || existingKeys.has(name)) {
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

	private completeFieldKeys(
		fields: Record<string, FieldDescriptor> | undefined,
		existingKeys: Set<string>,
	): vscode.CompletionItem[] | undefined {
		if (!fields) {
			return undefined;
		}

		const items: vscode.CompletionItem[] = [];

		for (const [key, descriptor] of Object.entries(fields)) {
			// Skip the entire field (canonical + aliases) when any name is already present.
			const isOccupied = existingKeys.has(key) || descriptor.aliases?.some((a) => existingKeys.has(a));
			if (isOccupied) {
				continue;
			}

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

	private async completeNestedFieldKeys(
		fields: Record<string, FieldDescriptor> | undefined,
		remainingPath: string[],
		existingKeys: Set<string>,
		documentUri: vscode.Uri,
	): Promise<vscode.CompletionItem[] | undefined> {
		if (!fields || remainingPath.length === 0) {
			return this.completeFieldKeys(fields, existingKeys);
		}

		const currentKey = remainingPath[0];
		const descriptor = fields[currentKey];

		if (!descriptor) {
			return undefined;
		}

		// If the descriptor has properties (type "object"), walk deeper.
		if (descriptor.properties) {
			return this.completeNestedFieldKeys(descriptor.properties, remainingPath.slice(1), existingKeys, documentUri);
		}

		// At a leaf: suggest enum values, boolean values, or file paths.
		return this.completeFieldValues(descriptor, documentUri);
	}

	private async completeFieldValues(
		descriptor: FieldDescriptor,
		documentUri: vscode.Uri,
	): Promise<vscode.CompletionItem[] | undefined> {
		const items: vscode.CompletionItem[] = [];

		// Const takes precedence: offer the single fixed value.
		if (descriptor.const !== undefined) {
			const label = String(descriptor.const);
			const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Constant);
			item.insertText = ` ${label}`;
			item.filterText = label;
			if (descriptor.description) {
				item.documentation = new vscode.MarkdownString(descriptor.description);
			}
			return [item];
		}

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

		if (typeIncludes(descriptor.type, "boolean")) {
			for (const label of ["true", "false"]) {
				const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Value);
				item.insertText = ` ${label}`;
				item.filterText = label;
				items.push(item);
			}
		}

		if (isFilePathDescriptor(descriptor)) {
			const fileItems = await buildFilePathCompletions(descriptor, documentUri);
			for (const fileItem of fileItems) {
				fileItem.insertText = ` ${typeof fileItem.label === "string" ? fileItem.label : fileItem.label.label}`;
				fileItem.filterText = typeof fileItem.label === "string" ? fileItem.label : fileItem.label.label;
				items.push(fileItem);
			}
		}

		return items.length > 0 ? items : undefined;
	}

	private fieldToCompletionItem(key: string, descriptor: FieldDescriptor): vscode.CompletionItem {
		const isObject = typeIncludes(descriptor.type, "object") || descriptor.properties !== undefined;
		const kind = isObject ? vscode.CompletionItemKind.Module : vscode.CompletionItemKind.Property;
		const item = new vscode.CompletionItem(key, kind);

		if (descriptor.deprecated) {
			item.tags = [vscode.CompletionItemTag.Deprecated];
		}

		item.detail = descriptor.description;

		const meta: string[] = [];
		if (descriptor.type) {
			meta.push(`**Type:** \`${formatType(descriptor.type)}\``);
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
			if (hasCompletableValues(descriptor)) {
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
