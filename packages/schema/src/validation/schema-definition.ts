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
import {
	ALLOWED_TOP_LEVEL_KEYS,
	ALLOWED_FIELD_PROPERTIES,
	ALLOWED_TYPES,
	ALLOWED_SHORTCODE_KEYS,
} from "./schema-derived.js";

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

	// Check for unknown top-level keys.
	for (const key of Object.keys(root)) {
		if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
			findings.push({
				message: `Unknown top-level key "${key}".`,
				severity: "warning",
				code: "unknown-top-level-key",
				keyPath: key,
			});
		}
	}

	// Validate "options" section.
	if (root["options"] !== undefined) {
		if (root["options"] && typeof root["options"] === "object" && !Array.isArray(root["options"])) {
			validateFieldDescriptorMap(root["options"] as Record<string, unknown>, "options", findings);
		} else {
			findings.push({
				message: '"options" must be an object.',
				severity: "error",
				code: "invalid-section-type",
				keyPath: "options",
			});
		}
	}

	// Validate "formats" section.
	if (root["formats"] !== undefined) {
		if (root["formats"] && typeof root["formats"] === "object" && !Array.isArray(root["formats"])) {
			for (const [formatName, formatValue] of Object.entries(root["formats"] as Record<string, unknown>)) {
				const formatPath = `formats.${formatName}`;
				if (formatValue && typeof formatValue === "object" && !Array.isArray(formatValue)) {
					validateFieldDescriptorMap(formatValue as Record<string, unknown>, formatPath, findings);
				} else {
					findings.push({
						message: `Format "${formatName}" must be an object.`,
						severity: "error",
						code: "invalid-section-type",
						keyPath: formatPath,
					});
				}
			}
		} else {
			findings.push({
				message: '"formats" must be an object.',
				severity: "error",
				code: "invalid-section-type",
				keyPath: "formats",
			});
		}
	}

	// Validate "projects" section (array of project type strings).
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
			findings.push({
				message: '"projects" must be an array of project type strings.',
				severity: "error",
				code: "invalid-section-type",
				keyPath: "projects",
			});
		}
	}

	// Validate "attributes" section.
	const attributes = root["attributes"];
	if (attributes !== undefined) {
		if (attributes && typeof attributes === "object" && !Array.isArray(attributes)) {
			for (const [groupKey, groupValue] of Object.entries(attributes as Record<string, unknown>)) {
				const groupPath = `attributes.${groupKey}`;
				if (groupValue && typeof groupValue === "object" && !Array.isArray(groupValue)) {
					validateFieldDescriptorMap(groupValue as Record<string, unknown>, groupPath, findings);
				} else {
					findings.push({
						message: `Attribute group "${groupKey}" must be an object.`,
						severity: "error",
						code: "invalid-section-type",
						keyPath: groupPath,
					});
				}
			}
		} else {
			findings.push({
				message: '"attributes" must be an object.',
				severity: "error",
				code: "invalid-section-type",
				keyPath: "attributes",
			});
		}
	}

	// Validate "classes" section.
	const classes = root["classes"];
	if (classes !== undefined) {
		if (classes && typeof classes === "object" && !Array.isArray(classes)) {
			for (const [classKey, classValue] of Object.entries(classes as Record<string, unknown>)) {
				const classPath = `classes.${classKey}`;
				if (!classValue || typeof classValue !== "object" || Array.isArray(classValue)) {
					findings.push({
						message: `Class entry "${classKey}" must be an object.`,
						severity: "error",
						code: "invalid-class-entry",
						keyPath: classPath,
					});
					continue;
				}
				const classObj = classValue as Record<string, unknown>;
				if (classObj["description"] !== undefined && typeof classObj["description"] !== "string") {
					findings.push({
						message: `Class "${classKey}" description must be a string.`,
						severity: "error",
						code: "invalid-class-description",
						keyPath: `${classPath}.description`,
					});
				}
			}
		} else {
			findings.push({
				message: '"classes" must be an object.',
				severity: "error",
				code: "invalid-section-type",
				keyPath: "classes",
			});
		}
	}

	// Validate "shortcodes" section.
	if (root["shortcodes"] !== undefined) {
		if (root["shortcodes"] && typeof root["shortcodes"] === "object" && !Array.isArray(root["shortcodes"])) {
			validateShortcodeSchemaMap(root["shortcodes"] as Record<string, unknown>, "shortcodes", findings);
		} else {
			findings.push({
				message: '"shortcodes" must be an object.',
				severity: "error",
				code: "invalid-section-type",
				keyPath: "shortcodes",
			});
		}
	}

	return findings;
}

/**
 * Validate a map of field descriptors (e.g., the "options" section).
 */
function validateFieldDescriptorMap(
	fields: Record<string, unknown>,
	parentPath: string,
	findings: SchemaDefinitionFinding[],
): void {
	for (const [key, value] of Object.entries(fields)) {
		const keyPath = `${parentPath}.${key}`;
		if (value && typeof value === "object" && !Array.isArray(value)) {
			validateFieldDescriptor(value as Record<string, unknown>, keyPath, findings);
		} else {
			findings.push({
				message: `Field descriptor "${key}" must be an object.`,
				severity: "error",
				code: "invalid-field-descriptor",
				keyPath,
			});
		}
	}
}

/**
 * Validate a single field descriptor for allowed properties, valid types,
 * and semantic consistency.
 */
function validateFieldDescriptor(
	raw: Record<string, unknown>,
	keyPath: string,
	findings: SchemaDefinitionFinding[],
): void {
	// Check for unknown properties.
	for (const prop of Object.keys(raw)) {
		if (!ALLOWED_FIELD_PROPERTIES.has(prop)) {
			findings.push({
				message: `Unknown field property "${prop}".`,
				severity: "warning",
				code: "unknown-field-property",
				keyPath: `${keyPath}.${prop}`,
			});
		}
	}

	// Validate "type" values.
	const typeValue = raw["type"];
	if (typeValue !== undefined) {
		const types = Array.isArray(typeValue) ? typeValue : [typeValue];
		for (const t of types) {
			if (typeof t === "string" && !ALLOWED_TYPES.has(t)) {
				findings.push({
					message: `Invalid type "${t}". Allowed types: ${[...ALLOWED_TYPES].join(", ")}.`,
					severity: "error",
					code: "invalid-type",
					keyPath: `${keyPath}.type`,
				});
			}
		}
	}

	// Semantic checks.
	validateFieldSemantics(raw, keyPath, findings);

	// Recurse into "items".
	if (raw["items"] !== undefined) {
		if (raw["items"] && typeof raw["items"] === "object" && !Array.isArray(raw["items"])) {
			validateFieldDescriptor(raw["items"] as Record<string, unknown>, `${keyPath}.items`, findings);
		}
	}

	// Recurse into "properties".
	if (raw["properties"] !== undefined) {
		if (raw["properties"] && typeof raw["properties"] === "object" && !Array.isArray(raw["properties"])) {
			validateFieldDescriptorMap(raw["properties"] as Record<string, unknown>, `${keyPath}.properties`, findings);
		}
	}
}

/**
 * Run semantic consistency checks on a field descriptor.
 */
function validateFieldSemantics(
	raw: Record<string, unknown>,
	keyPath: string,
	findings: SchemaDefinitionFinding[],
): void {
	// Resolve type information, handling both single values and arrays.
	const typeValue = raw["type"];
	const typeSet = new Set(
		Array.isArray(typeValue) ? typeValue.map(String) : typeValue !== undefined ? [String(typeValue)] : [],
	);

	// min > max.
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

	// exclusiveMinimum > exclusiveMaximum.
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

	// minLength > maxLength.
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

	// minItems > maxItems.
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

	// "items" without type: array.
	if (raw["items"] !== undefined && !typeSet.has("array")) {
		findings.push({
			message: '"items" is defined but "type" does not include "array".',
			severity: "warning",
			code: "items-without-array-type",
			keyPath,
		});
	}

	// "properties" without type: object.
	if (raw["properties"] !== undefined && !typeSet.has("object")) {
		findings.push({
			message: '"properties" is defined but "type" does not include "object".',
			severity: "warning",
			code: "properties-without-object-type",
			keyPath,
		});
	}

	// "enum" + "const" together.
	if (raw["enum"] !== undefined && raw["const"] !== undefined) {
		findings.push({
			message: 'Both "enum" and "const" are defined; only one should be used.',
			severity: "warning",
			code: "enum-and-const",
			keyPath,
		});
	}

	// Empty "enum".
	if (Array.isArray(raw["enum"]) && raw["enum"].length === 0) {
		findings.push({
			message: '"enum" is empty; no value would be valid.',
			severity: "warning",
			code: "empty-enum",
			keyPath,
		});
	}

	// Invalid regex in "pattern".
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
}

/**
 * Validate the "shortcodes" section of a schema definition.
 */
function validateShortcodeSchemaMap(
	shortcodes: Record<string, unknown>,
	parentPath: string,
	findings: SchemaDefinitionFinding[],
): void {
	for (const [name, value] of Object.entries(shortcodes)) {
		const scPath = `${parentPath}.${name}`;

		if (!value || typeof value !== "object" || Array.isArray(value)) {
			findings.push({
				message: `Shortcode "${name}" must be an object.`,
				severity: "error",
				code: "invalid-shortcode-type",
				keyPath: scPath,
			});
			continue;
		}

		const sc = value as Record<string, unknown>;

		// Check for unknown keys.
		for (const key of Object.keys(sc)) {
			if (!ALLOWED_SHORTCODE_KEYS.has(key)) {
				findings.push({
					message: `Unknown shortcode property "${key}".`,
					severity: "warning",
					code: "unknown-shortcode-property",
					keyPath: `${scPath}.${key}`,
				});
			}
		}

		// Validate "arguments".
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
						validateFieldDescriptor(arg, argPath, findings);
					}
				}
			}
		}

		// Validate "attributes".
		if (sc["attributes"] !== undefined) {
			if (sc["attributes"] && typeof sc["attributes"] === "object" && !Array.isArray(sc["attributes"])) {
				validateFieldDescriptorMap(sc["attributes"] as Record<string, unknown>, `${scPath}.attributes`, findings);
			} else {
				findings.push({
					message: `Shortcode "${name}" "attributes" must be an object.`,
					severity: "error",
					code: "invalid-shortcode-attributes",
					keyPath: `${scPath}.attributes`,
				});
			}
		}
	}
}
