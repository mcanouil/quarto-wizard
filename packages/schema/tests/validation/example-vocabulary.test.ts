import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import * as yaml from "js-yaml";
import { metaSchemaProperties, keywordGroups } from "../helpers/schemaVocabulary.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const validationDir = join(pkgRoot, "src", "validation");
const docsBase = join(pkgRoot, "..", "..", "docs", "assets", "schema");

// The example files are written by hand. Nothing copies them, so nothing held
// them to the vocabulary that they claim to show. A keyword added to a
// meta-schema could reach the published site while the example stayed behind,
// which is how `uniqueItems` was missed.
const versions = [
	{ name: "v1", metaSchema: "extension-schema.json", dir: "v1" },
	{ name: "v2", metaSchema: "extension-schema-v2.json", dir: "v2" },
];

/** Every key of a parsed document, at any depth. */
function collectKeys(value: unknown, found: Set<string> = new Set()): Set<string> {
	if (Array.isArray(value)) {
		for (const element of value) {
			collectKeys(element, found);
		}
	} else if (value !== null && typeof value === "object") {
		for (const [key, nested] of Object.entries(value)) {
			found.add(key);
			collectKeys(nested, found);
		}
	}
	return found;
}

describe.each(versions)("$name example files show the whole vocabulary", ({ metaSchema, dir }) => {
	const properties = metaSchemaProperties(JSON.parse(readFileSync(join(validationDir, metaSchema), "utf-8")));
	const groups = keywordGroups(properties);

	// A key walk, and not a text search. A text search for `type` matches inside
	// `contentMediaType`, so the test would pass on a wrong result.
	const examples = [
		{
			format: "yaml",
			keys: collectKeys(yaml.load(readFileSync(join(docsBase, dir, "extension-schema-example.yml"), "utf-8"))),
		},
		{
			format: "json",
			keys: collectKeys(JSON.parse(readFileSync(join(docsBase, dir, "extension-schema-example.json"), "utf-8"))),
		},
	];

	it.each(examples)("the $format example shows one spelling of every keyword", ({ keys }) => {
		// One spelling is enough. v1 YAML uses kebab-case and v1 JSON uses
		// camelCase, by the stated design of those files.
		const uncovered = [...groups.values()]
			.filter((spellings) => !spellings.some((spelling) => keys.has(spelling)))
			.map((spellings) => spellings.join(" or "));
		expect(uncovered).toEqual([]);
	});
});
