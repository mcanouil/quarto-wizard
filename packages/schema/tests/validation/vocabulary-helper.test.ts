import { describe, it, expect } from "vitest";
import { parseKeywordTable, readSchemaVersion, keywordGroups } from "../helpers/schemaVocabulary.js";

describe("parseKeywordTable", () => {
	// Each case is a way the previous regular expression stopped matching
	// without failing, so the comparison ran against a short baseline.

	it("reads two entries written on one line", () => {
		const table = "M.KEYWORDS = {\n  alpha = true, beta = false,\n}\n";
		expect([...parseKeywordTable(table).keys()]).toEqual(["alpha", "beta"]);
	});

	it("reads a final entry that has no trailing comma", () => {
		const table = "M.KEYWORDS = {\n  alpha = true,\n  beta = false\n}\n";
		expect([...parseKeywordTable(table).keys()]).toEqual(["alpha", "beta"]);
	});

	it("reads a quoted key", () => {
		const table = 'M.KEYWORDS = {\n  ["alpha-beta"] = true,\n}\n';
		expect([...parseKeywordTable(table).keys()]).toEqual(["alpha-beta"]);
	});

	it("does not count a comment that resembles an entry", () => {
		const table = "M.KEYWORDS = {\n  -- ghost = true,\n  alpha = true,\n}\n";
		expect([...parseKeywordTable(table).keys()]).toEqual(["alpha"]);
	});

	it("keeps the value that marks an acted-on keyword", () => {
		const table = "M.KEYWORDS = {\n  alpha = true,\n  beta = false,\n}\n";
		const entries = parseKeywordTable(table);
		expect(entries.get("alpha")).toBe(true);
		expect(entries.get("beta")).toBe(false);
	});
});

describe("readSchemaVersion", () => {
	it("reads a single-quoted value", () => {
		expect(readSchemaVersion("M.SCHEMA_VERSION = 'https://example.test/v2'")).toBe("https://example.test/v2");
	});

	it("reads a double-quoted value", () => {
		expect(readSchemaVersion('M.SCHEMA_VERSION = "https://example.test/v2"')).toBe("https://example.test/v2");
	});

	it("returns null when the assignment is absent", () => {
		expect(readSchemaVersion("local M = {}")).toBeNull();
	});
});

describe("keywordGroups", () => {
	it("groups the two spellings of one keyword", () => {
		const groups = keywordGroups(["minLength", "min-length", "type"]);
		expect(groups.get("minlength")).toEqual(["minLength", "min-length"]);
		expect(groups.get("type")).toEqual(["type"]);
	});
});
