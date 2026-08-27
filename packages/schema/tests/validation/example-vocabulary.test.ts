import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import * as yaml from "js-yaml";
import { validateSchemaDefinitionStructure } from "../../src/validation/schema-definition.js";
import { metaSchemaProperties, keywordGroups } from "../helpers/schemaVocabulary.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const validationDir = join(pkgRoot, "src", "validation");
const docsBase = join(pkgRoot, "..", "..", "docs", "assets", "schema");

// The example files are written by hand. Nothing copies them, so nothing held
// them to the vocabulary that they claim to show. A keyword added to a
// meta-schema could reach the published site while the example stayed behind,
// which is how `uniqueItems` was missed.
const versions = [
	{ name: "v1", metaSchema: "extension-schema.json" },
	{ name: "v2", metaSchema: "extension-schema-v2.json" },
];

const formats = [
	{ format: "yaml", extension: "yml", parse: (text: string): unknown => yaml.load(text) },
	{ format: "json", extension: "json", parse: (text: string): unknown => JSON.parse(text) },
];

/** The value as a plain object, or an empty one when it is not a plain object. */
function asRecord(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Every key that a nested descriptor holds. v1 spells one of these in kebab-case. */
const NESTED_DESCRIPTOR_KEYS = new Set(["items", "additionalProperties", "additional-properties"]);

/**
 * Add the keys of one field descriptor, and of every descriptor nested in it.
 *
 * The walk goes down through the keys that hold a descriptor. It does not go
 * down through `completion`, `deprecated` or `dependentRequired`, whose own
 * keys belong to another vocabulary.
 */
function descriptorKeys(value: unknown, found: Set<string>): void {
	for (const [key, nested] of Object.entries(asRecord(value))) {
		found.add(key);
		if (NESTED_DESCRIPTOR_KEYS.has(key)) {
			descriptorKeys(nested, found);
		} else if (key === "properties") {
			descriptorMap(nested, found);
		}
	}
}

/** Add the keys of every descriptor in a map of name to descriptor. */
function descriptorMap(value: unknown, found: Set<string>): void {
	for (const descriptor of Object.values(asRecord(value))) {
		descriptorKeys(descriptor, found);
	}
}

/**
 * Every keyword that an example file uses, read from descriptor positions only.
 *
 * A walk over all keys at all depths is wrong here. It reads an option name, a
 * shortcode name and an attribute name as a keyword, so an example that names
 * an option `title` covers the `title` keyword without using it. The test then
 * passes after the last real use of that keyword is deleted, which is the drift
 * that it exists to catch.
 *
 * `validateSchemaDefinitionStructure` in `src/validation/schema-definition.ts`
 * walks the same sections. A section added there has to be added here as well.
 */
function vocabularyKeys(document: unknown): Set<string> {
	const found = new Set<string>();
	const root = asRecord(document);
	descriptorMap(root.options, found);
	for (const shortcode of Object.values(asRecord(root.shortcodes))) {
		const entry = asRecord(shortcode);
		for (const argument of Array.isArray(entry.arguments) ? entry.arguments : []) {
			descriptorKeys(argument, found);
		}
		descriptorMap(entry.attributes, found);
	}
	for (const container of [root.formats, root.attributes]) {
		for (const group of Object.values(asRecord(container))) {
			descriptorMap(group, found);
		}
	}
	return found;
}

describe.each(versions)("$name example files show the whole vocabulary", ({ name, metaSchema }) => {
	const groups = keywordGroups(
		metaSchemaProperties(JSON.parse(readFileSync(join(validationDir, metaSchema), "utf-8"))),
	);

	it.each(formats)("the $format example shows one spelling of every keyword", ({ extension, parse }) => {
		const source = readFileSync(join(docsBase, name, `extension-schema-example.${extension}`), "utf-8");
		const keys = vocabularyKeys(parse(source));
		// One spelling is enough. v1 YAML uses kebab-case and v1 JSON uses
		// camelCase, by the stated design of those files.
		const uncovered = [...groups.values()]
			.filter((spellings) => !spellings.some((spelling) => keys.has(spelling)))
			.map((spellings) => spellings.join(" or "));
		expect(uncovered).toEqual([]);
	});

	// Coverage alone lets an example gain an illegal key, or a v1 spelling in a
	// v2 file, and stay green. The validator reads the `$schema` of the file, so
	// it holds each example to the vocabulary of its own version.
	it.each(formats)("the $format example is valid against its meta-schema", ({ extension, parse }) => {
		const source = readFileSync(join(docsBase, name, `extension-schema-example.${extension}`), "utf-8");
		expect(validateSchemaDefinitionStructure(parse(source))).toEqual([]);
	});
});
