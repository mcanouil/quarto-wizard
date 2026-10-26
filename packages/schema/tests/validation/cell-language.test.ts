import { describe, expect, it } from "vitest";
import { normaliseCellLanguage } from "../../src/validation/cell-language.js";

describe("normaliseCellLanguage", () => {
	it("lower-cases a language and replaces underscores with hyphens", () => {
		expect(normaliseCellLanguage("My_Lang")).toBe("my-lang");
		expect(normaliseCellLanguage("Typst")).toBe("typst");
	});
});
