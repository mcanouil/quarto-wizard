import { describe, it, expect } from "vitest";
import {
	ALLOWED_TOP_LEVEL_KEYS,
	ALLOWED_FIELD_PROPERTIES,
	ALLOWED_TYPES,
	ALLOWED_SHORTCODE_KEYS,
	ALLOWED_TOP_LEVEL_KEYS_V2,
	ALLOWED_FIELD_PROPERTIES_V2,
	ALLOWED_SHORTCODE_KEYS_V2,
	allowedSetsFor,
	fieldDescriptorMetadata,
	shortcodeEntryMetadata,
	rootKeyMetadata,
	SCHEMA_META_SCHEMA,
	SCHEMA_META_SCHEMA_V2,
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
			"attributes",
			"classes",
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
			"title",
			"examples",
			"format",
			"multipleOf",
			"multiple-of",
			"additionalProperties",
			"additional-properties",
			"propertyNames",
			"property-names",
			"dependentRequired",
			"dependent-required",
			"contentEncoding",
			"content-encoding",
			"contentMediaType",
			"content-media-type",
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
		const expected = new Set(["string", "number", "integer", "boolean", "array", "object", "null", "content"]);
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

	it("yamlHidden contains every camelCase variant whose canonical form is kebab-case in YAML", () => {
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
			"multipleOf",
			"additionalProperties",
			"propertyNames",
			"dependentRequired",
			"contentEncoding",
			"contentMediaType",
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

describe("v2 derived constants", () => {
	it("v2 meta-schema is loaded", () => {
		expect(SCHEMA_META_SCHEMA_V2.$id).toBe(
			"https://m.canouil.dev/quarto-wizard/assets/schema/v2/extension-schema.json",
		);
	});

	it("v2 top-level keys match v1 (same sections, version differs in $defs)", () => {
		expect(ALLOWED_TOP_LEVEL_KEYS_V2).toEqual(ALLOWED_TOP_LEVEL_KEYS);
	});

	it("v2 field properties drop kebab-case forms", () => {
		for (const kebab of ["min-length", "max-length", "min-items", "max-items", "exclusive-minimum", "pattern-exact"]) {
			expect(ALLOWED_FIELD_PROPERTIES_V2.has(kebab), `v2 should not list ${kebab}`).toBe(false);
		}
		for (const camel of ["minLength", "maxLength", "minItems", "maxItems", "exclusiveMinimum", "minimum", "maximum"]) {
			expect(ALLOWED_FIELD_PROPERTIES_V2.has(camel), `v2 should list ${camel}`).toBe(true);
		}
	});

	it("v2 field properties drop pattern-exact entirely", () => {
		expect(ALLOWED_FIELD_PROPERTIES_V2.has("pattern-exact")).toBe(false);
		expect(ALLOWED_FIELD_PROPERTIES_V2.has("patternExact")).toBe(false);
	});

	it("v2 shortcode entry adds the parent-level required keyword", () => {
		expect(ALLOWED_SHORTCODE_KEYS_V2.has("required")).toBe(true);
	});

	it("allowedSetsFor returns the correct set per version", () => {
		expect(allowedSetsFor("v1").fieldDescriptor).toBe(ALLOWED_FIELD_PROPERTIES);
		expect(allowedSetsFor("v2").fieldDescriptor).toBe(ALLOWED_FIELD_PROPERTIES_V2);
	});
});

describe("rootKeyMetadata", () => {
	it("yamlHidden is empty", () => {
		expect(rootKeyMetadata.yamlHidden.size).toBe(0);
	});

	it("propertyDocs has entries for root keys", () => {
		expect(rootKeyMetadata.propertyDocs["options"]).toBeDefined();
		expect(rootKeyMetadata.propertyDocs["shortcodes"]).toBeDefined();
		expect(rootKeyMetadata.propertyDocs["formats"]).toBeDefined();
		expect(rootKeyMetadata.propertyDocs["attributes"]).toBeDefined();
		expect(rootKeyMetadata.propertyDocs["classes"]).toBeDefined();
	});
});
