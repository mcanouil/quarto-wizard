import * as assert from "assert";
import { SchemaCache } from "@quarto-wizard/schema";
import { YamlHoverProvider } from "../../providers/yamlHoverProvider";
import {
	hoverText,
	openProviderFixture,
	positionAt,
	releaseProviderProject,
	useProviderProject,
} from "./providerFixtures";

suite("YAML Hover Provider", () => {
	let provider: YamlHoverProvider;

	setup(() => {
		useProviderProject();
		provider = new YamlHoverProvider(new SchemaCache());
	});

	teardown(() => {
		releaseProviderProject();
	});

	async function hoverAt(needle: string, delta = 1): Promise<string | null> {
		const document = await openProviderFixture("hover.qmd");
		const hover = await provider.provideHover(document, positionAt(document, needle, delta));
		return hover ? hoverText(hover) : null;
	}

	test("Describes the extensions key", async () => {
		const text = await hoverAt("extensions:");
		assert.strictEqual(text, "Configure options for installed Quarto extensions.");
	});

	test("Shows the manifest of an installed extension", async () => {
		const text = await hoverAt("demo:");
		assert.ok(text?.includes("**Demo**"));
		assert.ok(text?.includes("Provides: shortcode"));
		assert.ok(text?.includes("**Author:** Acme"));
		assert.ok(text?.includes("**Version:** 1.0.0"));
	});

	test("Shows the type and allowed values of an enum option", async () => {
		const text = await hoverAt("mode:");
		assert.ok(text?.includes("Rendering mode."));
		assert.ok(text?.includes("**Type:** `string`"));
		assert.ok(text?.includes("**Allowed values:** `fast`, `slow`"));
	});

	test("Lists the allowed values when the cursor is on the value", async () => {
		const text = await hoverAt("fast");
		assert.ok(text?.includes("allowed values: `fast`, `slow`"));
	});

	test("Shows the range of a number nested in an object option", async () => {
		const text = await hoverAt("depth:");
		assert.ok(text?.includes("Maximum depth."));
		assert.ok(text?.includes("**Type:** `number`"));
		assert.ok(text?.includes("**Range:** min: 1, max: 9"));
	});

	test("Shows the deprecation of an option and its aliases", async () => {
		const text = await hoverAt("old-name:");
		assert.ok(text?.includes("**Deprecated**"));
		assert.ok(text?.includes("**Aliases:** `legacy-name`"));
	});

	test("Resolves an alias to its option", async () => {
		const text = await hoverAt("legacy-name:");
		assert.ok(text?.includes("Superseded option."));
	});

	test("Shows a format option", async () => {
		const text = await hoverAt("highlight:");
		assert.ok(text?.includes("Highlight style."));
		assert.ok(text?.includes("**Allowed values:** `plain`, `bold`"));
	});

	test("Returns nothing for an option the schema does not define", async () => {
		assert.strictEqual(await hoverAt("unknown:"), null);
	});

	test("Returns nothing for a top-level key", async () => {
		assert.strictEqual(await hoverAt("title:"), null);
	});

	test("Returns nothing in the body of a Quarto document", async () => {
		assert.strictEqual(await hoverAt("Body text"), null);
	});
});
