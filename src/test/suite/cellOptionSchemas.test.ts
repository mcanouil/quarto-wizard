import * as assert from "assert";
import type { ExtensionSchema, FieldDescriptor } from "@quarto-wizard/schema";
import { mergeCellSchemas } from "../../providers/cellOptionSchemas";
import { resolveElementAttribute } from "../../providers/elementAttributeCompletionProvider";

function cells(language: string, options: Record<string, FieldDescriptor>): ExtensionSchema {
	return { cells: { [language]: { options } } };
}

suite("cellOptionSchemas Test Suite", () => {
	suite("mergeCellSchemas", () => {
		test("keeps the first declaration of a shared option and records the loser", () => {
			const merged = mergeCellSchemas([
				{ source: "A", schema: cells("typst", { dpi: { type: "integer", description: "from A" } }) },
				{ source: "B", schema: cells("typst", { dpi: { type: "integer", description: "from B" } }) },
			]);
			assert.strictEqual(merged.typst.dpi.source, "A");
			assert.strictEqual(merged.typst.dpi.descriptor.description, "from A");
			assert.deepStrictEqual(merged.typst.dpi.conflicts, ["B"]);
		});

		test("treats an alias of a later option as a conflict and keeps both", () => {
			const merged = mergeCellSchemas([
				{ source: "A", schema: cells("typst", { dpi: { type: "integer" } }) },
				{ source: "B", schema: cells("typst", { resolution: { type: "integer", aliases: ["dpi"] } }) },
			]);
			assert.strictEqual(merged.typst.dpi.source, "A");
			assert.deepStrictEqual(merged.typst.dpi.conflicts, ["B"]);
			assert.strictEqual(merged.typst.resolution.source, "B");
			assert.deepStrictEqual(merged.typst.resolution.conflicts, ["A"]);
		});

		test("merges language keys case-insensitively", () => {
			const merged = mergeCellSchemas([
				{ source: "A", schema: cells("Typst", { dpi: { type: "integer" } }) },
				{ source: "B", schema: cells("typst", { fit: { type: "boolean" } }) },
			]);
			assert.deepStrictEqual(Object.keys(merged), ["typst"]);
			assert.deepStrictEqual(Object.keys(merged.typst).sort(), ["dpi", "fit"]);
		});

		test("keeps distinct options without conflicts", () => {
			const merged = mergeCellSchemas([
				{ source: "A", schema: cells("typst", { dpi: { type: "integer" } }) },
				{ source: "B", schema: cells("typst", { fit: { type: "boolean" } }) },
			]);
			assert.deepStrictEqual(merged.typst.dpi.conflicts, []);
			assert.deepStrictEqual(merged.typst.fit.conflicts, []);
		});

		test("does not report a conflict between options of one extension", () => {
			const merged = mergeCellSchemas([
				{
					source: "A",
					schema: cells("typst", { dpi: { type: "integer" }, resolution: { type: "integer", aliases: ["dpi"] } }),
				},
			]);
			assert.deepStrictEqual(merged.typst.dpi.conflicts, []);
		});

		test("does not resolve names from Object.prototype", () => {
			const merged = mergeCellSchemas([
				{ source: "A", schema: cells("constructor", { toString: { type: "string" } }) },
				{ source: "B", schema: cells("python", { dpi: { type: "integer" } }) },
			]);
			assert.ok(Object.hasOwn(merged, "constructor"));
			const language = "constructor";
			const optionName = "toString";
			assert.strictEqual(merged[language][optionName].source, "A");
			assert.strictEqual(merged.python[language], undefined);
			assert.strictEqual(resolveElementAttribute(merged.python, "constructor"), undefined);
			assert.strictEqual(resolveElementAttribute(merged.python, "dpi")?.source, "B");
		});

		test("handles a __proto__ language and option name", () => {
			const merged = mergeCellSchemas([
				{ source: "A", schema: JSON.parse('{"cells":{"__proto__":{"options":{"__proto__":{"type":"string"}}}}}') },
			]);
			assert.strictEqual(merged["__proto__"]?.["__proto__"]?.source, "A");
		});

		test("ignores schemas without cells", () => {
			assert.deepStrictEqual(Object.keys(mergeCellSchemas([{ source: "A", schema: {} }])), []);
		});
	});
});
