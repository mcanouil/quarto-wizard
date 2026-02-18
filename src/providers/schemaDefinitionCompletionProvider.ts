import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	ALLOWED_TOP_LEVEL_KEYS,
	ALLOWED_FIELD_PROPERTIES,
	ALLOWED_TYPES,
	ALLOWED_SHORTCODE_KEYS,
	SCHEMA_VERSION_URI,
} from "@quarto-wizard/core";
import { getYamlKeyPath, getExistingKeysAtPath } from "../utils/yamlPosition";
import { logMessage } from "../utils/log";

/**
 * File patterns for schema definition YAML documents.
 */
export const SCHEMA_DEFINITION_SELECTOR: vscode.DocumentSelector = [
	{ language: "yaml", pattern: "**/_schema.{yml,yaml}" },
];

/**
 * Discriminated union describing the completion context within a
 * schema definition file.
 */
export type SchemaContext =
	| { kind: "root" }
	| { kind: "field-descriptor"; allowName?: boolean }
	| { kind: "shortcode-entry" }
	| { kind: "value"; valueType: "type" | "boolean" | "schema-uri" }
	| null;

/**
 * camelCase field property keys excluded from YAML completions.
 * YAML schema files use kebab-case; these duplicates are only
 * relevant in JSON.
 */
const CAMEL_CASE_EXCLUSIONS = new Set([
	"enumCaseInsensitive",
	"patternExact",
	"minLength",
	"maxLength",
	"minItems",
	"maxItems",
	"exclusiveMinimum",
	"exclusiveMaximum",
]);

/** JSON Schema-style aliases excluded from YAML completions. */
const JSON_SCHEMA_ALIASES = new Set(["minimum", "maximum"]);

/** Boolean-valued field descriptor properties. */
const BOOLEAN_PROPERTIES = new Set(["required", "deprecated", "enum-case-insensitive", "pattern-exact"]);

/** Field descriptor properties that open a nested mapping or list. */
const NESTED_PROPERTIES = new Set(["items", "properties", "completion"]);

/** Field descriptor properties with known value completions. */
const VALUE_TRIGGER_PROPERTIES = new Set(["type", ...BOOLEAN_PROPERTIES]);

/** One-line documentation for each field descriptor property. */
const PROPERTY_DOCS: Record<string, string> = {
	type: "Data type (string, number, integer, boolean, array, object, content).",
	required: "Whether this field is required.",
	default: "Default value when not specified.",
	description: "Human-readable description shown in editor hints.",
	enum: "List of allowed values.",
	"enum-case-insensitive": "Whether enum matching ignores case.",
	pattern: "Regular expression the value must match.",
	"pattern-exact": "Whether the pattern must match the entire value.",
	min: "Minimum numeric value.",
	max: "Maximum numeric value.",
	"exclusive-minimum": "Exclusive minimum (value must be strictly greater).",
	"exclusive-maximum": "Exclusive maximum (value must be strictly less).",
	"min-length": "Minimum string length.",
	"max-length": "Maximum string length.",
	"min-items": "Minimum number of items (for arrays).",
	"max-items": "Maximum number of items (for arrays).",
	const: "Fixed value the field must equal.",
	aliases: "Alternative names for the field.",
	deprecated: "Whether the field is deprecated.",
	completion: "Completion specification for the field.",
	items: "Schema for array items (when type is array).",
	properties: "Schema for nested object properties (when type is object).",
	name: "Name of the shortcode argument (required).",
};

/**
 * Determine the schema context for a given key path.
 *
 * @param keyPath - The YAML key path from the cursor position.
 * @param isValuePosition - Whether the cursor is after a colon.
 * @returns The schema context, or null when no completions apply.
 */
export function getSchemaContext(keyPath: string[], isValuePosition: boolean): SchemaContext {
	// Value position handling.
	if (isValuePosition && keyPath.length > 0) {
		const lastKey = keyPath[keyPath.length - 1];

		// $schema at depth 1.
		if (lastKey === "$schema" && keyPath.length === 1) {
			return { kind: "value", valueType: "schema-uri" };
		}

		// Check whether we are inside a field-descriptor context.
		const parentCtx = getSchemaContext(keyPath.slice(0, -1), false);
		if (parentCtx && parentCtx.kind === "field-descriptor") {
			if (lastKey === "type") {
				return { kind: "value", valueType: "type" };
			}
			if (BOOLEAN_PROPERTIES.has(lastKey)) {
				return { kind: "value", valueType: "boolean" };
			}
		}

		return null;
	}

	// Key position handling.
	if (keyPath.length === 0) {
		return { kind: "root" };
	}

	const first = keyPath[0];

	// "options" section.
	if (first === "options") {
		if (keyPath.length === 1) {
			return null; // Children are user-defined names.
		}
		return resolveFieldDescriptorContext(keyPath.slice(2));
	}

	// "projects" section (same structure as options).
	if (first === "projects") {
		if (keyPath.length === 1) {
			return null;
		}
		return resolveFieldDescriptorContext(keyPath.slice(2));
	}

	// "formats" section.
	if (first === "formats") {
		if (keyPath.length <= 2) {
			return null; // Direct children and format names are user-defined.
		}
		return resolveFieldDescriptorContext(keyPath.slice(3));
	}

	// "element-attributes" section.
	if (first === "element-attributes" || first === "elementAttributes") {
		if (keyPath.length <= 2) {
			return null;
		}
		return resolveFieldDescriptorContext(keyPath.slice(3));
	}

	// "shortcodes" section.
	if (first === "shortcodes") {
		if (keyPath.length === 1) {
			return null; // Children are shortcode names.
		}
		if (keyPath.length === 2) {
			return { kind: "shortcode-entry" };
		}

		const thirdKey = keyPath[2];

		if (thirdKey === "arguments") {
			// arguments is a list of field descriptors with `name`.
			return resolveFieldDescriptorContext(keyPath.slice(3), true);
		}

		if (thirdKey === "attributes") {
			if (keyPath.length === 3) {
				return null; // Children are user-defined attribute names.
			}
			return resolveFieldDescriptorContext(keyPath.slice(4));
		}

		return null;
	}

	return null;
}

/**
 * Walk path segments to determine whether we land on a field descriptor
 * level. Valid traversal steps are "items" (single descriptor) and
 * "properties" + user-defined name (skip both).
 *
 * @param segments - Remaining path segments after the section prefix and
 *   user-defined field name.
 * @param allowName - Whether to allow "name" as a field property (for
 *   shortcode arguments).
 * @returns A field-descriptor context, or null if the path lands on a
 *   user-defined level.
 */
function resolveFieldDescriptorContext(segments: string[], allowName = false): SchemaContext | null {
	let i = 0;
	while (i < segments.length) {
		const seg = segments[i];

		if (seg === "items") {
			// "items" maps to a single field descriptor; continue walking.
			i++;
			continue;
		}

		if (seg === "properties") {
			// "properties" is a map of user-defined names.
			if (i + 1 >= segments.length) {
				return null; // At the "properties" level: children are user-defined.
			}
			// Skip the user-defined name.
			i += 2;
			continue;
		}

		// Any other segment is a field property key; we are at field-descriptor level.
		return { kind: "field-descriptor", allowName };
	}

	// Exhausted all segments: we are at field-descriptor level.
	return { kind: "field-descriptor", allowName };
}

/**
 * Provides YAML completions for Quarto extension schema definition
 * files (_schema.yml, _schema.yaml).
 */
export class SchemaDefinitionCompletionProvider implements vscode.CompletionItemProvider {
	provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
	): vscode.CompletionItem[] | undefined {
		try {
			// Adjacency gate: only activate when _extension.yml exists.
			const dir = path.dirname(document.fileName);
			if (!fs.existsSync(path.join(dir, "_extension.yml")) && !fs.existsSync(path.join(dir, "_extension.yaml"))) {
				return undefined;
			}

			const lines = document.getText().split("\n");
			const languageId = document.languageId;
			const currentLineText = lines[position.line];
			const isBlankLine = currentLineText.trim() === "";
			const keyPath = getYamlKeyPath(lines, position.line, languageId, isBlankLine ? position.character : undefined);

			// Detect value position.
			const keyColonMatch = /^\s*(?:- )?([^\s:][^:]*?)\s*:/.exec(currentLineText);
			const colonIndex = currentLineText.indexOf(":");
			const isValuePosition = keyColonMatch !== null && position.character > colonIndex;

			const context = getSchemaContext(keyPath, isValuePosition);
			if (!context) {
				return undefined;
			}

			const existingKeys = getExistingKeysAtPath(lines, keyPath, languageId);
			const items = this.buildCompletions(context, existingKeys);

			if (!items || items.length === 0) {
				return undefined;
			}

			// When in value position, set replacement range from after the
			// colon to the cursor so leading whitespace is not doubled.
			if (isValuePosition) {
				const replaceRange = new vscode.Range(position.line, colonIndex + 1, position.line, position.character);
				for (const item of items) {
					item.range = replaceRange;
				}
			}

			return items;
		} catch (error) {
			logMessage(
				`Schema definition completion error: ${error instanceof Error ? error.message : String(error)}.`,
				"warn",
			);
			return undefined;
		}
	}

	private buildCompletions(context: SchemaContext, existingKeys: Set<string>): vscode.CompletionItem[] | undefined {
		if (!context) {
			return undefined;
		}

		switch (context.kind) {
			case "root":
				return this.completeRootKeys(existingKeys);
			case "field-descriptor":
				return this.completeFieldDescriptorKeys(existingKeys, context.allowName);
			case "shortcode-entry":
				return this.completeShortcodeEntryKeys(existingKeys);
			case "value":
				return this.completeValues(context.valueType);
		}
	}

	private completeRootKeys(existingKeys: Set<string>): vscode.CompletionItem[] {
		const items: vscode.CompletionItem[] = [];

		for (const key of ALLOWED_TOP_LEVEL_KEYS) {
			if (existingKeys.has(key)) {
				continue;
			}
			// Skip "elementAttributes" in YAML; use "element-attributes" instead.
			if (key === "elementAttributes") {
				continue;
			}

			if (key === "$schema") {
				const item = new vscode.CompletionItem("$schema", vscode.CompletionItemKind.Property);
				item.detail = "Schema version URI.";
				item.insertText = "$schema: ";
				item.command = { command: "editor.action.triggerSuggest", title: "Trigger Suggest" };
				items.push(item);
			} else {
				const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Module);
				item.detail = `Schema section "${key}".`;
				item.insertText = new vscode.SnippetString(`${key}:\n  $0`);
				item.command = { command: "editor.action.triggerSuggest", title: "Trigger Suggest" };
				items.push(item);
			}
		}

		return items;
	}

	private completeFieldDescriptorKeys(existingKeys: Set<string>, allowName?: boolean): vscode.CompletionItem[] {
		const items: vscode.CompletionItem[] = [];

		for (const key of ALLOWED_FIELD_PROPERTIES) {
			if (existingKeys.has(key)) {
				continue;
			}
			if (CAMEL_CASE_EXCLUSIONS.has(key) || JSON_SCHEMA_ALIASES.has(key)) {
				continue;
			}
			if (key === "name" && !allowName) {
				continue;
			}

			const doc = PROPERTY_DOCS[key];

			if (NESTED_PROPERTIES.has(key)) {
				const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Module);
				if (doc) {
					item.detail = doc;
				}
				item.insertText = new vscode.SnippetString(`${key}:\n  $0`);
				item.command = { command: "editor.action.triggerSuggest", title: "Trigger Suggest" };
				items.push(item);
			} else if (key === "enum" || key === "aliases") {
				const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Property);
				if (doc) {
					item.detail = doc;
				}
				item.insertText = new vscode.SnippetString(`${key}:\n  - $0`);
				items.push(item);
			} else {
				const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Property);
				if (doc) {
					item.detail = doc;
				}
				item.insertText = `${key}: `;
				if (VALUE_TRIGGER_PROPERTIES.has(key)) {
					item.command = { command: "editor.action.triggerSuggest", title: "Trigger Suggest" };
				}
				items.push(item);
			}
		}

		return items;
	}

	private completeShortcodeEntryKeys(existingKeys: Set<string>): vscode.CompletionItem[] {
		const items: vscode.CompletionItem[] = [];

		for (const key of ALLOWED_SHORTCODE_KEYS) {
			if (existingKeys.has(key)) {
				continue;
			}

			if (key === "description") {
				const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Property);
				item.detail = "Human-readable description of the shortcode.";
				item.insertText = `${key}: `;
				items.push(item);
			} else if (key === "arguments") {
				const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Module);
				item.detail = "Positional arguments accepted by the shortcode.";
				item.insertText = new vscode.SnippetString(`arguments:\n  - $0`);
				item.command = { command: "editor.action.triggerSuggest", title: "Trigger Suggest" };
				items.push(item);
			} else if (key === "attributes") {
				const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Module);
				item.detail = "Named attributes accepted by the shortcode.";
				item.insertText = new vscode.SnippetString(`attributes:\n  $0`);
				item.command = { command: "editor.action.triggerSuggest", title: "Trigger Suggest" };
				items.push(item);
			}
		}

		return items;
	}

	private completeValues(valueType: "type" | "boolean" | "schema-uri"): vscode.CompletionItem[] {
		switch (valueType) {
			case "type": {
				const items: vscode.CompletionItem[] = [];
				for (const t of ALLOWED_TYPES) {
					const item = new vscode.CompletionItem(t, vscode.CompletionItemKind.EnumMember);
					item.insertText = ` ${t}`;
					item.filterText = t;
					items.push(item);
				}
				return items;
			}
			case "boolean": {
				return ["true", "false"].map((v) => {
					const item = new vscode.CompletionItem(v, vscode.CompletionItemKind.Value);
					item.insertText = ` ${v}`;
					item.filterText = v;
					return item;
				});
			}
			case "schema-uri": {
				const item = new vscode.CompletionItem(SCHEMA_VERSION_URI, vscode.CompletionItemKind.Constant);
				item.insertText = ` ${SCHEMA_VERSION_URI}`;
				item.filterText = SCHEMA_VERSION_URI;
				return [item];
			}
		}
	}
}
