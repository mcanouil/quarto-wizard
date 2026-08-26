import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { ALLOWED_FIELD_PROPERTIES_V2 } from "../../src/validation/schema-derived.js";

const validationDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "validation");

const luaSource = readFileSync(join(validationDir, "schema.lua"), "utf-8");
const metaSchema = JSON.parse(readFileSync(join(validationDir, "extension-schema-v2.json"), "utf-8"));

// The module keeps its own keyword table because the `true`/`false` value marks
// whether it acts on the keyword, which the meta-schema does not record. The
// names have to agree, so they are compared rather than generated.
function moduleKeywords(): Set<string> {
	const block = /^M\.KEYWORDS\s*=\s*\{([\s\S]*?)^\}/m.exec(luaSource);
	expect(block, "M.KEYWORDS table not found in schema.lua").not.toBeNull();
	const names = [...block![1].matchAll(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*=\s*(?:true|false)\s*,/gm)];
	expect(names.length, "no keyword entries parsed from M.KEYWORDS").toBeGreaterThan(0);
	return new Set(names.map((match) => match[1]));
}

describe("keyword parity", () => {
	const inModule = moduleKeywords();
	const inMetaSchema = new Set<string>(Object.keys(metaSchema.$defs.fieldDescriptor.properties));

	it("every keyword the module names is in the meta-schema", () => {
		expect([...inModule].filter((name) => !inMetaSchema.has(name))).toEqual([]);
	});

	it("every meta-schema property is named by the module", () => {
		expect([...inMetaSchema].filter((name) => !inModule.has(name))).toEqual([]);
	});
});

describe("derived vocabulary", () => {
	it("carries uniqueItems to the editor", () => {
		expect(ALLOWED_FIELD_PROPERTIES_V2.has("uniqueItems")).toBe(true);
	});
});
