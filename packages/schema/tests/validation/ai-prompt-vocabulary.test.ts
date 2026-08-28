import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { metaSchemaProperties, metaSchemaVocabulary } from "../helpers/schemaVocabulary.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const repoRoot = join(pkgRoot, "..", "..");
const validationDir = join(pkgRoot, "src", "validation");
// Every pattern below anchors on a line feed, and a Windows checkout holds a
// carriage return before each one, so the page is normalised on read.
const page = readFileSync(join(repoRoot, "docs", "reference", "schema-specification.qmd"), "utf-8").replace(
	/\r\n/g,
	"\n",
);

/** A meta-schema, read from the directory that publishes it. */
function readMetaSchema(file: string): unknown {
	return JSON.parse(readFileSync(join(validationDir, file), "utf-8"));
}

const metaSchema = readMetaSchema("extension-schema-v2.json");

/**
 * Every spelling that v1 holds and v2 does not.
 *
 * The prompt names a key of the structured `deprecated` value as well as a
 * field descriptor property, so the whole vocabulary of each version is read. A
 * name here is one that the v2 meta-schema rejects, and the prompt must not
 * teach it.
 */
const canonical = new Set(metaSchemaVocabulary(metaSchema));
const superseded = new Set(
	metaSchemaVocabulary(readMetaSchema("extension-schema.json")).filter((name) => !canonical.has(name)),
);

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
const PROPERTY_BULLET = /^- (`[^`]+`(?: \/ `[^`]+`)*):([\s\S]*?)(?=\n- `|\n\n)/gm;

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

/** Every property name that the head of a bullet declares. */
function namedProperties(): string[] {
	return propertyBullets().flatMap((bullet) => backtickedNames(bullet.head));
}

describe("AI prompt vocabulary", () => {
	it("names only properties that the v2 meta-schema holds", () => {
		const allowed = new Set(metaSchemaProperties(metaSchema));
		expect(namedProperties().filter((name) => !allowed.has(name))).toEqual([]);
	});

	// The other direction, and the one that a reformat breaks. A bullet head
	// written in a shape that `PROPERTY_BULLET` does not match drops out of the
	// list in silence, and the check above then passes over a short baseline.
	// This check fails instead, because the dropped name is no longer covered.
	it("names every property of the v2 vocabulary", () => {
		const named = new Set(namedProperties());
		expect(metaSchemaProperties(metaSchema).filter((name) => !named.has(name))).toEqual([]);
	});

	// A description names a key as well, as in "an object with `since`,
	// `message`, and `replaceWith` keys". The head alone therefore leaves a v1
	// spelling free to survive inside a description.
	it("teaches no spelling that v2 supersedes", () => {
		const taught = propertyBullets().flatMap((bullet) => backtickedNames(bullet.description));
		expect(taught.filter((name) => superseded.has(name))).toEqual([]);
	});

	// The closing instruction is prose and not a bullet, so no check above
	// reaches it. It is also where the v1 rule was stated.
	it("does not tell the author to use kebab-case", () => {
		expect(promptBlock()).not.toContain("Use kebab-case for multi-word property names");
	});
});
