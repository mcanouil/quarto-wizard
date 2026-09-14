import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { readSchemaVersion, readModuleVersion } from "../helpers/schemaVocabulary.js";

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

	// The stamped version is what an author pins, and the `$id` is what the
	// module implements. A patch or a minor may move the stamp alone, but a
	// new meta-schema major that leaves the stamp behind would publish a
	// `2.x.y` module that implements v3.
	it("stamps a version whose major is the major of the meta-schema", () => {
		const declared = readModuleVersion(luaSource) ?? "";
		expect(declared, "@version tag not found in schema.lua").not.toBe("");
		const segment = /\/v(\d+)\/[^/]+$/.exec(String(metaSchema.$id));
		expect(segment, `no version segment in the $id ${String(metaSchema.$id)}`).not.toBeNull();
		expect(declared.split(".")[0]).toBe(segment?.[1]);
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
