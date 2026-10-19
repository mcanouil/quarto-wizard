import * as assert from "assert";
import * as vscode from "vscode";
import { SchemaCache } from "@quarto-wizard/schema";
import { ShortcodeCompletionProvider, ShortcodeHoverProvider } from "../../providers/shortcodeCompletionProvider";
import {
	hoverText,
	labelsOf,
	openProviderFixture,
	positionAfter,
	positionAt,
	releaseProviderProject,
	useProviderProject,
} from "./providerFixtures";

suite("Shortcode Completion Provider", () => {
	let completion: ShortcodeCompletionProvider;
	let hover: ShortcodeHoverProvider;

	setup(() => {
		useProviderProject();
		const schemaCache = new SchemaCache();
		completion = new ShortcodeCompletionProvider(schemaCache);
		hover = new ShortcodeHoverProvider(schemaCache);
	});

	teardown(() => {
		releaseProviderProject();
	});

	async function complete(position: (document: vscode.TextDocument) => vscode.Position) {
		const document = await openProviderFixture("shortcodes.qmd");
		return completion.provideCompletionItems(document, position(document));
	}

	function itemsOf(result: vscode.CompletionItem[] | vscode.CompletionList | null): vscode.CompletionItem[] {
		if (!result) {
			return [];
		}
		return Array.isArray(result) ? result : result.items;
	}

	suite("completion", () => {
		test("Offers the shortcode names after the opening delimiter", async () => {
			const result = await complete((d) => positionAfter(d, "{{< "));
			assert.deepStrictEqual(labelsOf(itemsOf(result)), ["demo"]);
			assert.strictEqual(itemsOf(result)[0].kind, vscode.CompletionItemKind.Function);
		});

		test("Offers the enum arguments and the attribute keys after the name", async () => {
			const result = await complete((d) => positionAfter(d, "{{< demo "));
			const labels = labelsOf(itemsOf(result));
			assert.deepStrictEqual(labels.slice(0, 2), ["alpha", "beta"]);
			assert.ok(labels.includes("size"));
			assert.ok(labels.includes("flip"));
		});

		test("Offers attribute keys and aliases once the arguments are given", async () => {
			const result = await complete((d) => positionAfter(d, "{{< demo alpha "));
			assert.deepStrictEqual(labelsOf(itemsOf(result)).sort(), [
				"active",
				"caption",
				"flip",
				"label",
				"size",
				"source",
			]);
		});

		test("Offers the enum values of a string attribute", async () => {
			const result = await complete((d) => positionAfter(d, "flip="));
			assert.deepStrictEqual(labelsOf(itemsOf(result)), ["horizontal", "vertical"]);
		});

		test("Offers true and false for a boolean attribute", async () => {
			const result = await complete((d) => positionAfter(d, "active="));
			assert.deepStrictEqual(labelsOf(itemsOf(result)), ["true", "false"]);
		});

		test("Offers workspace files for a file attribute", async () => {
			const result = await complete((d) => positionAfter(d, "source="));
			assert.ok(result instanceof vscode.CompletionList);
			const labels = labelsOf(itemsOf(result));
			assert.ok(labels.includes("hover.qmd"), `Expected hover.qmd in ${JSON.stringify(labels)}.`);
		});

		test("Offers nothing for a string attribute without a value list", async () => {
			const result = await complete((d) => positionAfter(d, "size="));
			assert.deepStrictEqual(itemsOf(result), []);
		});
	});

	suite("nothing", () => {
		test("Returns nothing outside a shortcode", async () => {
			const result = await complete((d) => positionAfter(d, "Plain text."));
			assert.strictEqual(result, null);
		});

		test("Returns nothing inside a fenced code block", async () => {
			const result = await complete((d) => positionAfter(d, "{{< demo ", "last"));
			assert.strictEqual(result, null);
		});

		test("Returns nothing when the cursor is in front of a word character", async () => {
			const result = await complete((d) => positionAfter(d, "flip="));
			const document = await openProviderFixture("shortcodes.qmd");
			const midToken = await completion.provideCompletionItems(
				document,
				positionAfter(document, "flip=h").translate(0, -1),
			);
			assert.ok(result);
			assert.strictEqual(midToken, null);
		});

		test("Returns nothing for a shortcode without a schema", async () => {
			const result = await complete((d) => positionAfter(d, "{{< unknown "));
			assert.deepStrictEqual(itemsOf(result), []);
		});
	});

	suite("hover", () => {
		async function hoverAt(needle: string, delta = 1): Promise<string | null> {
			const document = await openProviderFixture("shortcodes.qmd");
			const result = await hover.provideHover(document, positionAt(document, needle, delta));
			return result ? hoverText(result) : null;
		}

		test("Describes a shortcode name", async () => {
			const text = await hoverAt("demo >}}");
			assert.ok(text?.includes("**Shortcode: `demo`**"));
			assert.ok(text?.includes("Renders a demo widget."));
		});

		test("Describes an enum attribute key", async () => {
			const text = await hoverAt("flip=");
			assert.ok(text?.includes("Flip direction."));
			assert.ok(text?.includes("`horizontal`"));
		});

		test("Describes an attribute through its alias", async () => {
			const text = await hoverAt("caption=");
			assert.ok(text?.includes("Widget label."));
		});

		test("Describes an attribute from its value", async () => {
			const text = await hoverAt("horizontal");
			assert.ok(text?.includes("Flip direction."));
		});

		test("Returns nothing for a shortcode without a schema", async () => {
			assert.strictEqual(await hoverAt("unknown"), null);
		});

		test("Returns nothing outside a shortcode", async () => {
			assert.strictEqual(await hoverAt("Plain text."), null);
		});
	});
});
