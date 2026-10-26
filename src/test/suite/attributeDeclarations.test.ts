import * as assert from "assert";
import * as vscode from "vscode";
import type { FieldDescriptor } from "@quarto-wizard/schema";
import {
	type ExtensionDeclarations,
	combineDeclarations,
	formatSources,
	resolveDeclarations,
} from "../../providers/attributeDeclarations";
import { buildAttributeDoc, buildDeclarationsDoc } from "../../utils/schemaDocumentation";
import {
	type ExtensionAttributeSchema,
	attributeKeyItems,
	attributeValueItems,
	mergeApplicableAttributes,
} from "../../providers/elementAttributeCompletionProvider";

function extension(source: string, descriptors: Record<string, FieldDescriptor>): ExtensionDeclarations {
	const origins = Object.fromEntries(Object.keys(descriptors).map((name) => [name, "any" as const]));
	return { source, sourceId: `acme/${source}`, descriptors, origins };
}

function schema(
	source: string,
	groups: Record<string, Record<string, FieldDescriptor>>,
	sourceId = `acme/${source}`,
): ExtensionAttributeSchema {
	return { source, sourceId, groups };
}

suite("attributeDeclarations Test Suite", () => {
	suite("combineDeclarations", () => {
		test("keeps one declaration per extension for each name, in discovery order", () => {
			const applicable = combineDeclarations([
				extension("A", { dpi: { type: "integer" } }),
				extension("B", { dpi: { type: "string" }, width: { type: "number" } }),
			]);
			assert.deepStrictEqual(
				applicable.byName.dpi.map((declaration) => [declaration.source, declaration.descriptor.type]),
				[
					["A", "integer"],
					["B", "string"],
				],
			);
			assert.deepStrictEqual(
				applicable.byName.width.map((declaration) => declaration.source),
				["B"],
			);
			assert.deepStrictEqual(
				applicable.byExtension.map((ext) => ext.source),
				["A", "B"],
			);
		});

		test("counts two entries with the same source identity once", () => {
			const applicable = combineDeclarations([
				extension("A", { dpi: { type: "integer" } }),
				extension("A", { dpi: { type: "integer" } }),
			]);
			assert.strictEqual(applicable.byName.dpi.length, 1);
			assert.strictEqual(applicable.byExtension.length, 1);
		});

		test("does not resolve names from Object.prototype", () => {
			const applicable = combineDeclarations([extension("A", { dpi: { type: "integer" } })]);
			assert.strictEqual(applicable.byName["constructor"], undefined);
			assert.deepStrictEqual(resolveDeclarations(applicable, "constructor"), []);
			assert.deepStrictEqual(resolveDeclarations(applicable, "toString"), []);
		});

		test("keeps a declared constructor attribute as an ordinary name", () => {
			const applicable = combineDeclarations([extension("A", { constructor: { type: "string" } })]);
			assert.deepStrictEqual(
				resolveDeclarations(applicable, "constructor").map((declaration) => declaration.source),
				["A"],
			);
		});
	});

	suite("resolveDeclarations", () => {
		test("returns every extension that names or aliases the key", () => {
			const applicable = combineDeclarations([
				extension("A", { dpi: { type: "integer" } }),
				extension("B", { resolution: { type: "integer", aliases: ["dpi"] } }),
				extension("C", { other: { type: "string" } }),
			]);
			assert.deepStrictEqual(
				resolveDeclarations(applicable, "dpi").map((declaration) => declaration.source),
				["A", "B"],
			);
		});

		test("folds hyphen and underscore spellings per extension", () => {
			const applicable = combineDeclarations([
				extension("A", { fig_width: { type: "number" } }),
				extension("B", { size: { type: "number", aliases: ["fig-width"] } }),
			]);
			assert.deepStrictEqual(
				resolveDeclarations(applicable, "fig-width").map((declaration) => declaration.source),
				["A", "B"],
			);
		});

		test("prefers a declared name over an alias inside one extension", () => {
			const applicable = combineDeclarations([
				extension("A", { size: { type: "number", aliases: ["dpi"] }, dpi: { type: "integer" } }),
			]);
			const declarations = resolveDeclarations(applicable, "dpi");
			assert.strictEqual(declarations.length, 1);
			assert.strictEqual(declarations[0].descriptor.type, "integer");
		});
	});

	suite("mergeApplicableAttributes", () => {
		test("lets a class group override _any inside one extension", () => {
			const applicable = mergeApplicableAttributes(
				[schema("A", { _any: { colour: { type: "string" } }, panel: { colour: { type: "number" } } })],
				["panel"],
				[],
				"Div",
			);
			const declarations = resolveDeclarations(applicable, "colour");
			assert.strictEqual(declarations.length, 1);
			assert.strictEqual(declarations[0].descriptor.type, "number");
			assert.strictEqual(declarations[0].groupOrigin, "classOrId");
		});

		test("keeps the declarations of two extensions side by side", () => {
			const applicable = mergeApplicableAttributes(
				[
					schema("A", { CodeBlock: { include: { type: "string" } } }),
					schema("B", { typst: { include: { type: "boolean" } } }),
				],
				["typst"],
				[],
				"Code",
			);
			assert.deepStrictEqual(
				resolveDeclarations(applicable, "include").map((declaration) => [
					declaration.source,
					declaration.descriptor.type,
					declaration.groupOrigin,
				]),
				[
					["A", "string", "elementType"],
					["B", "boolean", "classOrId"],
				],
			);
		});

		test("counts one extension installed in two roots as one source", () => {
			const applicable = mergeApplicableAttributes(
				[schema("A", { _any: { dpi: { type: "integer" } } }), schema("A", { _any: { dpi: { type: "integer" } } })],
				[],
				[],
				"Div",
			);
			assert.deepStrictEqual(
				resolveDeclarations(applicable, "dpi").map((declaration) => declaration.sourceId),
				["acme/A"],
			);
		});

		test("leaves out an extension with no applicable group", () => {
			const applicable = mergeApplicableAttributes(
				[schema("A", { other: { dpi: { type: "integer" } } }), schema("B", { _any: { dpi: { type: "integer" } } })],
				[],
				[],
				"Div",
			);
			assert.deepStrictEqual(
				applicable.byExtension.map((ext) => ext.source),
				["B"],
			);
		});
	});

	suite("formatSources", () => {
		test("joins one, two and three sources", () => {
			assert.strictEqual(formatSources(["A"]), "A");
			assert.strictEqual(formatSources(["A", "B"]), "A and B");
			assert.strictEqual(formatSources(["A", "B", "C"]), "A, B and C");
		});
	});
});

suite("Completion and hover across extensions", () => {
	const inc = extension("inc", { include: { type: "string", enum: ["a", "b"], description: "From inc." } });
	const tr = extension("tr", { include: { type: "boolean", enum: ["b", "c"], aliases: ["inc"] } });
	const applicable = combineDeclarations([inc, tr]);

	test("offers one key item whose detail lists every source", () => {
		const items = attributeKeyItems(applicable, new Set(), ": ");
		const include = items.filter((item) => item.label === "include");
		assert.strictEqual(include.length, 1);
		assert.strictEqual(include[0].detail, "inc, tr");
		assert.strictEqual(include[0].sortText, "!5_inc, tr_include");
		assert.deepStrictEqual(
			items.map((item) => item.label),
			["include", "inc"],
		);
		assert.strictEqual(items[1].detail, "tr (alias for include)");
	});

	test("skips a name when an alias of any declaration is present", () => {
		assert.deepStrictEqual(attributeKeyItems(applicable, new Set(["inc"]), ": "), []);
	});

	test("keeps the output of a single source", () => {
		const items = attributeKeyItems(combineDeclarations([inc]), new Set(), "=");
		assert.strictEqual(items[0].detail, "inc");
		assert.strictEqual(items[0].sortText, "!5_inc_include");
	});

	test("offers the union of the values once", async () => {
		const items = await attributeValueItems(applicable.byName.include, vscode.Uri.file("/tmp/x.qmd"));
		assert.deepStrictEqual(
			items.map((item) => item.label),
			["a", "b", "c"],
		);
		assert.strictEqual(items[1].detail, "inc, tr");
	});

	test("documents each source", () => {
		const text = buildDeclarationsDoc(applicable.byName.include)?.value ?? "";
		assert.ok(text.includes("**inc**"), text);
		assert.ok(text.includes("**tr**"), text);
		assert.ok(text.includes("Type: `string`") && text.includes("Type: `boolean`"), text);
	});

	test("renders a single declaration as buildAttributeDoc does", () => {
		const [only] = applicable.byName.include;
		assert.strictEqual(buildDeclarationsDoc([only])?.value, buildAttributeDoc(only.descriptor, only.source)?.value);
	});
});
