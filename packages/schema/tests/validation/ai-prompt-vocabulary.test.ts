import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { metaSchemaProperties } from "../helpers/schemaVocabulary.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const repoRoot = join(pkgRoot, "..", "..");
const page = readFileSync(join(repoRoot, "docs", "reference", "schema-specification.qmd"), "utf-8");
const metaSchema: unknown = JSON.parse(
	readFileSync(join(pkgRoot, "src", "validation", "extension-schema-v2.json"), "utf-8"),
);

// The prompt tells the author to declare the v2 meta-schema, and
// `$defs.fieldDescriptor` sets `additionalProperties: false`, so a property
// that the prompt names and the vocabulary does not hold is an error in every
// schema that a reader writes from it. Correcting the prose alone leaves the
// next edit free to reintroduce a v1 spelling.
const PROMPT_BLOCK = /```\{\.markdown filename="Prompt for generating[^"]*"\}\n([\s\S]*?)\n```/;

// The prompt lists each property as a bullet whose head is the name in
// backticks, and a pair of bounds shares one bullet, as in
// "- `minLength` / `maxLength`: string length constraints.". The head stops at
// the colon, because the description that follows names values and not
// properties.
const BULLET_HEAD = /^- ((?:`[A-Za-z][A-Za-z0-9-]*`(?: \/ )?)+):/gm;

/** Every property name that the AI prompt teaches. */
function promptPropertyNames(): string[] {
	const block = PROMPT_BLOCK.exec(page);
	expect(block, "AI prompt code block not found in schema-specification.qmd").not.toBeNull();
	const named = [...block![1].matchAll(BULLET_HEAD)].flatMap((head) =>
		[...head[1].matchAll(/`([^`]+)`/g)].map((name) => name[1]),
	);
	expect(named.length, "no property bullets parsed from the prompt").toBeGreaterThan(0);
	return [...new Set(named)];
}

describe("AI prompt vocabulary", () => {
	it("names only properties that the v2 meta-schema holds", () => {
		const allowed = new Set(metaSchemaProperties(metaSchema));
		expect(promptPropertyNames().filter((name) => !allowed.has(name))).toEqual([]);
	});

	it("does not tell the author to use kebab-case", () => {
		expect(page).not.toMatch(/Use kebab-case for multi-word property names/);
	});
});
