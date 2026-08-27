import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { ALLOWED_FIELD_PROPERTIES_V2 } from "../../src/validation/schema-derived.js";
import { validateSchemaDefinitionStructure } from "../../src/validation/schema-definition.js";
import { SCHEMA_V2_VERSION_URI } from "../../src/types/schema.js";
import { parseKeywordTable, metaSchemaProperties } from "../helpers/schemaVocabulary.js";

const validationDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "validation");

const luaSource = readFileSync(join(validationDir, "schema.lua"), "utf-8");
const metaSchema = JSON.parse(readFileSync(join(validationDir, "extension-schema-v2.json"), "utf-8"));

describe("keyword parity", () => {
	const entries = parseKeywordTable(luaSource);
	const inModule = new Set(entries.keys());
	const inMetaSchema = new Set<string>(metaSchemaProperties(metaSchema));

	it("every keyword the module names is in the meta-schema", () => {
		expect([...inModule].filter((name) => !inMetaSchema.has(name))).toEqual([]);
	});

	it("every meta-schema property is named by the module", () => {
		expect([...inMetaSchema].filter((name) => !inModule.has(name))).toEqual([]);
	});

	// The split is the reason that this test exists, because the meta-schema
	// cannot record which keywords the module acts on. A reformat that hides
	// an entry now changes a count and fails here.
	it("holds 25 acted-on keywords and 7 annotations", () => {
		expect([...entries.values()].filter((acted) => acted)).toHaveLength(25);
		expect([...entries.values()].filter((acted) => !acted)).toHaveLength(7);
	});
});

describe("derived vocabulary", () => {
	// ALLOWED_FIELD_PROPERTIES_V2 does not reach the completion provider: that
	// provider imports ALLOWED_FIELD_PROPERTIES and fieldDescriptorMetadata,
	// both derived from the v1 meta-schema. ALLOWED_FIELD_PROPERTIES_V2 is
	// consumed only by allowedSetsFor(), which feeds the v2 schema diagnostics.
	// So carrying uniqueItems here does not add it to autocomplete; it stops
	// the "unknown property" diagnostic from firing on a v2 schema that uses it.
	it("stops uniqueItems from being flagged as an unknown property in a v2 schema", () => {
		expect(ALLOWED_FIELD_PROPERTIES_V2.has("uniqueItems")).toBe(true);

		const findings = validateSchemaDefinitionStructure({
			$schema: SCHEMA_V2_VERSION_URI,
			options: {
				myField: {
					type: "array",
					items: { type: "string" },
					uniqueItems: true,
				},
			},
		});
		expect(findings.filter((f) => f.code === "unknown-field-property")).toHaveLength(0);

		// Control: the same call reports a property the vocabulary does not hold,
		// so the assertion above cannot pass on an empty finding list alone.
		const control = validateSchemaDefinitionStructure({
			$schema: SCHEMA_V2_VERSION_URI,
			options: {
				myField: {
					type: "array",
					items: { type: "string" },
					uniqueItems: true,
					notAKeyword: true,
				},
			},
		});
		const unknown = control.filter((f) => f.code === "unknown-field-property");
		expect(unknown).toHaveLength(1);
		expect(unknown[0].message).toContain("notAKeyword");
	});
});
