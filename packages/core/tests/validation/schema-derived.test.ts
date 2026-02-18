import { describe, it, expect } from "vitest";
import {
	ALLOWED_TOP_LEVEL_KEYS,
	ALLOWED_FIELD_PROPERTIES,
	ALLOWED_TYPES,
	ALLOWED_SHORTCODE_KEYS,
	fieldDescriptorMetadata,
	shortcodeEntryMetadata,
	rootKeyMetadata,
	SCHEMA_META_SCHEMA,
} from "../../src/validation/schema-derived.js";

describe("SCHEMA_META_SCHEMA structure", () => {
	it("has $schema, $id, $defs, properties, and additionalProperties: false", () => {
		expect(SCHEMA_META_SCHEMA.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
		expect(SCHEMA_META_SCHEMA.$id).toContain("extension-schema.json");
		expect(SCHEMA_META_SCHEMA.$defs).toBeDefined();
		expect(SCHEMA_META_SCHEMA.properties).toBeDefined();
		expect(SCHEMA_META_SCHEMA.additionalProperties).toBe(false);
	});
});

describe("ALLOWED_TOP_LEVEL_KEYS", () => {
	it("contains exactly the expected keys", () => {
		const expected = new Set([
			"$schema",
			"options",
			"shortcodes",
			"formats",
			"projects",
			"element-attributes",
			"elementAttributes",
		]);
		expect(ALLOWED_TOP_LEVEL_KEYS).toEqual(expected);
	});
});

describe("ALLOWED_FIELD_PROPERTIES", () => {
	it("contains all expected properties including both kebab-case and camelCase variants", () => {
		const expectedProperties = [
			"type",
			"required",
			"default",
			"description",
			"enum",
			"enumCaseInsensitive",
			"enum-case-insensitive",
			"pattern",
			"patternExact",
			"pattern-exact",
			"min",
			"max",
			"minimum",
			"maximum",
			"exclusiveMinimum",
			"exclusive-minimum",
			"exclusiveMaximum",
			"exclusive-maximum",
			"minLength",
			"min-length",
			"maxLength",
			"max-length",
			"minItems",
			"min-items",
			"maxItems",
			"max-items",
			"const",
			"aliases",
			"deprecated",
			"completion",
			"items",
			"properties",
			"name",
		];
		for (const prop of expectedProperties) {
			expect(ALLOWED_FIELD_PROPERTIES.has(prop), `missing property: ${prop}`).toBe(true);
		}
		expect(ALLOWED_FIELD_PROPERTIES.size).toBe(expectedProperties.length);
	});
});

describe("ALLOWED_TYPES", () => {
	it("contains exactly the expected types", () => {
		const expected = new Set(["string", "number", "integer", "boolean", "array", "object", "content"]);
		expect(ALLOWED_TYPES).toEqual(expected);
	});
});

describe("ALLOWED_SHORTCODE_KEYS", () => {
	it("contains exactly the expected keys", () => {
		const expected = new Set(["description", "arguments", "attributes"]);
		expect(ALLOWED_SHORTCODE_KEYS).toEqual(expected);
	});
});

describe("fieldDescriptorMetadata", () => {
	it("booleanProperties contains expected entries", () => {
		for (const prop of ["required", "deprecated", "enum-case-insensitive", "pattern-exact"]) {
			expect(fieldDescriptorMetadata.booleanProperties.has(prop), `missing boolean: ${prop}`).toBe(true);
		}
	});

	it("nestedProperties contains expected entries", () => {
		for (const prop of ["items", "properties", "completion"]) {
			expect(fieldDescriptorMetadata.nestedProperties.has(prop), `missing nested: ${prop}`).toBe(true);
		}
	});

	it("yamlHidden contains the eight camelCase variants plus minimum and maximum", () => {
		const expectedHidden = [
			"enumCaseInsensitive",
			"patternExact",
			"minLength",
			"maxLength",
			"minItems",
			"maxItems",
			"exclusiveMinimum",
			"exclusiveMaximum",
			"minimum",
			"maximum",
		];
		for (const prop of expectedHidden) {
			expect(fieldDescriptorMetadata.yamlHidden.has(prop), `missing hidden: ${prop}`).toBe(true);
		}
		expect(fieldDescriptorMetadata.yamlHidden.size).toBe(expectedHidden.length);
	});

	it("valueTriggerProperties includes type and all boolean properties", () => {
		expect(fieldDescriptorMetadata.valueTriggerProperties.has("type")).toBe(true);
		for (const prop of fieldDescriptorMetadata.booleanProperties) {
			expect(fieldDescriptorMetadata.valueTriggerProperties.has(prop), `missing trigger: ${prop}`).toBe(true);
		}
	});

	it("propertyDocs has entries for all non-hidden field properties", () => {
		for (const key of ALLOWED_FIELD_PROPERTIES) {
			if (fieldDescriptorMetadata.yamlHidden.has(key)) {
				continue;
			}
			expect(
				fieldDescriptorMetadata.propertyDocs[key],
				`missing doc for visible property: ${key}`,
			).toBeDefined();
		}
	});

	it("snippetOverrides has entries for enum and aliases", () => {
		expect(fieldDescriptorMetadata.snippetOverrides["enum"]).toBeDefined();
		expect(fieldDescriptorMetadata.snippetOverrides["aliases"]).toBeDefined();
	});

	it("shortcodeArgumentOnly contains name", () => {
		expect(fieldDescriptorMetadata.shortcodeArgumentOnly.has("name")).toBe(true);
	});
});

describe("shortcodeEntryMetadata", () => {
	it("propertyDocs has entries for all shortcode entry keys", () => {
		for (const key of ALLOWED_SHORTCODE_KEYS) {
			expect(
				shortcodeEntryMetadata.propertyDocs[key],
				`missing doc for shortcode key: ${key}`,
			).toBeDefined();
		}
	});

	it("nestedProperties contains arguments and attributes", () => {
		expect(shortcodeEntryMetadata.nestedProperties.has("arguments")).toBe(true);
		expect(shortcodeEntryMetadata.nestedProperties.has("attributes")).toBe(true);
	});

	it("snippetOverrides has entries for arguments and attributes", () => {
		expect(shortcodeEntryMetadata.snippetOverrides["arguments"]).toBeDefined();
		expect(shortcodeEntryMetadata.snippetOverrides["attributes"]).toBeDefined();
	});
});

describe("rootKeyMetadata", () => {
	it("yamlHidden contains elementAttributes", () => {
		expect(rootKeyMetadata.yamlHidden.has("elementAttributes")).toBe(true);
	});

	it("yamlHidden does not contain element-attributes", () => {
		expect(rootKeyMetadata.yamlHidden.has("element-attributes")).toBe(false);
	});

	it("propertyDocs has entries for root keys", () => {
		expect(rootKeyMetadata.propertyDocs["options"]).toBeDefined();
		expect(rootKeyMetadata.propertyDocs["shortcodes"]).toBeDefined();
		expect(rootKeyMetadata.propertyDocs["formats"]).toBeDefined();
	});
});
