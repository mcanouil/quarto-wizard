import * as assert from "assert";
import type { ExtensionSchema, FieldDescriptor } from "@quarto-wizard/schema";
import { collectCellOptionSchemas, mergeCellSchemas } from "../../providers/cellOptionSchemas";
import { cellLanguageKey } from "../../utils/cellOptions";
import { SchemaCache } from "@quarto-wizard/schema";
import { releaseProviderProject, useProviderProject } from "./providerFixtures";
import { resolveDeclarations } from "../../providers/attributeDeclarations";

function cells(language: string, options: Record<string, FieldDescriptor>): ExtensionSchema {
	return { cells: { [language]: { options } } };
}

suite("cellOptionSchemas Test Suite", () => {
	suite("mergeCellSchemas", () => {
		test("matches a language without regard to case, hyphen or underscore", () => {
			const merged = mergeCellSchemas([
				{ source: "A", schema: cells("my-lang", { dpi: { type: "integer" } }) },
				{ source: "B", schema: cells("My_Lang", { dpi: { type: "integer" } }) },
			]);
			assert.deepStrictEqual(Object.keys(merged), ["my-lang"]);
			assert.deepStrictEqual(
				merged["my-lang"].byName.dpi.map((declaration) => declaration.source),
				["A", "B"],
			);
		});

		test("keeps every declaration of a shared option, in discovery order", () => {
			const merged = mergeCellSchemas([
				{ source: "A", schema: cells("typst", { dpi: { type: "integer", description: "from A" } }) },
				{ source: "B", schema: cells("typst", { dpi: { type: "integer", description: "from B" } }) },
			]);
			const declarations = merged.typst.byName.dpi;
			assert.deepStrictEqual(
				declarations.map((declaration) => [declaration.source, declaration.descriptor.description]),
				[
					["A", "from A"],
					["B", "from B"],
				],
			);
			assert.ok(declarations.every((declaration) => declaration.groupOrigin === "any"));
		});

		test("counts an extension once when its id repeats", () => {
			const schema = cells("typst", { dpi: { type: "integer" } });
			const merged = mergeCellSchemas([
				{ source: "A", id: "acme/demo", schema },
				{ source: "A", id: "acme/demo", schema },
			]);
			assert.strictEqual(merged.typst.byName.dpi.length, 1);
			assert.strictEqual(merged.typst.byExtension.length, 1);
		});

		test("skips an entry whose id repeats an earlier one, whatever it declares", () => {
			const merged = mergeCellSchemas([
				{ source: "A", id: "acme/demo", schema: cells("typst", { dpi: { type: "integer" } }) },
				{ source: "A", id: "acme/demo", schema: cells("typst", { dpi: { type: "integer" }, z: { type: "string" } }) },
			]);
			assert.strictEqual(merged.typst.byName.z, undefined);
		});

		test("counts entries without an id separately", () => {
			const schema = cells("typst", { dpi: { type: "integer" } });
			const merged = mergeCellSchemas([
				{ source: "A", schema },
				{ source: "A", schema },
			]);
			assert.strictEqual(merged.typst.byName.dpi.length, 2);
		});

		test("resolves an alias in one extension and a name in another to both", () => {
			const merged = mergeCellSchemas([
				{ source: "A", schema: cells("typst", { dpi: { type: "integer" } }) },
				{ source: "B", schema: cells("typst", { resolution: { type: "integer", aliases: ["dpi"] } }) },
			]);
			assert.deepStrictEqual(
				resolveDeclarations(merged.typst, "dpi").map((declaration) => declaration.source),
				["A", "B"],
			);
			assert.deepStrictEqual(
				resolveDeclarations(merged.typst, "resolution").map((declaration) => declaration.source),
				["B"],
			);
		});

		test("resolves a hyphenated or underscored spelling", () => {
			const merged = mergeCellSchemas([{ source: "A", schema: cells("typst", { fig_width: { type: "number" } }) }]);
			assert.strictEqual(resolveDeclarations(merged.typst, "fig-width").length, 1);
		});

		test("merges language keys case-insensitively", () => {
			const merged = mergeCellSchemas([
				{ source: "A", schema: cells("Typst", { dpi: { type: "integer" } }) },
				{ source: "B", schema: cells("typst", { fit: { type: "boolean" } }) },
			]);
			assert.deepStrictEqual(Object.keys(merged), ["typst"]);
			assert.deepStrictEqual(Object.keys(merged.typst.byName).sort(), ["dpi", "fit"]);
		});

		test("merges the options of one extension that spells a language two ways", () => {
			const merged = mergeCellSchemas([
				{
					source: "A",
					schema: {
						cells: {
							Typst: { options: { a: { type: "string" }, c: { type: "string", description: "first" } } },
							typst: { options: { b: { type: "string" }, c: { type: "string", description: "second" } } },
						},
					},
				},
			]);
			assert.deepStrictEqual(Object.keys(merged.typst.byName).sort(), ["a", "b", "c"]);
			assert.strictEqual(merged.typst.byName.c.length, 1);
			assert.strictEqual(merged.typst.byName.c[0].descriptor.description, "first");
		});

		test("does not resolve names from Object.prototype", () => {
			const merged = mergeCellSchemas([
				{ source: "A", schema: cells("constructor", { toString: { type: "string" } }) },
				{ source: "B", schema: cells("python", { dpi: { type: "integer" } }) },
			]);
			assert.ok(Object.hasOwn(merged, "constructor"));
			const language = "constructor";
			const optionName = "toString";
			assert.strictEqual(merged[language].byName[optionName][0].source, "A");
			assert.strictEqual(merged.python.byName[language], undefined);
			assert.deepStrictEqual(resolveDeclarations(merged.python, "constructor"), []);
			assert.strictEqual(resolveDeclarations(merged.python, "dpi")[0].source, "B");
		});

		test("handles a __proto__ language and option name", () => {
			const merged = mergeCellSchemas([
				{ source: "A", schema: JSON.parse('{"cells":{"__proto__":{"options":{"__proto__":{"type":"string"}}}}}') },
			]);
			assert.strictEqual(merged[cellLanguageKey("__proto__")]?.byName["__proto__"]?.[0].source, "A");
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

		test("returns one declaration per option of the installed extension", async () => {
			const schemas = await collectCellOptionSchemas(new SchemaCache());
			assert.ok(schemas.typst, JSON.stringify(Object.keys(schemas)));
			for (const declarations of Object.values(schemas.typst.byName)) {
				assert.strictEqual(declarations.length, 1);
			}
		});
	});
});
