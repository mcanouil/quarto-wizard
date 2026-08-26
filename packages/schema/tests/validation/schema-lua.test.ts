import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const validationDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "validation");

const luaSource = readFileSync(join(validationDir, "schema.lua"), "utf-8");
const metaSchema = JSON.parse(readFileSync(join(validationDir, "extension-schema-v2.json"), "utf-8"));

describe("Lua reference validator", () => {
	it("implements the meta-schema it ships beside", () => {
		const declared = /^M\.SCHEMA_VERSION\s*=\s*'([^']+)'/m.exec(luaSource);
		expect(declared, "M.SCHEMA_VERSION assignment not found in schema.lua").not.toBeNull();
		expect(declared?.[1]).toBe(metaSchema.$id);
	});
});
