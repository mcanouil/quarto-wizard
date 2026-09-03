import * as vscode from "vscode";
import { formatType } from "@quarto-wizard/schema";
import type { SchemaCache, FieldDescriptor } from "@quarto-wizard/schema";
import { getErrorMessage } from "@quarto-wizard/core";
import { getDocumentYaml } from "../utils/documentScan";
import type { AnnotatedYaml, YamlPathSegment } from "../utils/yamlAnnotated";
import type { TextRange } from "../utils/yamlPosition";
import { logMessage } from "../utils/log";
import { debounce } from "../utils/debounce";
import { getWorkspaceSchemaIndex } from "../utils/workspaceSchemaIndex";
import { findOwningProjectRoot } from "../utils/projectRootsRegistry";
import { isRelevantYaml } from "../utils/metadataFilesRegistry";

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
 * Where a diagnostic goes, read from the annotated parse.
 *
 * A finding about a key points at the key, and a finding about a value points at
 * the value. The line walk this replaces pointed at the whole line for both, and
 * could not point at either inside a flow style mapping.
 *
 * Exported for its own tests. Choosing where a diagnostic goes is what changed
 * for the user here, and it is not reachable through the provider without a
 * workspace, a project root and an installed extension schema.
 */
export class DiagnosticRanges {
	constructor(
		private readonly document: vscode.TextDocument,
		private readonly annotated: AnnotatedYaml,
	) {}

	/**
	 * The range of the key at a path.
	 *
	 * @param path - The path of the option.
	 */
	key(path: readonly YamlPathSegment[]): vscode.Range | undefined {
		const node = this.annotated.nodeAt(path);
		return this.toRange(node?.keyRange ?? node?.range);
	}

	/**
	 * The range of the value at a path.
	 *
	 * A key written with no value has nowhere else to point, so it falls back to
	 * the key.
	 *
	 * @param path - The path of the option.
	 */
	value(path: readonly YamlPathSegment[]): vscode.Range | undefined {
		const node = this.annotated.nodeAt(path);
		return this.toRange(node?.range ?? node?.keyRange);
	}

	private toRange(range: TextRange | undefined): vscode.Range | undefined {
		return range === undefined
			? undefined
			: new vscode.Range(this.document.positionAt(range.start), this.document.positionAt(range.end));
	}
}

/**
 * Provides diagnostics for Quarto YAML configuration files
 * by validating values against extension schema definitions.
 */
export class YamlDiagnosticsProvider implements vscode.Disposable {
	private diagnosticCollection: vscode.DiagnosticCollection;
	private disposables: vscode.Disposable[] = [];
	private debouncedValidate: ReturnType<typeof debounce>;
	private validationVersion = 0;

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
		return isRelevantYaml(document);
	}

	private async validateDocument(document: vscode.TextDocument): Promise<void> {
		if (document.isClosed) {
			return;
		}

		const version = ++this.validationVersion;
		const projectDir = await findOwningProjectRoot(document.uri);
		if (!projectDir) {
			this.setDiagnostics(document, []);
			return;
		}

		const annotated = getDocumentYaml(document, document.getText());
		// A document with no YAML, one that does not parse, and one whose keys are
		// duplicated all report nothing. A syntax error belongs to whichever
		// extension owns the language, not here.
		if (!annotated || !annotated.value || typeof annotated.value !== "object") {
			this.setDiagnostics(document, []);
			return;
		}
		const parsed = annotated.value as Record<string, unknown>;

		let schemaMap;
		try {
			({ schemaMap } = await getWorkspaceSchemaIndex(projectDir, this.schemaCache));
		} catch (error) {
			logMessage(`Failed to discover extensions for diagnostics: ${getErrorMessage(error)}.`, "warn");
			return;
		}

		// A newer validation was started while we awaited; discard this result.
		if (version !== this.validationVersion) {
			return;
		}

		if (schemaMap.size === 0) {
			this.setDiagnostics(document, []);
			return;
		}

		const diagnostics: vscode.Diagnostic[] = [];
		const where = new DiagnosticRanges(document, annotated);

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
						where,
						diagnostics,
					);
				}
			}
		} else if (Array.isArray(extensionsBlock)) {
			const range = where.key(["extensions"]);
			if (range) {
				diagnostics.push(
					new vscode.Diagnostic(
						range,
						'The "extensions" block should be an object, not an array.',
						vscode.DiagnosticSeverity.Warning,
					),
				);
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
						where,
						diagnostics,
					);
				}
			}
		}

		this.setDiagnostics(document, diagnostics);
	}

	private setDiagnostics(document: vscode.TextDocument, diagnostics: vscode.Diagnostic[]): void {
		if (document.isClosed) {
			this.diagnosticCollection.delete(document.uri);
			return;
		}
		this.diagnosticCollection.set(document.uri, diagnostics);
	}

	private validateFields(
		values: Record<string, unknown>,
		fields: Record<string, FieldDescriptor>,
		parentPath: string[],
		where: DiagnosticRanges,
		diagnostics: vscode.Diagnostic[],
	): void {
		// Check for required fields that are missing.
		for (const [key, descriptor] of Object.entries(fields)) {
			if (descriptor.required && !(key in values)) {
				// The option is not written, so the parent that should hold it is the
				// only place to point at.
				const parentRange = where.key(parentPath);
				if (parentRange) {
					diagnostics.push(
						new vscode.Diagnostic(parentRange, `Required option "${key}" is missing.`, vscode.DiagnosticSeverity.Error),
					);
				}
			}
		}

		// Validate each provided value.
		for (const [key, value] of Object.entries(values)) {
			const currentPath = [...parentPath, key];
			const descriptor = this.findDescriptor(key, fields);

			// A finding about the key points at the key, and one about the value
			// points at the value.
			const keyRange = where.key(currentPath);

			if (!descriptor) {
				// Unknown option.
				if (keyRange) {
					diagnostics.push(
						new vscode.Diagnostic(keyRange, `Unknown option "${key}".`, vscode.DiagnosticSeverity.Information),
					);
				}
				continue;
			}

			const range = where.value(currentPath);
			if (!keyRange || !range) {
				continue;
			}

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
				diagnostics.push(new vscode.Diagnostic(keyRange, message, vscode.DiagnosticSeverity.Warning));
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
						// The entry itself is written, so a finding about it points there
						// rather than at the whole sequence.
						const itemRange = where.value([...currentPath, i]) ?? range;
						for (const msg of itemErrors) {
							diagnostics.push(
								new vscode.Diagnostic(itemRange, `Item ${i + 1} of "${key}": ${msg}`, vscode.DiagnosticSeverity.Error),
							);
						}
					}
				}
			}

			// Recurse into nested objects.
			if (descriptor.properties && value && typeof value === "object" && !Array.isArray(value)) {
				this.validateFields(value as Record<string, unknown>, descriptor.properties, currentPath, where, diagnostics);
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
}
