import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { readSchemaVersion } from "../helpers/schemaVocabulary.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const validationDir = join(pkgRoot, "src", "validation");
const docsBase = join(pkgRoot, "..", "..", "docs", "assets", "schema");

// The same list `scripts/copy-schemas.mjs` copies from. Every entry is served
// at a stable address that other projects resolve, so a source edit committed
// without a rebuild publishes something the repository no longer contains.
const published = [
	{ src: "extension-schema.json", docs: join("v1", "extension-schema.json") },
	{ src: "extension-schema-v2.json", docs: join("v2", "extension-schema.json") },
	{ src: "schema.lua", docs: join("v2", "schema.lua") },
];

const luaSource = readFileSync(join(validationDir, "schema.lua"), "utf-8");
const metaSchema = JSON.parse(readFileSync(join(validationDir, "extension-schema-v2.json"), "utf-8"));

describe("Lua reference validator", () => {
	it("implements the meta-schema it ships beside", () => {
		const declared = readSchemaVersion(luaSource);
		expect(declared, "M.SCHEMA_VERSION assignment not found in schema.lua").not.toBeNull();
		expect(declared).toBe(metaSchema.$id);
	});
});

describe("published copies", () => {
	it.each(published)("$docs matches $src", ({ src, docs }) => {
		const docsPath = join(docsBase, docs);
		const stale = `run \`npm run build\` in packages/schema to refresh ${docs}`;
		expect(existsSync(docsPath), `${docs} is missing, ${stale}`).toBe(true);
		expect(readFileSync(docsPath, "utf-8"), stale).toBe(readFileSync(join(validationDir, src), "utf-8"));
	});
});
