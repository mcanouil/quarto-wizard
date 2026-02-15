import * as vscode from "vscode";
import { discoverInstalledExtensions, formatExtensionId } from "@quarto-wizard/core";
import type { SchemaCache, ExtensionSchema, FieldDescriptor } from "@quarto-wizard/core";
import { getYamlKeyPath, isInYamlRegion } from "../utils/yamlPosition";
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

			const keyPath = getYamlKeyPath(lines, position.line, languageId);

			const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
			if (!workspaceFolder) {
				return undefined;
			}

			const projectDir = workspaceFolder.uri.fsPath;
			const extensions = await discoverInstalledExtensions(projectDir);

			// Build a map of extension name to schema for quick lookup.
			const schemaMap = new Map<string, ExtensionSchema>();
			for (const ext of extensions) {
				const schema = this.schemaCache.get(ext.directory);
				if (schema) {
					const id = formatExtensionId(ext.id);
					const shortName = ext.id.name;
					schemaMap.set(id, schema);
					if (!schemaMap.has(shortName)) {
						schemaMap.set(shortName, schema);
					}
				}
			}

			if (schemaMap.size === 0) {
				return undefined;
			}

			// Determine completion context from the key path.
			return this.resolveCompletions(keyPath, schemaMap);
		} catch (error) {
			logMessage(`YAML completion error: ${error instanceof Error ? error.message : String(error)}.`, "warn");
			return undefined;
		}
	}

	private resolveCompletions(
		keyPath: string[],
		schemaMap: Map<string, ExtensionSchema>,
	): vscode.CompletionItem[] | undefined {
		// Context: at the top level or under a key that isn't extension-related.
		if (keyPath.length === 0) {
			return undefined;
		}

		const topKey = keyPath[0];

		// Under "extensions:" suggest installed extension names that have schemas.
		if (topKey === "extensions" && keyPath.length === 1) {
			return this.completeExtensionNames(schemaMap);
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

			// Deeper nesting: walk into nested object properties.
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

	private completeExtensionNames(schemaMap: Map<string, ExtensionSchema>): vscode.CompletionItem[] {
		const items: vscode.CompletionItem[] = [];
		const seen = new Set<string>();

		for (const name of schemaMap.keys()) {
			if (seen.has(name)) {
				continue;
			}
			seen.add(name);

			const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Module);
			item.detail = "Quarto extension";
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

		// At a value position: suggest enum values or boolean values.
		return this.completeFieldValues(descriptor);
	}

	private completeFieldValues(descriptor: FieldDescriptor): vscode.CompletionItem[] | undefined {
		const items: vscode.CompletionItem[] = [];

		if (descriptor.enum) {
			for (const value of descriptor.enum) {
				const label = String(value);
				const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.EnumMember);
				if (descriptor.description) {
					item.documentation = new vscode.MarkdownString(descriptor.description);
				}
				items.push(item);
			}
		}

		if (descriptor.type === "boolean") {
			items.push(new vscode.CompletionItem("true", vscode.CompletionItemKind.Value));
			items.push(new vscode.CompletionItem("false", vscode.CompletionItemKind.Value));
		}

		return items.length > 0 ? items : undefined;
	}

	private fieldToCompletionItem(key: string, descriptor: FieldDescriptor): vscode.CompletionItem {
		const kind = descriptor.type === "object" ? vscode.CompletionItemKind.Module : vscode.CompletionItemKind.Property;
		const item = new vscode.CompletionItem(key, kind);

		const parts: string[] = [];
		if (descriptor.type) {
			parts.push(descriptor.type);
		}
		if (descriptor.required) {
			parts.push("required");
		}
		if (descriptor.deprecated) {
			parts.push("deprecated");
			item.tags = [vscode.CompletionItemTag.Deprecated];
		}
		item.detail = parts.length > 0 ? parts.join(" | ") : undefined;

		if (descriptor.description) {
			item.documentation = new vscode.MarkdownString(descriptor.description);
		}

		// Insert "key: " so the user can immediately type the value.
		item.insertText = `${key}: `;

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
				Object.assign(merged, formatFields);
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
