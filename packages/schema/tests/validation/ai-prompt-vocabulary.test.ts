import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { metaSchemaProperties } from "../helpers/schemaVocabulary.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const repoRoot = join(pkgRoot, "..", "..");
const validationDir = join(pkgRoot, "src", "validation");
const page = readFileSync(join(repoRoot, "docs", "reference", "schema-specification.qmd"), "utf-8");

/** A meta-schema, read from the directory that publishes it. */
function readMetaSchema(file: string): unknown {
	return JSON.parse(readFileSync(join(validationDir, file), "utf-8"));
}

const metaSchema = readMetaSchema("extension-schema-v2.json");

// The prompt tells the author to declare the v2 meta-schema, and
// `$defs.fieldDescriptor` sets `additionalProperties: false`, so a property
// that the prompt names and the vocabulary does not hold is an error in every
// schema that a reader writes from it. Correcting the prose alone leaves the
// next edit free to reintroduce a v1 spelling.
const PROMPT_BLOCK = /```\{\.markdown filename="Prompt for generating[^"]*"\}\n([\s\S]*?)\n```/;

// The prompt lists each property as a bullet whose head is the name in
// backticks, and a pair of bounds shares one bullet, as in
// "- `minLength` / `maxLength`: string length constraints.". A bullet runs to
// the next bullet or to the blank line that ends the list, because a
// description can take several lines.
const PROPERTY_BULLET = /^- (`[A-Za-z][A-Za-z0-9-]*`(?: \/ `[A-Za-z][A-Za-z0-9-]*`)*):([\s\S]*?)(?=\n- `|\n\n)/gm;

/** The body of the code block that holds the AI prompt. */
function promptBlock(): string {
	const block = PROMPT_BLOCK.exec(page);
	expect(block, "AI prompt code block not found in schema-specification.qmd").not.toBeNull();
	return block![1];
}

/** Every property bullet of the prompt, as a head and a description. */
function propertyBullets(): { head: string; description: string }[] {
	const bullets = [...promptBlock().matchAll(PROPERTY_BULLET)].map((bullet) => ({
		head: bullet[1],
		description: bullet[2],
	}));
	expect(bullets.length, "no property bullets parsed from the prompt").toBeGreaterThan(0);
	return bullets;
}

/** Every backticked name in a piece of prompt text. */
function backtickedNames(text: string): string[] {
	return [...text.matchAll(/`([^`]+)`/g)].map((name) => name[1]);
}

/**
 * Every spelling that v1 holds and v2 does not.
 *
 * The prompt names a key of the structured `deprecated` value as well as a
 * field descriptor property, so both maps are read. A name here is one that
 * the v2 meta-schema rejects, and the prompt must not teach it.
 */
function supersededSpellings(): Set<string> {
	const properties = (version: unknown): string[] => [
		...metaSchemaProperties(version),
		...Object.keys(
			(version as { $defs: { deprecatedSpec: { properties: Record<string, unknown> } } }).$defs.deprecatedSpec
				.properties,
		),
	];
	const canonical = new Set(properties(metaSchema));
	return new Set(properties(readMetaSchema("extension-schema.json")).filter((name) => !canonical.has(name)));
}

describe("AI prompt vocabulary", () => {
	it("names only properties that the v2 meta-schema holds", () => {
		const allowed = new Set(metaSchemaProperties(metaSchema));
		const named = [...new Set(propertyBullets().flatMap((bullet) => backtickedNames(bullet.head)))];
		expect(named.filter((name) => !allowed.has(name))).toEqual([]);
	});

	// A description names a key as well, as in "an object with `since`,
	// `message`, and `replaceWith` keys". The head alone therefore leaves a v1
	// spelling free to survive inside a description.
	it("teaches no spelling that v2 supersedes", () => {
		const superseded = supersededSpellings();
		const taught = propertyBullets().flatMap((bullet) => backtickedNames(bullet.description));
		expect([...new Set(taught)].filter((name) => superseded.has(name))).toEqual([]);
	});

	it("does not tell the author to use kebab-case", () => {
		expect(page).not.toMatch(/Use kebab-case for multi-word property names/);
	});
});
