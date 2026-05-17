/**
 * @title Schema Definition Validation
 * @description Pure validation logic for _schema.yml / _schema.json files.
 *
 * Validates syntax, structure, and semantic correctness of extension schema
 * definition files. Returns an array of findings with severity levels.
 *
 * @module validation
 */

import * as yaml from "js-yaml";
import { allowedSetsFor, ALLOWED_TYPES } from "./schema-derived.js";
import { FIELD_ALIAS_PAIRS, resolveSchemaVersion, type SchemaVersion } from "../types/schema.js";

const ALLOWED_TYPES_LIST = [...ALLOWED_TYPES].join(", ");

interface ValidationContext {
	readonly version: SchemaVersion;
	readonly allowed: ReturnType<typeof allowedSetsFor>;
	readonly findings: SchemaDefinitionFinding[];
}

/**
 * Severity level for a schema definition finding.
 */
export type SchemaDefinitionSeverity = "error" | "warning" | "information";

/**
 * A single validation finding from schema definition analysis.
 */
export interface SchemaDefinitionFinding {
	/** Human-readable description of the issue. */
	message: string;
	/** Severity level. */
	severity: SchemaDefinitionSeverity;
	/** Machine-readable code identifying the check. */
	code: string;
	/** Zero-based line number (when available from syntax errors). */
	line?: number;
	/** Zero-based column number (when available from syntax errors). */
	column?: number;
	/** Dot-separated key path to the problematic location. */
	keyPath?: string;
}

/**
 * Resolve a numeric value from a raw field, accepting both camelCase and kebab-case.
 */
function resolveNumber(raw: Record<string, unknown>, camelKey: string, kebabKey: string): number | undefined {
	const value = raw[camelKey] ?? raw[kebabKey];
	return typeof value === "number" ? value : undefined;
}

/**
 * Validate a schema definition file and return all findings.
 *
 * @param content - Raw file content (YAML or JSON string).
 * @param format - File format: "yaml" or "json".
 * @returns Array of validation findings.
 */
export function validateSchemaDefinition(content: string, format: "yaml" | "json"): SchemaDefinitionFinding[] {
	const syntaxResult = validateSchemaDefinitionSyntax(content, format);
	if (syntaxResult.error) {
		return syntaxResult.error;
	}
	return validateSchemaDefinitionStructure(syntaxResult.parsed);
}

/**
 * Validate syntax of a schema definition file.
 *
 * @param content - Raw file content.
 * @param format - File format.
 * @returns Either an error array or the parsed object.
 */
export function validateSchemaDefinitionSyntax(
	content: string,
	format: "yaml" | "json",
): { error: SchemaDefinitionFinding[] } | { error: null; parsed: unknown } {
	const trimmed = content.trim();
	if (trimmed === "") {
		return { error: null, parsed: null };
	}

	try {
		const parsed = format === "json" ? JSON.parse(content) : yaml.load(content);
		return { error: null, parsed };
	} catch (err: unknown) {
		const finding: SchemaDefinitionFinding = {
			message: "",
			severity: "error",
			code: "syntax-error",
		};

		if (format === "yaml" && err instanceof yaml.YAMLException) {
			finding.message = err.reason ?? String(err);
			if (err.mark) {
				finding.line = err.mark.line;
				finding.column = err.mark.column;
			}
		} else if (err instanceof SyntaxError) {
			finding.message = err.message;
		} else {
			finding.message = String(err);
		}

		return { error: [finding] };
	}
}

/**
 * Validate the structure and semantics of a parsed schema definition.
 *
 * @param parsed - The parsed YAML/JSON object.
 * @returns Array of validation findings.
 */
export function validateSchemaDefinitionStructure(parsed: unknown): SchemaDefinitionFinding[] {
	if (parsed === null || parsed === undefined) {
		return [];
	}

	if (typeof parsed !== "object" || Array.isArray(parsed)) {
		return [
			{
				message: "Schema definition must be an object.",
				severity: "error",
				code: "invalid-root-type",
			},
		];
	}

	const findings: SchemaDefinitionFinding[] = [];
	const root = parsed as Record<string, unknown>;

	const version: SchemaVersion = resolveSchemaVersion(
		typeof root["$schema"] === "string" ? (root["$schema"] as string) : undefined,
	);
	const ctx: ValidationContext = { version, allowed: allowedSetsFor(version), findings };

	for (const key of Object.keys(root)) {
		if (!ctx.allowed.topLevel.has(key)) {
			findings.push({
				message: `Unknown top-level key "${key}".`,
				severity: "warning",
				code: "unknown-top-level-key",
				keyPath: key,
			});
		}
	}

	if (root["options"] !== undefined) {
		if (isPlainObject(root["options"])) {
			validateFieldDescriptorMap(root["options"] as Record<string, unknown>, "options", ctx);
		} else {
			findings.push(sectionTypeError("options", '"options" must be an object.'));
		}
	}

	if (root["formats"] !== undefined) {
		if (isPlainObject(root["formats"])) {
			for (const [formatName, formatValue] of Object.entries(root["formats"] as Record<string, unknown>)) {
				const formatPath = `formats.${formatName}`;
				if (isPlainObject(formatValue)) {
					validateFieldDescriptorMap(formatValue as Record<string, unknown>, formatPath, ctx);
				} else {
					findings.push(sectionTypeError(formatPath, `Format "${formatName}" must be an object.`));
				}
			}
		} else {
			findings.push(sectionTypeError("formats", '"formats" must be an object.'));
		}
	}

	if (root["projects"] !== undefined) {
		if (Array.isArray(root["projects"])) {
			for (let i = 0; i < root["projects"].length; i++) {
				if (typeof root["projects"][i] !== "string") {
					findings.push({
						message: `Project type at index ${i} must be a string.`,
						severity: "error",
						code: "invalid-project-type",
						keyPath: `projects[${i}]`,
					});
				}
			}
		} else {
			findings.push(sectionTypeError("projects", '"projects" must be an array of project type strings.'));
		}
	}

	const attributes = root["attributes"];
	if (attributes !== undefined) {
		if (isPlainObject(attributes)) {
			for (const [groupKey, groupValue] of Object.entries(attributes as Record<string, unknown>)) {
				const groupPath = `attributes.${groupKey}`;
				if (isPlainObject(groupValue)) {
					validateFieldDescriptorMap(groupValue as Record<string, unknown>, groupPath, ctx);
				} else {
					findings.push(sectionTypeError(groupPath, `Attribute group "${groupKey}" must be an object.`));
				}
			}
		} else {
			findings.push(sectionTypeError("attributes", '"attributes" must be an object.'));
		}
	}

	const classes = root["classes"];
	if (classes !== undefined) {
		if (isPlainObject(classes)) {
			validateClassesMap(classes as Record<string, unknown>, ctx);
		} else {
			findings.push(sectionTypeError("classes", '"classes" must be an object.'));
		}
	}

	if (root["shortcodes"] !== undefined) {
		if (isPlainObject(root["shortcodes"])) {
			validateShortcodeSchemaMap(root["shortcodes"] as Record<string, unknown>, "shortcodes", ctx);
		} else {
			findings.push(sectionTypeError("shortcodes", '"shortcodes" must be an object.'));
		}
	}

	return findings;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === "object" && !Array.isArray(v);
}

function sectionTypeError(keyPath: string, message: string): SchemaDefinitionFinding {
	return { message, severity: "error", code: "invalid-section-type", keyPath };
}

function validateClassesMap(classes: Record<string, unknown>, ctx: ValidationContext): void {
	for (const [classKey, classValue] of Object.entries(classes)) {
		const classPath = `classes.${classKey}`;
		if (!isPlainObject(classValue)) {
			ctx.findings.push({
				message: `Class entry "${classKey}" must be an object.`,
				severity: "error",
				code: "invalid-class-entry",
				keyPath: classPath,
			});
			continue;
		}
		const desc = (classValue as Record<string, unknown>)["description"];
		if (desc !== undefined && typeof desc !== "string") {
			ctx.findings.push({
				message: `Class "${classKey}" description must be a string.`,
				severity: "error",
				code: "invalid-class-description",
				keyPath: `${classPath}.description`,
			});
		}
	}
}

function validateFieldDescriptorMap(fields: Record<string, unknown>, parentPath: string, ctx: ValidationContext): void {
	for (const [key, value] of Object.entries(fields)) {
		const keyPath = `${parentPath}.${key}`;
		if (isPlainObject(value)) {
			validateFieldDescriptor(value as Record<string, unknown>, keyPath, ctx, false);
		} else {
			ctx.findings.push({
				message: `Field descriptor "${key}" must be an object.`,
				severity: "error",
				code: "invalid-field-descriptor",
				keyPath,
			});
		}
	}
}

/**
 * @param isShortcodeArgument - True when the descriptor is a positional argument
 *   of a shortcode. The `content` type is only valid in that context.
 */
function validateFieldDescriptor(
	raw: Record<string, unknown>,
	keyPath: string,
	ctx: ValidationContext,
	isShortcodeArgument: boolean,
): void {
	const { findings, allowed, version } = ctx;

	for (const prop of Object.keys(raw)) {
		if (!allowed.fieldDescriptor.has(prop)) {
			findings.push({
				message: `Unknown field property "${prop}".`,
				severity: "warning",
				code: "unknown-field-property",
				keyPath: `${keyPath}.${prop}`,
			});
		}
	}

	// v2 lists only canonical keys, so kebab variants surface as "unknown property" already.
	if (version === "v1") {
		for (const [camel, kebab] of FIELD_ALIAS_PAIRS) {
			if (raw[camel] !== undefined && raw[kebab] !== undefined) {
				findings.push({
					message: `Both "${camel}" and "${kebab}" are defined; use only one form.`,
					severity: "warning",
					code: "duplicate-alias-keys",
					keyPath,
				});
			}
		}
	}

	const typeValue = raw["type"];
	if (typeValue !== undefined) {
		const types = Array.isArray(typeValue) ? typeValue : [typeValue];
		for (const t of types) {
			if (typeof t === "string" && !ALLOWED_TYPES.has(t)) {
				findings.push({
					message: `Invalid type "${t}". Allowed types: ${ALLOWED_TYPES_LIST}.`,
					severity: "error",
					code: "invalid-type",
					keyPath: `${keyPath}.type`,
				});
			} else if (t === "content" && !isShortcodeArgument) {
				findings.push({
					message: 'Type "content" is only valid for shortcode arguments.',
					severity: "error",
					code: "content-type-outside-shortcode-argument",
					keyPath: `${keyPath}.type`,
				});
			}
		}
	}

	validateFieldSemantics(raw, keyPath, findings);

	if (isPlainObject(raw["items"])) {
		validateFieldDescriptor(raw["items"] as Record<string, unknown>, `${keyPath}.items`, ctx, false);
	}

	if (isPlainObject(raw["properties"])) {
		validateFieldDescriptorMap(raw["properties"] as Record<string, unknown>, `${keyPath}.properties`, ctx);
	}

	const apKey = raw["additionalProperties"] !== undefined ? "additionalProperties" : "additional-properties";
	const ap = raw[apKey];
	if (isPlainObject(ap)) {
		validateFieldDescriptor(ap as Record<string, unknown>, `${keyPath}.${apKey}`, ctx, false);
	}
}

function validateFieldSemantics(
	raw: Record<string, unknown>,
	keyPath: string,
	findings: SchemaDefinitionFinding[],
): void {
	const typeValue = raw["type"];
	const typeSet = new Set(
		Array.isArray(typeValue) ? typeValue.map(String) : typeValue !== undefined ? [String(typeValue)] : [],
	);

	const min = resolveNumber(raw, "min", "minimum");
	const max = resolveNumber(raw, "max", "maximum");
	if (min !== undefined && max !== undefined && min > max) {
		findings.push({
			message: `"min" (${min}) is greater than "max" (${max}).`,
			severity: "error",
			code: "min-greater-than-max",
			keyPath,
		});
	}

	const exclusiveMin = resolveNumber(raw, "exclusiveMinimum", "exclusive-minimum");
	const exclusiveMax = resolveNumber(raw, "exclusiveMaximum", "exclusive-maximum");
	if (exclusiveMin !== undefined && exclusiveMax !== undefined && exclusiveMin > exclusiveMax) {
		findings.push({
			message: `"exclusiveMinimum" (${exclusiveMin}) is greater than "exclusiveMaximum" (${exclusiveMax}).`,
			severity: "error",
			code: "exclusive-min-greater-than-exclusive-max",
			keyPath,
		});
	}

	const minLength = resolveNumber(raw, "minLength", "min-length");
	const maxLength = resolveNumber(raw, "maxLength", "max-length");
	if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
		findings.push({
			message: `"minLength" (${minLength}) is greater than "maxLength" (${maxLength}).`,
			severity: "error",
			code: "min-length-greater-than-max-length",
			keyPath,
		});
	}

	const minItems = resolveNumber(raw, "minItems", "min-items");
	const maxItems = resolveNumber(raw, "maxItems", "max-items");
	if (minItems !== undefined && maxItems !== undefined && minItems > maxItems) {
		findings.push({
			message: `"minItems" (${minItems}) is greater than "maxItems" (${maxItems}).`,
			severity: "error",
			code: "min-items-greater-than-max-items",
			keyPath,
		});
	}

	if (raw["items"] !== undefined && !typeSet.has("array")) {
		findings.push({
			message: '"items" is defined but "type" does not include "array".',
			severity: "warning",
			code: "items-without-array-type",
			keyPath,
		});
	}

	if (raw["properties"] !== undefined && !typeSet.has("object")) {
		findings.push({
			message: '"properties" is defined but "type" does not include "object".',
			severity: "warning",
			code: "properties-without-object-type",
			keyPath,
		});
	}

	if (raw["enum"] !== undefined && raw["const"] !== undefined) {
		findings.push({
			message: 'Both "enum" and "const" are defined; only one should be used.',
			severity: "warning",
			code: "enum-and-const",
			keyPath,
		});
	}

	if (Array.isArray(raw["enum"]) && raw["enum"].length === 0) {
		findings.push({
			message: '"enum" is empty; no value would be valid.',
			severity: "warning",
			code: "empty-enum",
			keyPath,
		});
	}

	if (typeof raw["pattern"] === "string") {
		try {
			new RegExp(raw["pattern"]);
		} catch {
			findings.push({
				message: `Invalid regular expression in "pattern": "${raw["pattern"]}".`,
				severity: "error",
				code: "invalid-pattern",
				keyPath: `${keyPath}.pattern`,
			});
		}
	}

	const propertyNamesValue = raw["propertyNames"] ?? raw["property-names"];
	if (typeof propertyNamesValue === "string") {
		try {
			new RegExp(propertyNamesValue);
		} catch {
			findings.push({
				message: `Invalid regular expression in "property-names": "${propertyNamesValue}".`,
				severity: "error",
				code: "invalid-property-names",
				keyPath: `${keyPath}.property-names`,
			});
		}
	}

	const multipleOf = resolveNumber(raw, "multipleOf", "multiple-of");
	if (multipleOf !== undefined && multipleOf <= 0) {
		findings.push({
			message: `"multiple-of" must be greater than 0 (got ${multipleOf}).`,
			severity: "error",
			code: "invalid-multiple-of",
			keyPath,
		});
	}
}

function validateShortcodeSchemaMap(
	shortcodes: Record<string, unknown>,
	parentPath: string,
	ctx: ValidationContext,
): void {
	const { findings, allowed, version } = ctx;

	for (const [name, value] of Object.entries(shortcodes)) {
		const scPath = `${parentPath}.${name}`;

		if (!isPlainObject(value)) {
			findings.push({
				message: `Shortcode "${name}" must be an object.`,
				severity: "error",
				code: "invalid-shortcode-type",
				keyPath: scPath,
			});
			continue;
		}

		const sc = value as Record<string, unknown>;

		for (const key of Object.keys(sc)) {
			if (!allowed.shortcodeEntry.has(key)) {
				findings.push({
					message: `Unknown shortcode property "${key}".`,
					severity: "warning",
					code: "unknown-shortcode-property",
					keyPath: `${scPath}.${key}`,
				});
			}
		}

		if (sc["arguments"] !== undefined) {
			if (!Array.isArray(sc["arguments"])) {
				findings.push({
					message: `Shortcode "${name}" "arguments" must be an array.`,
					severity: "error",
					code: "invalid-shortcode-arguments",
					keyPath: `${scPath}.arguments`,
				});
			} else {
				for (let i = 0; i < sc["arguments"].length; i++) {
					const arg = sc["arguments"][i] as Record<string, unknown> | undefined;
					const argPath = `${scPath}.arguments[${i}]`;
					if (arg && typeof arg === "object" && !Array.isArray(arg)) {
						if (!arg["name"] || typeof arg["name"] !== "string") {
							findings.push({
								message: `Shortcode "${name}" argument ${i} is missing a "name" property.`,
								severity: "error",
								code: "missing-shortcode-argument-name",
								keyPath: argPath,
							});
						}
						validateFieldDescriptor(arg, argPath, ctx, true);
					}
				}
			}
		}

		if (sc["attributes"] !== undefined) {
			if (isPlainObject(sc["attributes"])) {
				validateFieldDescriptorMap(sc["attributes"] as Record<string, unknown>, `${scPath}.attributes`, ctx);
			} else {
				findings.push({
					message: `Shortcode "${name}" "attributes" must be an object.`,
					severity: "error",
					code: "invalid-shortcode-attributes",
					keyPath: `${scPath}.attributes`,
				});
			}
		}

		if (version === "v2" && sc["required"] !== undefined) {
			validateShortcodeRequired(name, sc, scPath, ctx);
		}
	}
}

function validateShortcodeRequired(
	name: string,
	sc: Record<string, unknown>,
	scPath: string,
	ctx: ValidationContext,
): void {
	const required = sc["required"];
	if (!Array.isArray(required)) {
		ctx.findings.push({
			message: `Shortcode "${name}" "required" must be an array of attribute names.`,
			severity: "error",
			code: "invalid-shortcode-required",
			keyPath: `${scPath}.required`,
		});
		return;
	}
	const declared = isPlainObject(sc["attributes"])
		? new Set(Object.keys(sc["attributes"] as Record<string, unknown>))
		: new Set<string>();
	for (let i = 0; i < required.length; i++) {
		const ref = required[i];
		if (typeof ref !== "string") {
			ctx.findings.push({
				message: `Shortcode "${name}" required[${i}] must be a string.`,
				severity: "error",
				code: "invalid-required-entry",
				keyPath: `${scPath}.required[${i}]`,
			});
		} else if (!declared.has(ref)) {
			ctx.findings.push({
				message: `Shortcode "${name}" required[${i}] "${ref}" is not declared in attributes.`,
				severity: "warning",
				code: "required-references-missing-attribute",
				keyPath: `${scPath}.required[${i}]`,
			});
		}
	}
}
