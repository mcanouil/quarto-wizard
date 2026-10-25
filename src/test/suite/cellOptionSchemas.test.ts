import * as assert from "assert";
import type { ExtensionSchema, FieldDescriptor } from "@quarto-wizard/schema";
import { collectCellOptionSchemas, mergeCellSchemas } from "../../providers/cellOptionSchemas";
import { SchemaCache } from "@quarto-wizard/schema";
import { releaseProviderProject, useProviderProject } from "./providerFixtures";
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
			assert.deepStrictEqual(merged.typst.dpi.conflicts, new Map([["dpi", ["B"]]]));
		});

		test("does not conflict an extension with itself", () => {
			const schema = cells("typst", { dpi: { type: "integer" } });
			const merged = mergeCellSchemas([
				{ source: "A", id: "acme/demo", schema },
				{ source: "A", id: "acme/demo", schema },
			]);
			assert.deepStrictEqual(merged.typst.dpi.conflicts, new Map());
		});

		test("treats an alias of a later option as a conflict and keeps both", () => {
			const merged = mergeCellSchemas([
				{ source: "A", schema: cells("typst", { dpi: { type: "integer" } }) },
				{ source: "B", schema: cells("typst", { resolution: { type: "integer", aliases: ["dpi"] } }) },
			]);
			assert.strictEqual(merged.typst.dpi.source, "A");
			assert.deepStrictEqual(merged.typst.dpi.conflicts, new Map([["dpi", ["B"]]]));
			assert.strictEqual(merged.typst.resolution.source, "B");
			assert.deepStrictEqual(merged.typst.resolution.conflicts, new Map([["dpi", ["A"]]]));
		});

		test("records only the sources that declare each contested spelling", () => {
			const merged = mergeCellSchemas([
				{ source: "A", schema: cells("typst", { x: { type: "string", aliases: ["y"] } }) },
				{ source: "B", schema: cells("typst", { x: { type: "string" } }) },
				{ source: "C", schema: cells("typst", { z: { type: "string", aliases: ["y"] } }) },
			]);
			assert.deepStrictEqual(
				merged.typst.x.conflicts,
				new Map([
					["x", ["B"]],
					["y", ["C"]],
				]),
			);
			assert.deepStrictEqual(merged.typst.z.conflicts, new Map([["y", ["A"]]]));
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
			assert.deepStrictEqual(merged.typst.dpi.conflicts, new Map());
			assert.deepStrictEqual(merged.typst.fit.conflicts, new Map());
		});

		test("does not report a conflict between options of one extension", () => {
			const merged = mergeCellSchemas([
				{
					source: "A",
					schema: cells("typst", { dpi: { type: "integer" }, resolution: { type: "integer", aliases: ["dpi"] } }),
				},
			]);
			assert.deepStrictEqual(merged.typst.dpi.conflicts, new Map());
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

	suite("collectCellOptionSchemas", () => {
		setup(() => {
			useProviderProject();
		});

		teardown(() => {
			releaseProviderProject();
		});

		test("returns the options of the installed extension without conflicts", async () => {
			const schemas = await collectCellOptionSchemas(new SchemaCache());
			assert.ok(schemas.typst, JSON.stringify(Object.keys(schemas)));
			for (const option of Object.values(schemas.typst)) {
				assert.deepStrictEqual(option.conflicts, new Map());
			}
		});
	});
});
