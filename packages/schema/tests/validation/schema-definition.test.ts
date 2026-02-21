import { describe, it, expect } from "vitest";
import {
	validateSchemaDefinition,
	validateSchemaDefinitionSyntax,
	validateSchemaDefinitionStructure,
} from "../../src/validation/schema-definition.js";

describe("validateSchemaDefinitionSyntax", () => {
	it("parses valid YAML without errors", () => {
		const result = validateSchemaDefinitionSyntax("options:\n  foo:\n    type: string\n", "yaml");
		expect(result.error).toBeNull();
	});

	it("parses valid JSON without errors", () => {
		const result = validateSchemaDefinitionSyntax('{"options": {"foo": {"type": "string"}}}', "json");
		expect(result.error).toBeNull();
	});

	it("returns empty findings for empty content", () => {
		const result = validateSchemaDefinitionSyntax("", "yaml");
		expect(result.error).toBeNull();
	});

	it("returns empty findings for whitespace-only content", () => {
		const result = validateSchemaDefinitionSyntax("   \n  \n", "yaml");
		expect(result.error).toBeNull();
	});

	it("reports YAML syntax errors with line and column", () => {
		const result = validateSchemaDefinitionSyntax("foo:\n  bar: [\n", "yaml");
		expect(result.error).not.toBeNull();
		expect(result.error).toHaveLength(1);
		expect(result.error![0].code).toBe("syntax-error");
		expect(result.error![0].severity).toBe("error");
		expect(result.error![0].line).toBeTypeOf("number");
	});

	it("reports JSON syntax errors", () => {
		const result = validateSchemaDefinitionSyntax('{"foo": }', "json");
		expect(result.error).not.toBeNull();
		expect(result.error).toHaveLength(1);
		expect(result.error![0].code).toBe("syntax-error");
		expect(result.error![0].severity).toBe("error");
	});
});

describe("validateSchemaDefinitionStructure", () => {
	it("returns no findings for null input", () => {
		expect(validateSchemaDefinitionStructure(null)).toEqual([]);
	});

	it("returns no findings for undefined input", () => {
		expect(validateSchemaDefinitionStructure(undefined)).toEqual([]);
	});

	it("returns error for non-object root", () => {
		const findings = validateSchemaDefinitionStructure("just a string");
		expect(findings).toHaveLength(1);
		expect(findings[0].code).toBe("invalid-root-type");
	});

	it("returns error for array root", () => {
		const findings = validateSchemaDefinitionStructure([1, 2, 3]);
		expect(findings).toHaveLength(1);
		expect(findings[0].code).toBe("invalid-root-type");
	});

	it("warns about unknown top-level keys", () => {
		const findings = validateSchemaDefinitionStructure({ unknownKey: true });
		expect(findings.some((f) => f.code === "unknown-top-level-key")).toBe(true);
	});

	it("accepts $schema as a top-level key", () => {
		const findings = validateSchemaDefinitionStructure({
			$schema: "https://example.com/schema.json",
		});
		expect(findings.filter((f) => f.code === "unknown-top-level-key")).toHaveLength(0);
	});

	it("accepts all valid top-level keys without warnings", () => {
		const findings = validateSchemaDefinitionStructure({
			$schema: "https://example.com/schema.json",
			options: {},
			shortcodes: {},
			formats: {},
			projects: [],
			attributes: {},
			classes: {},
		});
		expect(findings.filter((f) => f.code === "unknown-top-level-key")).toHaveLength(0);
	});

	it("reports non-object options section", () => {
		const findings = validateSchemaDefinitionStructure({ options: "not an object" });
		expect(findings.some((f) => f.code === "invalid-section-type" && f.keyPath === "options")).toBe(true);
	});

	it("reports non-object formats section", () => {
		const findings = validateSchemaDefinitionStructure({ formats: [1, 2] });
		expect(findings.some((f) => f.code === "invalid-section-type" && f.keyPath === "formats")).toBe(true);
	});

	it("reports non-array projects section", () => {
		const findings = validateSchemaDefinitionStructure({ projects: 42 });
		expect(findings.some((f) => f.code === "invalid-section-type" && f.keyPath === "projects")).toBe(true);
	});

	it("accepts valid projects array of strings", () => {
		const findings = validateSchemaDefinitionStructure({ projects: ["my-website", "my-book"] });
		expect(findings.filter((f) => f.keyPath?.startsWith("projects"))).toHaveLength(0);
	});

	it("reports non-string entries in projects array", () => {
		const findings = validateSchemaDefinitionStructure({ projects: ["valid", 42] });
		expect(findings.some((f) => f.code === "invalid-project-type")).toBe(true);
	});

	it("reports non-object shortcodes section", () => {
		const findings = validateSchemaDefinitionStructure({ shortcodes: true });
		expect(findings.some((f) => f.code === "invalid-section-type" && f.keyPath === "shortcodes")).toBe(true);
	});

	it("reports non-object attributes section", () => {
		const findings = validateSchemaDefinitionStructure({ attributes: "bad" });
		expect(findings.some((f) => f.code === "invalid-section-type" && f.keyPath === "attributes")).toBe(true);
	});

	it("validates attributes field descriptors inside groups", () => {
		const findings = validateSchemaDefinitionStructure({
			attributes: {
				_any: {
					colour: { type: "string", description: "Text colour." },
				},
			},
		});
		expect(findings.filter((f) => f.severity === "error")).toHaveLength(0);
	});

	it("reports non-object attributes group value", () => {
		const findings = validateSchemaDefinitionStructure({
			attributes: {
				_any: "bad",
			},
		});
		expect(findings.some((f) => f.code === "invalid-section-type" && f.keyPath === "attributes._any")).toBe(
			true,
		);
	});

	it("accepts valid classes section", () => {
		const findings = validateSchemaDefinitionStructure({
			classes: { panel: { description: "A panel." } },
		});
		expect(findings.filter((f) => f.severity === "error")).toHaveLength(0);
	});

	it("reports non-object classes section", () => {
		const findings = validateSchemaDefinitionStructure({ classes: "bad" });
		expect(findings.some((f) => f.code === "invalid-section-type" && f.keyPath === "classes")).toBe(true);
	});

	it("reports non-object class entry", () => {
		const findings = validateSchemaDefinitionStructure({
			classes: { panel: "bad" },
		});
		expect(findings.some((f) => f.code === "invalid-class-entry")).toBe(true);
	});

	it("reports non-string class description", () => {
		const findings = validateSchemaDefinitionStructure({
			classes: { panel: { description: 42 } },
		});
		expect(findings.some((f) => f.code === "invalid-class-description")).toBe(true);
	});
});

describe("field descriptor validation", () => {
	it("reports non-object field descriptor entries", () => {
		const findings = validateSchemaDefinitionStructure({
			options: { myField: "not an object" },
		});
		expect(
			findings.some((f) => f.code === "invalid-field-descriptor" && f.keyPath === "options.myField"),
		).toBe(true);
	});

	it("warns about unknown field properties", () => {
		const findings = validateSchemaDefinitionStructure({
			options: {
				myField: {
					type: "string",
					unknownProp: true,
				},
			},
		});
		expect(findings.some((f) => f.code === "unknown-field-property")).toBe(true);
	});

	it("reports invalid type values", () => {
		const findings = validateSchemaDefinitionStructure({
			options: {
				myField: {
					type: "foobar",
				},
			},
		});
		expect(findings.some((f) => f.code === "invalid-type")).toBe(true);
	});

	it("accepts all valid type values", () => {
		const validTypes = ["string", "number", "integer", "boolean", "array", "object", "content"];
		for (const t of validTypes) {
			const findings = validateSchemaDefinitionStructure({
				options: { f: { type: t } },
			});
			expect(findings.filter((f) => f.code === "invalid-type")).toHaveLength(0);
		}
	});

	it("accepts array type values", () => {
		const findings = validateSchemaDefinitionStructure({
			options: {
				myField: {
					type: ["string", "number"],
				},
			},
		});
		expect(findings.filter((f) => f.code === "invalid-type")).toHaveLength(0);
	});

	it("reports invalid types in array type values", () => {
		const findings = validateSchemaDefinitionStructure({
			options: {
				myField: {
					type: ["string", "badtype"],
				},
			},
		});
		expect(findings.some((f) => f.code === "invalid-type")).toBe(true);
	});

	it("accepts kebab-case field properties", () => {
		const findings = validateSchemaDefinitionStructure({
			options: {
				myField: {
					type: "string",
					"min-length": 1,
					"max-length": 10,
					"pattern-exact": true,
					"enum-case-insensitive": true,
				},
			},
		});
		expect(findings.filter((f) => f.code === "unknown-field-property")).toHaveLength(0);
	});

	it("validates nested items descriptor", () => {
		const findings = validateSchemaDefinitionStructure({
			options: {
				myField: {
					type: "array",
					items: {
						type: "invalid_type",
					},
				},
			},
		});
		expect(findings.some((f) => f.code === "invalid-type")).toBe(true);
	});

	it("validates nested properties descriptors", () => {
		const findings = validateSchemaDefinitionStructure({
			options: {
				myField: {
					type: "object",
					properties: {
						nested: {
							type: "badtype",
						},
					},
				},
			},
		});
		expect(findings.some((f) => f.code === "invalid-type")).toBe(true);
	});
});

describe("shortcode validation", () => {
	it("accepts valid shortcode structure", () => {
		const findings = validateSchemaDefinitionStructure({
			shortcodes: {
				myShortcode: {
					description: "A shortcode.",
					arguments: [{ name: "arg1", type: "string" }],
					attributes: {
						attr1: { type: "boolean" },
					},
				},
			},
		});
		expect(findings).toHaveLength(0);
	});

	it("warns about unknown shortcode keys", () => {
		const findings = validateSchemaDefinitionStructure({
			shortcodes: {
				myShortcode: {
					description: "A shortcode.",
					unknownKey: true,
				},
			},
		});
		expect(findings.some((f) => f.code === "unknown-shortcode-property")).toBe(true);
	});

	it("reports non-array arguments", () => {
		const findings = validateSchemaDefinitionStructure({
			shortcodes: {
				myShortcode: {
					arguments: "not an array",
				},
			},
		});
		expect(findings.some((f) => f.code === "invalid-shortcode-arguments")).toBe(true);
	});

	it("reports missing argument name", () => {
		const findings = validateSchemaDefinitionStructure({
			shortcodes: {
				myShortcode: {
					arguments: [{ type: "string" }],
				},
			},
		});
		expect(findings.some((f) => f.code === "missing-shortcode-argument-name")).toBe(true);
	});

	it("reports non-object shortcode entry", () => {
		const findings = validateSchemaDefinitionStructure({
			shortcodes: {
				myShortcode: "bad",
			},
		});
		expect(findings.some((f) => f.code === "invalid-shortcode-type")).toBe(true);
	});

	it("reports non-object attributes", () => {
		const findings = validateSchemaDefinitionStructure({
			shortcodes: {
				myShortcode: {
					attributes: "not an object",
				},
			},
		});
		expect(findings.some((f) => f.code === "invalid-shortcode-attributes")).toBe(true);
	});
});

describe("semantic checks", () => {
	it("reports min > max", () => {
		const findings = validateSchemaDefinitionStructure({
			options: { f: { type: "number", min: 10, max: 5 } },
		});
		expect(findings.some((f) => f.code === "min-greater-than-max")).toBe(true);
	});

	it("accepts min <= max", () => {
		const findings = validateSchemaDefinitionStructure({
			options: { f: { type: "number", min: 5, max: 10 } },
		});
		expect(findings.filter((f) => f.code === "min-greater-than-max")).toHaveLength(0);
	});

	it("reports min > max with JSON Schema aliases (minimum/maximum)", () => {
		const findings = validateSchemaDefinitionStructure({
			options: { f: { type: "number", minimum: 10, maximum: 5 } },
		});
		expect(findings.some((f) => f.code === "min-greater-than-max")).toBe(true);
	});

	it("reports minLength > maxLength", () => {
		const findings = validateSchemaDefinitionStructure({
			options: { f: { type: "string", minLength: 20, maxLength: 5 } },
		});
		expect(findings.some((f) => f.code === "min-length-greater-than-max-length")).toBe(true);
	});

	it("reports minLength > maxLength with kebab-case", () => {
		const findings = validateSchemaDefinitionStructure({
			options: { f: { type: "string", "min-length": 20, "max-length": 5 } },
		});
		expect(findings.some((f) => f.code === "min-length-greater-than-max-length")).toBe(true);
	});

	it("reports minItems > maxItems", () => {
		const findings = validateSchemaDefinitionStructure({
			options: { f: { type: "array", minItems: 10, maxItems: 2 } },
		});
		expect(findings.some((f) => f.code === "min-items-greater-than-max-items")).toBe(true);
	});

	it("reports minItems > maxItems with kebab-case", () => {
		const findings = validateSchemaDefinitionStructure({
			options: { f: { type: "array", "min-items": 10, "max-items": 2 } },
		});
		expect(findings.some((f) => f.code === "min-items-greater-than-max-items")).toBe(true);
	});

	it("reports exclusiveMinimum > exclusiveMaximum", () => {
		const findings = validateSchemaDefinitionStructure({
			options: { f: { type: "number", exclusiveMinimum: 10, exclusiveMaximum: 5 } },
		});
		expect(findings.some((f) => f.code === "exclusive-min-greater-than-exclusive-max")).toBe(true);
	});

	it("reports exclusive-minimum > exclusive-maximum with kebab-case", () => {
		const findings = validateSchemaDefinitionStructure({
			options: { f: { type: "number", "exclusive-minimum": 10, "exclusive-maximum": 5 } },
		});
		expect(findings.some((f) => f.code === "exclusive-min-greater-than-exclusive-max")).toBe(true);
	});

	it("warns when items is defined without array type", () => {
		const findings = validateSchemaDefinitionStructure({
			options: { f: { type: "string", items: { type: "string" } } },
		});
		expect(findings.some((f) => f.code === "items-without-array-type")).toBe(true);
	});

	it("does not warn when items is defined with array type", () => {
		const findings = validateSchemaDefinitionStructure({
			options: { f: { type: "array", items: { type: "string" } } },
		});
		expect(findings.filter((f) => f.code === "items-without-array-type")).toHaveLength(0);
	});

	it("does not warn when items is defined with array in union type", () => {
		const findings = validateSchemaDefinitionStructure({
			options: { f: { type: ["string", "array"], items: { type: "string" } } },
		});
		expect(findings.filter((f) => f.code === "items-without-array-type")).toHaveLength(0);
	});

	it("warns when properties is defined without object type", () => {
		const findings = validateSchemaDefinitionStructure({
			options: { f: { type: "string", properties: { a: { type: "string" } } } },
		});
		expect(findings.some((f) => f.code === "properties-without-object-type")).toBe(true);
	});

	it("does not warn when properties is defined with object type", () => {
		const findings = validateSchemaDefinitionStructure({
			options: { f: { type: "object", properties: { a: { type: "string" } } } },
		});
		expect(findings.filter((f) => f.code === "properties-without-object-type")).toHaveLength(0);
	});

	it("warns when both enum and const are defined", () => {
		const findings = validateSchemaDefinitionStructure({
			options: { f: { type: "string", enum: ["a", "b"], const: "a" } },
		});
		expect(findings.some((f) => f.code === "enum-and-const")).toBe(true);
	});

	it("warns when enum is empty", () => {
		const findings = validateSchemaDefinitionStructure({
			options: { f: { type: "string", enum: [] } },
		});
		expect(findings.some((f) => f.code === "empty-enum")).toBe(true);
	});

	it("reports invalid pattern regex", () => {
		const findings = validateSchemaDefinitionStructure({
			options: { f: { type: "string", pattern: "[invalid" } },
		});
		expect(findings.some((f) => f.code === "invalid-pattern")).toBe(true);
	});

	it("accepts valid pattern regex", () => {
		const findings = validateSchemaDefinitionStructure({
			options: { f: { type: "string", pattern: "^[a-z]+$" } },
		});
		expect(findings.filter((f) => f.code === "invalid-pattern")).toHaveLength(0);
	});
});

describe("validateSchemaDefinition integration", () => {
	it("returns no findings for a valid YAML schema", () => {
		const yamlContent = [
			"$schema: https://example.com/schema.json",
			"options:",
			"  title:",
			"    type: string",
			"    description: The document title.",
			"    required: true",
			"  count:",
			"    type: integer",
			"    min: 0",
			"    max: 100",
			"  tags:",
			"    type: array",
			"    items:",
			"      type: string",
			"      min-length: 1",
			"formats:",
			"  html:",
			"    colour:",
			"      type: string",
			"      pattern: \"^#[0-9a-fA-F]{6}$\"",
			"shortcodes:",
			"  mysc:",
			"    description: A shortcode.",
			"    arguments:",
			"      - name: arg1",
			"        type: string",
			"    attributes:",
			"      flag:",
			"        type: boolean",
		].join("\n");

		const findings = validateSchemaDefinition(yamlContent, "yaml");
		expect(findings).toHaveLength(0);
	});

	it("returns no findings for a valid JSON schema", () => {
		const jsonContent = JSON.stringify({
			$schema: "https://example.com/schema.json",
			options: {
				title: {
					type: "string",
					description: "The title.",
				},
			},
			shortcodes: {
				mysc: {
					description: "A shortcode.",
					arguments: [{ name: "arg1", type: "string" }],
				},
			},
		});

		const findings = validateSchemaDefinition(jsonContent, "json");
		expect(findings).toHaveLength(0);
	});

	it("catches syntax errors in YAML", () => {
		const findings = validateSchemaDefinition("foo:\n  bar: [\n", "yaml");
		expect(findings.length).toBeGreaterThan(0);
		expect(findings[0].code).toBe("syntax-error");
	});

	it("catches syntax errors in JSON", () => {
		const findings = validateSchemaDefinition("{invalid json}", "json");
		expect(findings.length).toBeGreaterThan(0);
		expect(findings[0].code).toBe("syntax-error");
	});

	it("returns no findings for empty content", () => {
		const findings = validateSchemaDefinition("", "yaml");
		expect(findings).toHaveLength(0);
	});

	it("catches multiple structural issues at once", () => {
		const findings = validateSchemaDefinition(
			JSON.stringify({
				badKey: true,
				options: {
					f: {
						type: "notreal",
						min: 10,
						max: 5,
						enum: [],
					},
				},
			}),
			"json",
		);
		expect(findings.length).toBeGreaterThan(2);
	});
});
