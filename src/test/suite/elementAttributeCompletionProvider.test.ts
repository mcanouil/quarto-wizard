import * as assert from "assert";
import * as vscode from "vscode";
import { SchemaCache } from "@quarto-wizard/schema";
import {
	ElementAttributeCompletionProvider,
	ElementAttributeHoverProvider,
} from "../../providers/elementAttributeCompletionProvider";
import {
	hoverText,
	labelOf,
	labelsOf,
	openProviderFixture,
	positionAfter,
	positionAt,
	releaseProviderProject,
	useProviderProject,
} from "./providerFixtures";

suite("Element Attribute Completion Provider", () => {
	let completion: ElementAttributeCompletionProvider;
	let hover: ElementAttributeHoverProvider;

	setup(() => {
		useProviderProject();
		const schemaCache = new SchemaCache();
		completion = new ElementAttributeCompletionProvider(schemaCache);
		hover = new ElementAttributeHoverProvider(schemaCache);
	});

	teardown(() => {
		releaseProviderProject();
	});

	async function complete(position: (document: vscode.TextDocument) => vscode.Position) {
		const document = await openProviderFixture("attributes.qmd");
		return completion.provideCompletionItems(document, position(document));
	}

	suite("completion", () => {
		test("Offers the class names after a dot", async () => {
			const items = await complete((d) => positionAt(d, "{.}", 2));
			assert.deepStrictEqual(labelsOf(items), ["demo-box"]);
			assert.strictEqual(items?.[0].documentation instanceof vscode.MarkdownString, true);
		});

		test("Offers the attributes of the class, the element type and the catch-all group", async () => {
			const items = await complete((d) => positionAfter(d, "{.demo-box "));
			const labels = labelsOf(items);
			for (const expected of ["tone", "pinned", "anchor", "width", "note"]) {
				assert.ok(labels.includes(expected), `Expected ${expected} in ${JSON.stringify(labels)}.`);
			}
		});

		test("Offers the classes that are not yet present, with a dot", async () => {
			const items = await complete((d) => positionAfter(d, "{.demo-box "));
			assert.ok(!labelsOf(items).includes(".demo-box"));
			const other = await complete((d) => positionAfter(d, "{.other "));
			assert.ok(labelsOf(other).includes(".demo-box"));
		});

		test("Sorts the class attributes before the catch-all ones", async () => {
			const items = await complete((d) => positionAfter(d, "{.demo-box "));
			const byLabel = new Map(items?.map((item) => [labelOf(item), item]));
			assert.ok(String(byLabel.get("tone")?.sortText) < String(byLabel.get("note")?.sortText));
		});

		test("Skips the attributes already present", async () => {
			const items = await complete((d) => positionAfter(d, 'width="1" '));
			const labels = labelsOf(items);
			assert.ok(!labels.includes("tone"));
			assert.ok(!labels.includes("note"));
			assert.ok(!labels.includes("width"));
			assert.ok(labels.includes("pinned"));
		});

		test("Offers the enum values of a string attribute", async () => {
			const items = await complete((d) => positionAfter(d, "tone="));
			assert.deepStrictEqual(labelsOf(items), ["calm", "loud"]);
		});

		test("Offers true and false for a boolean attribute", async () => {
			const items = await complete((d) => positionAfter(d, "pinned="));
			assert.deepStrictEqual(labelsOf(items), ["true", "false"]);
		});

		test("Offers workspace files for a file attribute", async () => {
			const items = await complete((d) => positionAfter(d, "anchor="));
			const labels = labelsOf(items);
			assert.ok(labels.includes("hover.qmd"), `Expected hover.qmd in ${JSON.stringify(labels)}.`);
		});
	});

	suite("nothing", () => {
		test("Returns nothing outside an attribute block", async () => {
			const items = await complete((d) => positionAfter(d, "Plain text."));
			assert.strictEqual(items, null);
		});

		test("Returns nothing inside a fenced code block", async () => {
			const items = await complete((d) => positionAfter(d, "{.demo-box ", "last"));
			assert.strictEqual(items, null);
		});

		test("Returns nothing when the cursor is in front of a word character", async () => {
			const items = await complete((d) => positionAfter(d, 'tone="'));
			assert.strictEqual(items, null);
		});
	});

	suite("hover", () => {
		async function hoverAt(needle: string, delta = 1): Promise<string | null> {
			const document = await openProviderFixture("attributes.qmd");
			const result = await hover.provideHover(document, positionAt(document, needle, delta));
			return result ? hoverText(result) : null;
		}

		test("Describes a class", async () => {
			const text = await hoverAt(".demo-box }", 2);
			assert.ok(text?.includes("*From extension:* **Demo**"));
			assert.ok(text?.includes("A demo box."));
			assert.ok(text?.includes("Attributes: `tone`, `pinned`, `anchor`"));
		});

		test("Describes an attribute key", async () => {
			const text = await hoverAt("tone=", 1);
			assert.ok(text?.includes("Box tone."));
		});

		test("Describes an attribute from its value", async () => {
			const text = await hoverAt('"calm"', 2);
			assert.ok(text?.includes("Box tone."));
		});

		test("Returns nothing for a class without a definition", async () => {
			assert.strictEqual(await hoverAt(".other", 2), null);
		});

		test("Returns nothing outside an attribute block", async () => {
			assert.strictEqual(await hoverAt("Plain text."), null);
		});
	});
});
