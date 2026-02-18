import * as vscode from "vscode";
import * as yaml from "js-yaml";
import { discoverInstalledExtensions, formatExtensionId, formatType } from "@quarto-wizard/core";
import type { SchemaCache, ExtensionSchema, FieldDescriptor } from "@quarto-wizard/core";
import { getYamlIndentLevel } from "../utils/yamlPosition";
import { logMessage } from "../utils/log";
import { debounce } from "../utils/debounce";

/**
 * Validate a single value against a field descriptor, returning error messages.
 * Used for array item validation where each item is checked independently.
 */
function validateSingleValue(value: unknown, descriptor: FieldDescriptor): string[] {
	const errors: string[] = [];

	if (value === null || value === undefined) {
		return errors;
	}

	// Type check.
	if (descriptor.type) {
		const knownTypes = new Set(["string", "number", "boolean", "array", "object", "integer"]);
		const types = Array.isArray(descriptor.type) ? descriptor.type : [descriptor.type];
		const relevantTypes = types.filter((t) => knownTypes.has(t));
		if (relevantTypes.length > 0) {
			const matchesAny = relevantTypes.some((t) => {
				switch (t) {
					case "string":
						return typeof value === "string";
					case "number":
						return typeof value === "number";
					case "integer":
						return typeof value === "number" && Number.isInteger(value);
					case "boolean":
						return typeof value === "boolean";
					case "array":
						return Array.isArray(value);
					case "object":
						return typeof value === "object" && !Array.isArray(value);
					default:
						return false;
				}
			});
			if (!matchesAny) {
				errors.push(
					`expected type "${formatType(descriptor.type)}", got ${Array.isArray(value) ? "array" : typeof value}.`,
				);
				return errors;
			}
		}
	}

	// Const check.
	if (descriptor.const !== undefined && value !== descriptor.const) {
		errors.push(`value must be ${JSON.stringify(descriptor.const)}.`);
	}

	// Enum check.
	if (descriptor.enum) {
		const match = descriptor.enumCaseInsensitive
			? descriptor.enum.some((v) => String(v).toLowerCase() === String(value).toLowerCase())
			: descriptor.enum.includes(value);
		if (!match) {
			errors.push(`value "${String(value)}" is not in the allowed values (${descriptor.enum.map(String).join(", ")}).`);
		}
	}

	// Numeric range checks.
	if (typeof value === "number") {
		if (descriptor.min !== undefined && value < descriptor.min) {
			errors.push(`value ${value} is below the minimum of ${descriptor.min}.`);
		}
		if (descriptor.max !== undefined && value > descriptor.max) {
			errors.push(`value ${value} exceeds the maximum of ${descriptor.max}.`);
		}
		if (descriptor.exclusiveMinimum !== undefined && value <= descriptor.exclusiveMinimum) {
			errors.push(`value ${value} must be greater than ${descriptor.exclusiveMinimum}.`);
		}
		if (descriptor.exclusiveMaximum !== undefined && value >= descriptor.exclusiveMaximum) {
			errors.push(`value ${value} must be less than ${descriptor.exclusiveMaximum}.`);
		}
	}

	// Pattern check.
	if (descriptor.pattern && typeof value === "string" && descriptor.pattern.length <= 1024) {
		try {
			const regex = descriptor.patternExact ? new RegExp(`^${descriptor.pattern}$`) : new RegExp(descriptor.pattern);
			if (!regex.test(value)) {
				errors.push(`value "${value}" does not match the required pattern "${descriptor.pattern}".`);
			}
		} catch {
			// Invalid regex in schema; skip.
		}
	}

	// String length checks.
	if (typeof value === "string") {
		if (descriptor.minLength !== undefined && value.length < descriptor.minLength) {
			errors.push(`value length ${value.length} is below the minimum of ${descriptor.minLength}.`);
		}
		if (descriptor.maxLength !== undefined && value.length > descriptor.maxLength) {
			errors.push(`value length ${value.length} exceeds the maximum of ${descriptor.maxLength}.`);
		}
	}

	return errors;
}

/**
 * Provides diagnostics for Quarto YAML configuration files
 * by validating values against extension schema definitions.
 */
export class YamlDiagnosticsProvider implements vscode.Disposable {
	private diagnosticCollection: vscode.DiagnosticCollection;
	private disposables: vscode.Disposable[] = [];
	private debouncedValidate: ReturnType<typeof debounce>;

	constructor(private schemaCache: SchemaCache) {
		this.diagnosticCollection = vscode.languages.createDiagnosticCollection("quarto-schema");

		this.debouncedValidate = debounce((document: vscode.TextDocument) => {
			this.validateDocument(document);
		}, 500);

		// Validate on save.
		this.disposables.push(
			vscode.workspace.onDidSaveTextDocument((document) => {
				if (this.isRelevantDocument(document)) {
					this.validateDocument(document);
				}
			}),
		);

		// Validate on change (debounced).
		this.disposables.push(
			vscode.workspace.onDidChangeTextDocument((event) => {
				if (this.isRelevantDocument(event.document)) {
					this.debouncedValidate(event.document);
				}
			}),
		);

		// Clear diagnostics when a document is closed.
		this.disposables.push(
			vscode.workspace.onDidCloseTextDocument((document) => {
				this.diagnosticCollection.delete(document.uri);
			}),
		);

		// Validate all open relevant documents on activation.
		for (const document of vscode.workspace.textDocuments) {
			if (this.isRelevantDocument(document)) {
				this.validateDocument(document);
			}
		}
	}

	dispose(): void {
		this.debouncedValidate.cancel();
		this.diagnosticCollection.dispose();
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}

	/**
	 * Force revalidation of all open documents.
	 * Useful after schema cache invalidation.
	 */
	revalidateAll(): void {
		for (const document of vscode.workspace.textDocuments) {
			if (this.isRelevantDocument(document)) {
				this.validateDocument(document);
			}
		}
	}

	private isRelevantDocument(document: vscode.TextDocument): boolean {
		const fileName = document.fileName;
		if (document.languageId === "quarto" || fileName.endsWith(".qmd")) {
			return true;
		}
		if (document.languageId === "yaml") {
			return (
				fileName.endsWith("_quarto.yml") ||
				fileName.endsWith("_quarto.yaml") ||
				fileName.endsWith("_metadata.yml") ||
				fileName.endsWith("_metadata.yaml")
			);
		}
		return false;
	}

	private async validateDocument(document: vscode.TextDocument): Promise<void> {
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
		if (!workspaceFolder) {
			return;
		}

		const projectDir = workspaceFolder.uri.fsPath;
		const text = document.getText();
		const lines = text.split("\n");
		const languageId = document.languageId;

		// Extract the YAML portion.
		const yamlText = this.extractYamlText(lines, languageId);
		if (!yamlText) {
			this.diagnosticCollection.set(document.uri, []);
			return;
		}

		let parsed: Record<string, unknown>;
		try {
			const result = yaml.load(yamlText);
			if (!result || typeof result !== "object") {
				this.diagnosticCollection.set(document.uri, []);
				return;
			}
			parsed = result as Record<string, unknown>;
		} catch {
			// YAML parse errors are handled by other extensions; skip.
			this.diagnosticCollection.set(document.uri, []);
			return;
		}

		let extensions;
		try {
			extensions = await discoverInstalledExtensions(projectDir);
		} catch (error) {
			logMessage(
				`Failed to discover extensions for diagnostics: ${error instanceof Error ? error.message : String(error)}.`,
				"warn",
			);
			return;
		}

		// Build schema map.
		const schemaMap = new Map<string, ExtensionSchema>();
		for (const ext of extensions) {
			const schema = this.schemaCache.get(ext.directory);
			if (schema) {
				schemaMap.set(formatExtensionId(ext.id), schema);
				if (!schemaMap.has(ext.id.name)) {
					schemaMap.set(ext.id.name, schema);
				}
			}
		}

		if (schemaMap.size === 0) {
			this.diagnosticCollection.set(document.uri, []);
			return;
		}

		const diagnostics: vscode.Diagnostic[] = [];
		const yamlStartLine = this.getYamlStartLine(lines, languageId);

		// Validate extension options under "extensions:".
		const extensionsBlock = parsed["extensions"];
		if (extensionsBlock && typeof extensionsBlock === "object" && !Array.isArray(extensionsBlock)) {
			for (const [extName, extConfig] of Object.entries(extensionsBlock as Record<string, unknown>)) {
				const schema = schemaMap.get(extName);
				if (!schema || !schema.options) {
					continue;
				}

				if (extConfig && typeof extConfig === "object" && !Array.isArray(extConfig)) {
					this.validateFields(
						extConfig as Record<string, unknown>,
						schema.options,
						["extensions", extName],
						lines,
						yamlStartLine,
						diagnostics,
					);
				}
			}
		}

		// Validate format-specific options under "format:".
		const formatBlock = parsed["format"];
		if (formatBlock && typeof formatBlock === "object" && !Array.isArray(formatBlock)) {
			for (const [formatName, formatConfig] of Object.entries(formatBlock as Record<string, unknown>)) {
				if (!formatConfig || typeof formatConfig !== "object" || Array.isArray(formatConfig)) {
					continue;
				}

				// Collect format fields from all schemas that define this format.
				const formatFields: Record<string, FieldDescriptor> = {};
				for (const schema of schemaMap.values()) {
					if (schema.formats && schema.formats[formatName]) {
						for (const [key, descriptor] of Object.entries(schema.formats[formatName])) {
							if (!(key in formatFields)) {
								formatFields[key] = descriptor;
							}
						}
					}
				}

				if (Object.keys(formatFields).length > 0) {
					this.validateFields(
						formatConfig as Record<string, unknown>,
						formatFields,
						["format", formatName],
						lines,
						yamlStartLine,
						diagnostics,
					);
				}
			}
		}

		this.diagnosticCollection.set(document.uri, diagnostics);
	}

	private validateFields(
		values: Record<string, unknown>,
		fields: Record<string, FieldDescriptor>,
		parentPath: string[],
		lines: string[],
		yamlStartLine: number,
		diagnostics: vscode.Diagnostic[],
	): void {
		// Check for required fields that are missing.
		for (const [key, descriptor] of Object.entries(fields)) {
			if (descriptor.required && !(key in values)) {
				const parentLine = this.findKeyLine(parentPath, lines, yamlStartLine);
				if (parentLine >= 0) {
					const range = new vscode.Range(parentLine, 0, parentLine, lines[parentLine].length);
					diagnostics.push(
						new vscode.Diagnostic(range, `Required option "${key}" is missing.`, vscode.DiagnosticSeverity.Error),
					);
				}
			}
		}

		// Validate each provided value.
		for (const [key, value] of Object.entries(values)) {
			const currentPath = [...parentPath, key];
			const descriptor = this.findDescriptor(key, fields);

			if (!descriptor) {
				// Unknown option.
				const line = this.findKeyLine(currentPath, lines, yamlStartLine);
				if (line >= 0) {
					const range = new vscode.Range(line, 0, line, lines[line].length);
					diagnostics.push(
						new vscode.Diagnostic(range, `Unknown option "${key}".`, vscode.DiagnosticSeverity.Information),
					);
				}
				continue;
			}

			const line = this.findKeyLine(currentPath, lines, yamlStartLine);
			if (line < 0) {
				continue;
			}
			const range = new vscode.Range(line, 0, line, lines[line].length);

			// Deprecated check.
			if (descriptor.deprecated) {
				let message: string;
				if (typeof descriptor.deprecated === "string") {
					message = `Option "${key}" is deprecated: ${descriptor.deprecated}.`;
				} else if (typeof descriptor.deprecated === "object") {
					const spec = descriptor.deprecated;
					const parts = [`Option "${key}" is deprecated`];
					if (spec.since) {
						parts[0] += ` since ${spec.since}`;
					}
					if (spec.message) {
						parts.push(spec.message);
					} else if (spec.replaceWith) {
						parts.push(`Use "${spec.replaceWith}" instead.`);
					}
					message = parts.join(". ") + (parts[parts.length - 1].endsWith(".") ? "" : ".");
				} else {
					message = `Option "${key}" is deprecated.`;
				}
				diagnostics.push(new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Warning));
			}

			// Type check.
			if (descriptor.type && value !== null && value !== undefined) {
				const typeError = this.checkType(value, descriptor.type);
				if (typeError) {
					const valueStr = typeof value === "string" ? `"${value}"` : String(value);
					diagnostics.push(
						new vscode.Diagnostic(
							range,
							`Option "${key}": expected type "${formatType(descriptor.type)}", got ${typeError} ${valueStr}.`,
							vscode.DiagnosticSeverity.Error,
						),
					);
					continue;
				}
			}

			// Value constraint checks (const, enum, numeric range, pattern, string length).
			if (value !== null && value !== undefined) {
				for (const msg of validateSingleValue(value, descriptor)) {
					diagnostics.push(new vscode.Diagnostic(range, `Option "${key}": ${msg}`, vscode.DiagnosticSeverity.Error));
				}
			}

			// Array length checks and item validation.
			if (Array.isArray(value)) {
				if (descriptor.minItems !== undefined && value.length < descriptor.minItems) {
					diagnostics.push(
						new vscode.Diagnostic(
							range,
							`Option "${key}": array has ${value.length} item(s), minimum is ${descriptor.minItems}.`,
							vscode.DiagnosticSeverity.Error,
						),
					);
				}
				if (descriptor.maxItems !== undefined && value.length > descriptor.maxItems) {
					diagnostics.push(
						new vscode.Diagnostic(
							range,
							`Option "${key}": array has ${value.length} item(s), maximum is ${descriptor.maxItems}.`,
							vscode.DiagnosticSeverity.Error,
						),
					);
				}
				if (descriptor.items) {
					for (let i = 0; i < value.length; i++) {
						const itemErrors = validateSingleValue(value[i], descriptor.items);
						for (const msg of itemErrors) {
							diagnostics.push(
								new vscode.Diagnostic(range, `Item ${i + 1} of "${key}": ${msg}`, vscode.DiagnosticSeverity.Error),
							);
						}
					}
				}
			}

			// Recurse into nested objects.
			if (descriptor.properties && value && typeof value === "object" && !Array.isArray(value)) {
				this.validateFields(
					value as Record<string, unknown>,
					descriptor.properties,
					currentPath,
					lines,
					yamlStartLine,
					diagnostics,
				);
			}
		}
	}

	private findDescriptor(key: string, fields: Record<string, FieldDescriptor>): FieldDescriptor | undefined {
		if (fields[key]) {
			return fields[key];
		}

		// Check aliases.
		for (const [, descriptor] of Object.entries(fields)) {
			if (descriptor.aliases && descriptor.aliases.includes(key)) {
				return descriptor;
			}
		}

		return undefined;
	}

	private static readonly KNOWN_TYPES = new Set(["string", "number", "boolean", "array", "object", "integer"]);

	private checkType(value: unknown, expectedType: string | string[]): string | undefined {
		if (Array.isArray(expectedType)) {
			const knownTypes = expectedType.filter((t) => YamlDiagnosticsProvider.KNOWN_TYPES.has(t));
			if (knownTypes.length === 0) {
				return undefined;
			}
			for (const t of knownTypes) {
				if (this.checkType(value, t) === undefined) {
					return undefined;
				}
			}
			return Array.isArray(value) ? "array" : typeof value;
		}

		if (!YamlDiagnosticsProvider.KNOWN_TYPES.has(expectedType)) {
			return undefined;
		}

		switch (expectedType) {
			case "string":
				if (typeof value !== "string") {
					return typeof value;
				}
				break;
			case "number":
				if (typeof value !== "number") {
					return typeof value;
				}
				break;
			case "integer":
				if (typeof value !== "number") {
					return Array.isArray(value) ? "array" : typeof value;
				}
				if (!Number.isInteger(value)) {
					return "non-integer number";
				}
				break;
			case "boolean":
				if (typeof value !== "boolean") {
					return typeof value;
				}
				break;
			case "array":
				if (!Array.isArray(value)) {
					return typeof value;
				}
				break;
			case "object":
				if (!value || typeof value !== "object" || Array.isArray(value)) {
					return Array.isArray(value) ? "array" : typeof value;
				}
				break;
		}
		return undefined;
	}

	/**
	 * Find the document line number for a given YAML key path.
	 *
	 * Walks through the lines looking for each key in the path at
	 * increasing indentation levels.
	 */
	private findKeyLine(keyPath: string[], lines: string[], yamlStartLine: number): number {
		let searchStart = yamlStartLine;
		let expectedMinIndent = 0;

		for (let pathIdx = 0; pathIdx < keyPath.length; pathIdx++) {
			const targetKey = keyPath[pathIdx];
			let found = false;

			for (let i = searchStart; i < lines.length; i++) {
				const line = lines[i];
				const trimmed = line.trim();
				if (trimmed === "" || trimmed.startsWith("#") || trimmed === "---") {
					continue;
				}

				const indent = getYamlIndentLevel(line);

				// If we drop back to a lower indentation, stop looking.
				if (pathIdx > 0 && indent < expectedMinIndent) {
					break;
				}

				const keyMatch = /^\s*(?:- )?([^\s:][^:]*?)\s*:/.exec(line);
				if (keyMatch && keyMatch[1] === targetKey && indent >= expectedMinIndent) {
					if (pathIdx === keyPath.length - 1) {
						return i;
					}
					searchStart = i + 1;
					expectedMinIndent = indent + 1;
					found = true;
					break;
				}
			}

			if (!found) {
				return -1;
			}
		}

		return -1;
	}

	private extractYamlText(lines: string[], languageId: string): string | null {
		if (languageId === "yaml") {
			return lines.join("\n");
		}

		// For .qmd files the front matter must start with --- on line 0.
		if (lines.length === 0 || lines[0].trim() !== "---") {
			return null;
		}

		let end = -1;
		for (let i = 1; i < lines.length; i++) {
			if (lines[i].trim() === "---") {
				end = i;
				break;
			}
		}

		if (end === -1) {
			return null;
		}

		return lines.slice(1, end).join("\n");
	}

	private getYamlStartLine(lines: string[], languageId: string): number {
		if (languageId === "yaml") {
			return 0;
		}

		// Front matter must start with --- on line 0.
		if (lines.length > 0 && lines[0].trim() === "---") {
			return 1;
		}

		return 0;
	}
}
