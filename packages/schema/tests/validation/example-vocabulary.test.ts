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

type Descriptor = Record<string, unknown>;

function asRecord(value: unknown): Descriptor | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Descriptor) : undefined;
}

/**
 * The keys of one field descriptor, and of every descriptor nested in it.
 *
 * The walk goes down through `properties`, `items` and `additionalProperties`
 * only, because those three hold a descriptor. It does not go down through
 * `completion`, `deprecated` or `dependentRequired`, whose own keys belong to
 * another vocabulary.
 */
function descriptorKeys(value: unknown, found: Set<string>): Set<string> {
	const descriptor = asRecord(value);
	if (descriptor === undefined) {
		return found;
	}
	for (const [key, nested] of Object.entries(descriptor)) {
		found.add(key);
		if (key === "items" || key === "additionalProperties") {
			descriptorKeys(nested, found);
		} else if (key === "properties") {
			for (const property of Object.values(asRecord(nested) ?? {})) {
				descriptorKeys(property, found);
			}
		}
	}
	return found;
}

/**
 * Every keyword that an example file uses, read from descriptor positions only.
 *
 * A walk over all keys at all depths is wrong here. It reads an option name, a
 * shortcode name and an attribute name as a keyword, so an example that names
 * an option `title` covers the `title` keyword without using it. The test then
 * passes after the last real use of that keyword is deleted, which is the drift
 * that it exists to catch.
 */
function vocabularyKeys(document: unknown): Set<string> {
	const found = new Set<string>();
	const root = asRecord(document) ?? {};
	const descriptorMap = (value: unknown) => {
		for (const descriptor of Object.values(asRecord(value) ?? {})) {
			descriptorKeys(descriptor, found);
		}
	};
	descriptorMap(root.options);
	for (const shortcode of Object.values(asRecord(root.shortcodes) ?? {})) {
		const entry = asRecord(shortcode) ?? {};
		for (const argument of Array.isArray(entry.arguments) ? entry.arguments : []) {
			descriptorKeys(argument, found);
		}
		descriptorMap(entry.attributes);
	}
	for (const format of Object.values(asRecord(root.formats) ?? {})) {
		descriptorMap(format);
	}
	for (const group of Object.values(asRecord(root.attributes) ?? {})) {
		descriptorMap(group);
	}
	return found;
}

describe.each(versions)("$name example files show the whole vocabulary", ({ metaSchema, dir }) => {
	const properties = metaSchemaProperties(JSON.parse(readFileSync(join(validationDir, metaSchema), "utf-8")));
	const groups = keywordGroups(properties);

	const examples = [
		{
			format: "yaml",
			keys: vocabularyKeys(yaml.load(readFileSync(join(docsBase, dir, "extension-schema-example.yml"), "utf-8"))),
		},
		{
			format: "json",
			keys: vocabularyKeys(JSON.parse(readFileSync(join(docsBase, dir, "extension-schema-example.json"), "utf-8"))),
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
