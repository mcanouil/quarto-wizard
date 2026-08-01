import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { QUARTOIGNORE_FILENAME, readQuartoIgnore, isQuartoIgnored } from "../src/filesystem/quartoignore.js";

describe("quartoignore.ts", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quartoignore-test-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	function writeIgnore(content: string): void {
		fs.writeFileSync(path.join(tempDir, QUARTOIGNORE_FILENAME), content, "utf8");
	}

	describe("readQuartoIgnore", () => {
		it("returns an empty array when the file is absent", () => {
			expect(readQuartoIgnore(tempDir)).toEqual([]);
		});

		it("returns an empty array when the directory does not exist", () => {
			expect(readQuartoIgnore(path.join(tempDir, "missing"))).toEqual([]);
		});

		it("skips comments and blank lines and trims whitespace", () => {
			writeIgnore("# a comment\n\n  docs  \n\t\n#another\n_site\n");

			expect(readQuartoIgnore(tempDir)).toEqual(["docs", "_site"]);
		});

		it("normalises leading and trailing separators", () => {
			writeIgnore("docs/\n/build\n./scratch\n");

			expect(readQuartoIgnore(tempDir)).toEqual(["docs", "build", "scratch"]);
		});

		it("drops negation lines, which Quarto does not support", () => {
			writeIgnore("docs\n!docs/keep\n");

			expect(readQuartoIgnore(tempDir)).toEqual(["docs"]);
		});

		it("drops lines that normalise to nothing", () => {
			writeIgnore("/\n./\n   \n");

			expect(readQuartoIgnore(tempDir)).toEqual([]);
		});
	});

	describe("isQuartoIgnored", () => {
		it("returns false when there are no patterns", () => {
			expect(isQuartoIgnored([], "docs")).toBe(false);
		});

		it("returns false for an empty path", () => {
			expect(isQuartoIgnored(["docs"], "")).toBe(false);
		});

		it("matches an exact path", () => {
			expect(isQuartoIgnored(["docs"], "docs")).toBe(true);
		});

		it("matches a descendant of an ignored directory", () => {
			expect(isQuartoIgnored(["docs"], "docs/site/nested")).toBe(true);
		});

		it("does not match a sibling with a shared prefix", () => {
			expect(isQuartoIgnored(["docs"], "docs-site")).toBe(false);
		});

		it("matches a separator-free pattern at any depth", () => {
			expect(isQuartoIgnored(["_site"], "docs/_site")).toBe(true);
		});

		it("anchors a pattern containing a separator to the root", () => {
			expect(isQuartoIgnored(["docs/_site"], "docs/_site")).toBe(true);
			expect(isQuartoIgnored(["docs/_site"], "nested/docs/_site")).toBe(false);
		});

		it("supports glob patterns", () => {
			expect(isQuartoIgnored(["site-*"], "site-a")).toBe(true);
			expect(isQuartoIgnored(["site-*"], "site")).toBe(false);
		});

		it("matches dot directories", () => {
			expect(isQuartoIgnored([".scratch"], ".scratch/project")).toBe(true);
		});

		it("returns false when nothing matches", () => {
			expect(isQuartoIgnored(["docs", "_site"], "paper")).toBe(false);
		});
	});
});
