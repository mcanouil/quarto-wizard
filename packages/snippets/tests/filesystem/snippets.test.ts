import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { findSnippetFile, parseSnippetContent, parseSnippetFile, readSnippets } from "../../src/filesystem/snippets.js";
import { SnippetCache } from "../../src/filesystem/snippet-cache.js";
import { SnippetError } from "../../src/errors.js";

describe("parseSnippetContent", () => {
	it("parses valid JSON with a single snippet", () => {
		const json = JSON.stringify({
			"My Snippet": {
				prefix: "mysnip",
				body: "Hello ${1:world}",
				description: "A test snippet",
			},
		});

		const result = parseSnippetContent(json);
		expect(Object.keys(result)).toHaveLength(1);
		expect(result["My Snippet"]).toBeDefined();
		expect(result["My Snippet"].prefix).toBe("mysnip");
		expect(result["My Snippet"].body).toBe("Hello ${1:world}");
		expect(result["My Snippet"].description).toBe("A test snippet");
	});

	it("parses multiple snippets", () => {
		const json = JSON.stringify({
			First: { prefix: "a", body: "alpha" },
			Second: { prefix: "b", body: "beta" },
		});

		const result = parseSnippetContent(json);
		expect(Object.keys(result)).toHaveLength(2);
	});

	it("handles prefix as array", () => {
		const json = JSON.stringify({
			Multi: { prefix: ["pr", "pull"], body: "pull request" },
		});

		const result = parseSnippetContent(json);
		expect(result["Multi"].prefix).toEqual(["pr", "pull"]);
	});

	it("handles body as array", () => {
		const json = JSON.stringify({
			Block: { prefix: "block", body: ["line 1", "line 2", "line 3"] },
		});

		const result = parseSnippetContent(json);
		expect(result["Block"].body).toEqual(["line 1", "line 2", "line 3"]);
	});

	it("handles body array with blank lines", () => {
		const json = JSON.stringify({
			Block: { prefix: "block", body: ["line 1", "", "line 3"] },
		});

		const result = parseSnippetContent(json);
		expect(result["Block"].body).toEqual(["line 1", "", "line 3"]);
	});

	it("skips entries with empty prefix array", () => {
		const json = JSON.stringify({
			Valid: { prefix: "ok", body: "good" },
			Invalid: { prefix: [], body: "bad" },
		});

		const result = parseSnippetContent(json);
		expect(Object.keys(result)).toHaveLength(1);
		expect(result["Valid"]).toBeDefined();
		expect(result["Invalid"]).toBeUndefined();
	});

	it("skips entries with non-string prefix array values", () => {
		const json = JSON.stringify({
			Valid: { prefix: "ok", body: "good" },
			Invalid: { prefix: ["good", 42], body: "bad" },
		});

		const result = parseSnippetContent(json);
		expect(Object.keys(result)).toHaveLength(1);
		expect(result["Valid"]).toBeDefined();
		expect(result["Invalid"]).toBeUndefined();
	});

	it("skips entries with empty body array", () => {
		const json = JSON.stringify({
			Valid: { prefix: "ok", body: "good" },
			Invalid: { prefix: "bad", body: [] },
		});

		const result = parseSnippetContent(json);
		expect(Object.keys(result)).toHaveLength(1);
		expect(result["Valid"]).toBeDefined();
		expect(result["Invalid"]).toBeUndefined();
	});

	it("skips entries with non-string body array values", () => {
		const json = JSON.stringify({
			Valid: { prefix: "ok", body: "good" },
			Invalid: { prefix: "bad", body: ["line", { nested: true }] },
		});

		const result = parseSnippetContent(json);
		expect(Object.keys(result)).toHaveLength(1);
		expect(result["Valid"]).toBeDefined();
		expect(result["Invalid"]).toBeUndefined();
	});

	it("skips entries with empty prefix string", () => {
		const json = JSON.stringify({
			Valid: { prefix: "ok", body: "good" },
			Invalid: { prefix: "", body: "bad" },
		});

		const result = parseSnippetContent(json);
		expect(Object.keys(result)).toHaveLength(1);
		expect(result["Valid"]).toBeDefined();
		expect(result["Invalid"]).toBeUndefined();
	});

	it("skips entries with empty body string", () => {
		const json = JSON.stringify({
			Valid: { prefix: "ok", body: "good" },
			Invalid: { prefix: "bad", body: "" },
		});

		const result = parseSnippetContent(json);
		expect(Object.keys(result)).toHaveLength(1);
		expect(result["Valid"]).toBeDefined();
		expect(result["Invalid"]).toBeUndefined();
	});

	it("skips entries with body array containing only empty strings", () => {
		const json = JSON.stringify({
			Valid: { prefix: "ok", body: "good" },
			Invalid: { prefix: "bad", body: ["", ""] },
		});

		const result = parseSnippetContent(json);
		expect(Object.keys(result)).toHaveLength(1);
		expect(result["Valid"]).toBeDefined();
		expect(result["Invalid"]).toBeUndefined();
	});

	it("skips entries missing prefix", () => {
		const json = JSON.stringify({
			Valid: { prefix: "ok", body: "good" },
			Invalid: { body: "no prefix" },
		});

		const result = parseSnippetContent(json);
		expect(Object.keys(result)).toHaveLength(1);
		expect(result["Valid"]).toBeDefined();
		expect(result["Invalid"]).toBeUndefined();
	});

	it("skips entries missing body", () => {
		const json = JSON.stringify({
			Valid: { prefix: "ok", body: "good" },
			Invalid: { prefix: "bad" },
		});

		const result = parseSnippetContent(json);
		expect(Object.keys(result)).toHaveLength(1);
		expect(result["Valid"]).toBeDefined();
	});

	it("skips entries with non-string description", () => {
		const json = JSON.stringify({
			Valid: { prefix: "ok", body: "good", description: "A description" },
			InvalidNum: { prefix: "bad", body: "bad", description: 42 },
			InvalidArr: { prefix: "bad", body: "bad", description: ["array"] },
		});

		const result = parseSnippetContent(json);
		expect(Object.keys(result)).toHaveLength(1);
		expect(result["Valid"]).toBeDefined();
		expect(result["InvalidNum"]).toBeUndefined();
		expect(result["InvalidArr"]).toBeUndefined();
	});

	it("skips non-object entries", () => {
		const json = JSON.stringify({
			Valid: { prefix: "ok", body: "good" },
			Invalid: "not an object",
			AlsoInvalid: 42,
		});

		const result = parseSnippetContent(json);
		expect(Object.keys(result)).toHaveLength(1);
	});

	it("throws SnippetError on invalid JSON", () => {
		expect(() => parseSnippetContent("{bad json")).toThrow(SnippetError);
	});

	it("throws SnippetError on non-object root (array)", () => {
		expect(() => parseSnippetContent("[1, 2, 3]")).toThrow(SnippetError);
		expect(() => parseSnippetContent("[1, 2, 3]")).toThrow("must contain a JSON object");
	});

	it("throws SnippetError on non-object root (string)", () => {
		expect(() => parseSnippetContent('"just a string"')).toThrow(SnippetError);
	});

	it("throws SnippetError on null root", () => {
		expect(() => parseSnippetContent("null")).toThrow(SnippetError);
	});

	it("returns empty collection for empty object", () => {
		const result = parseSnippetContent("{}");
		expect(Object.keys(result)).toHaveLength(0);
	});

	it("includes sourcePath in error when provided", () => {
		try {
			parseSnippetContent("{bad}", "/path/to/_snippets.json");
			expect.fail("Should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(SnippetError);
			expect((error as SnippetError).snippetPath).toBe("/path/to/_snippets.json");
		}
	});
});

describe("findSnippetFile", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "snippet-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("finds _snippets.json when present", () => {
		const snippetPath = path.join(tmpDir, "_snippets.json");
		fs.writeFileSync(snippetPath, "{}");

		const result = findSnippetFile(tmpDir);
		expect(result).toBe(snippetPath);
	});

	it("returns null when no snippet file exists", () => {
		const result = findSnippetFile(tmpDir);
		expect(result).toBeNull();
	});
});

describe("parseSnippetFile", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "snippet-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("reads and parses a snippet file from disk", () => {
		const snippetPath = path.join(tmpDir, "_snippets.json");
		fs.writeFileSync(
			snippetPath,
			JSON.stringify({ Test: { prefix: "test", body: "hello" } }),
		);

		const result = parseSnippetFile(snippetPath);
		expect(result["Test"]).toBeDefined();
		expect(result["Test"].prefix).toBe("test");
	});

	it("throws SnippetError on invalid content", () => {
		const snippetPath = path.join(tmpDir, "_snippets.json");
		fs.writeFileSync(snippetPath, "{invalid}");

		expect(() => parseSnippetFile(snippetPath)).toThrow(SnippetError);
	});

	it("throws SnippetError on non-existent path", () => {
		const snippetPath = path.join(tmpDir, "does-not-exist.json");

		expect(() => parseSnippetFile(snippetPath)).toThrow(SnippetError);
	});
});

describe("readSnippets", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "snippet-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("reads snippets from a directory", () => {
		const snippetPath = path.join(tmpDir, "_snippets.json");
		fs.writeFileSync(
			snippetPath,
			JSON.stringify({ Test: { prefix: "test", body: "hello" } }),
		);

		const result = readSnippets(tmpDir);
		expect(result).not.toBeNull();
		expect(result!.snippets["Test"]).toBeDefined();
		expect(result!.snippetPath).toBe(snippetPath);
	});

	it("returns null when no snippet file exists", () => {
		const result = readSnippets(tmpDir);
		expect(result).toBeNull();
	});

	it("throws SnippetError when snippet file contains invalid JSON", () => {
		fs.writeFileSync(path.join(tmpDir, "_snippets.json"), "{invalid}");

		expect(() => readSnippets(tmpDir)).toThrow(SnippetError);
	});
});

describe("SnippetCache", () => {
	let tmpDir: string;
	let cache: SnippetCache;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "snippet-cache-test-"));
		cache = new SnippetCache();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns null for directory without snippets", () => {
		const result = cache.get(tmpDir);
		expect(result).toBeNull();
	});

	it("caches missing snippet directories until invalidated", () => {
		expect(cache.get(tmpDir)).toBeNull();

		fs.writeFileSync(
			path.join(tmpDir, "_snippets.json"),
			JSON.stringify({ Test: { prefix: "t", body: "test" } }),
		);

		expect(cache.get(tmpDir)).toBeNull();
		cache.invalidate(tmpDir);
		expect(cache.get(tmpDir)).not.toBeNull();
	});

	it("loads and caches snippets on first access", () => {
		fs.writeFileSync(
			path.join(tmpDir, "_snippets.json"),
			JSON.stringify({ Test: { prefix: "t", body: "test" } }),
		);

		const result = cache.get(tmpDir);
		expect(result).not.toBeNull();
		expect(result!["Test"].prefix).toBe("t");
	});

	it("returns cached result on subsequent access (referential identity)", () => {
		fs.writeFileSync(
			path.join(tmpDir, "_snippets.json"),
			JSON.stringify({ Test: { prefix: "t", body: "test" } }),
		);

		const first = cache.get(tmpDir);
		const second = cache.get(tmpDir);
		// Second call should return the exact same object from cache
		expect(second).toBe(first);
	});

	it("has() returns true for cached entries", () => {
		fs.writeFileSync(
			path.join(tmpDir, "_snippets.json"),
			JSON.stringify({ Test: { prefix: "t", body: "test" } }),
		);

		expect(cache.has(tmpDir)).toBe(false);
		cache.get(tmpDir);
		expect(cache.has(tmpDir)).toBe(true);
	});

	it("invalidate() clears a specific entry", () => {
		fs.writeFileSync(
			path.join(tmpDir, "_snippets.json"),
			JSON.stringify({ Test: { prefix: "t", body: "test" } }),
		);

		cache.get(tmpDir);
		expect(cache.has(tmpDir)).toBe(true);

		cache.invalidate(tmpDir);
		expect(cache.has(tmpDir)).toBe(false);
	});

	it("invalidateAll() clears all entries", () => {
		fs.writeFileSync(
			path.join(tmpDir, "_snippets.json"),
			JSON.stringify({ Test: { prefix: "t", body: "test" } }),
		);

		cache.get(tmpDir);
		expect(cache.has(tmpDir)).toBe(true);

		cache.invalidateAll();
		expect(cache.has(tmpDir)).toBe(false);
	});

	it("invalidateAll() clears missing entries", () => {
		// Access a directory without snippets to populate the missing set
		cache.get(tmpDir);
		expect(cache.has(tmpDir)).toBe(false);

		// After invalidateAll and adding a snippet file, get() should read from disk
		cache.invalidateAll();
		fs.writeFileSync(
			path.join(tmpDir, "_snippets.json"),
			JSON.stringify({ Test: { prefix: "t", body: "test" } }),
		);

		const result = cache.get(tmpDir);
		expect(result).not.toBeNull();
		expect(cache.has(tmpDir)).toBe(true);
	});

	it("invalidateAll() clears error entries", () => {
		fs.writeFileSync(path.join(tmpDir, "_snippets.json"), "{invalid}");
		cache.get(tmpDir);
		expect(cache.getError(tmpDir)).not.toBeNull();

		cache.invalidateAll();
		expect(cache.getError(tmpDir)).toBeNull();
	});

	it("stores and retrieves errors", () => {
		fs.writeFileSync(path.join(tmpDir, "_snippets.json"), "{invalid json}");

		const result = cache.get(tmpDir);
		expect(result).toBeNull();

		const error = cache.getError(tmpDir);
		expect(error).not.toBeNull();
		expect(error).toContain("Failed to parse snippet JSON");
	});

	it("getError() returns null when no error occurred", () => {
		expect(cache.getError(tmpDir)).toBeNull();
	});

	it("clears error on successful re-read after invalidation", () => {
		fs.writeFileSync(path.join(tmpDir, "_snippets.json"), "{invalid}");
		cache.get(tmpDir);
		expect(cache.getError(tmpDir)).not.toBeNull();

		cache.invalidate(tmpDir);
		fs.writeFileSync(
			path.join(tmpDir, "_snippets.json"),
			JSON.stringify({ Test: { prefix: "t", body: "test" } }),
		);

		const result = cache.get(tmpDir);
		expect(result).not.toBeNull();
		expect(cache.getError(tmpDir)).toBeNull();
	});
});
