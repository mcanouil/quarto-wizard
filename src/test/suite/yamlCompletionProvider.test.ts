import * as assert from "assert";
import * as vscode from "vscode";
import { SchemaCache } from "@quarto-wizard/schema";
import { YamlCompletionProvider } from "../../providers/yamlCompletionProvider";
import {
	endOfLineAfter,
	labelOf,
	labelsOf,
	openProviderFixture,
	positionAfter,
	releaseProviderProject,
	useProviderProject,
} from "./providerFixtures";

suite("YAML Completion Provider", () => {
	let provider: YamlCompletionProvider;

	setup(() => {
		useProviderProject();
		provider = new YamlCompletionProvider(new SchemaCache());
	});

	teardown(() => {
		releaseProviderProject();
	});

	async function complete(fixture: string, position: (document: vscode.TextDocument) => vscode.Position) {
		const document = await openProviderFixture(fixture);
		return provider.provideCompletionItems(document, position(document));
	}

	suite("keys", () => {
		test("Offers the extensions key at the top level", async () => {
			const items = await complete("completion-top-level.qmd", (d) => endOfLineAfter(d, "title: Top"));
			assert.deepStrictEqual(labelsOf(items), ["extensions"]);
			assert.strictEqual(items?.[0].kind, vscode.CompletionItemKind.Module);
		});

		test("Offers the full and short name of an installed extension under extensions", async () => {
			const items = await complete("completion-extension-names.qmd", (d) => endOfLineAfter(d, "extensions:"));
			assert.deepStrictEqual(labelsOf(items), ["acme/demo", "demo"]);
			assert.strictEqual(items?.[1].detail, "Demo");
			const documentation = items?.[1].documentation as vscode.MarkdownString;
			assert.ok(documentation.value.includes("Provides: shortcode"));
			assert.ok(documentation.value.includes("**Author:** Acme"));
		});

		test("Offers the remaining option keys, with aliases, and skips the keys already present", async () => {
			const items = await complete("completion-option-keys.qmd", (d) => endOfLineAfter(d, "mode: fast"));
			const labels = labelsOf(items);
			assert.deepStrictEqual(labels.sort(), ["kind", "legacy-name", "limits", "old-name", "template", "verbose"]);
		});

		test("Marks object options as modules and scalar options as properties", async () => {
			const items = await complete("completion-option-keys.qmd", (d) => endOfLineAfter(d, "mode: fast"));
			const byLabel = new Map(items?.map((item) => [labelOf(item), item]));
			assert.strictEqual(byLabel.get("limits")?.kind, vscode.CompletionItemKind.Module);
			assert.strictEqual(byLabel.get("verbose")?.kind, vscode.CompletionItemKind.Property);
			assert.strictEqual(byLabel.get("verbose")?.insertText, "verbose: ");
		});

		test("Tags deprecated options and labels the alias", async () => {
			const items = await complete("completion-option-keys.qmd", (d) => endOfLineAfter(d, "mode: fast"));
			const byLabel = new Map(items?.map((item) => [labelOf(item), item]));
			assert.deepStrictEqual(byLabel.get("old-name")?.tags, [vscode.CompletionItemTag.Deprecated]);
			assert.strictEqual(byLabel.get("legacy-name")?.detail, "Alias for old-name");
		});

		test("Chains to value completion for options with known values", async () => {
			const items = await complete("completion-option-keys.qmd", (d) => endOfLineAfter(d, "mode: fast"));
			const byLabel = new Map(items?.map((item) => [labelOf(item), item]));
			assert.strictEqual(byLabel.get("verbose")?.command?.command, "editor.action.triggerSuggest");
			assert.strictEqual(byLabel.get("template")?.command?.command, "editor.action.triggerSuggest");
		});

		test("Offers the format keys of the matching format", async () => {
			const items = await complete("completion-unmatched.qmd", (d) => endOfLineAfter(d, "html:"));
			assert.deepStrictEqual(labelsOf(items), ["highlight"]);
		});
	});

	suite("values", () => {
		test("Offers the enum values of a string option", async () => {
			const items = await complete("completion-values.qmd", (d) => positionAfter(d, "mode: "));
			assert.deepStrictEqual(labelsOf(items), ["fast", "slow"]);
			assert.strictEqual(items?.[0].kind, vscode.CompletionItemKind.EnumMember);
			assert.strictEqual(items?.[0].insertText, " fast");
		});

		test("Offers true and false for a boolean option", async () => {
			const items = await complete("completion-values.qmd", (d) => positionAfter(d, "verbose: "));
			assert.deepStrictEqual(labelsOf(items), ["true", "false"]);
		});

		test("Offers the single value of a const option", async () => {
			const items = await complete("completion-values.qmd", (d) => positionAfter(d, "kind: "));
			assert.deepStrictEqual(labelsOf(items), ["fixed"]);
			assert.strictEqual(items?.[0].kind, vscode.CompletionItemKind.Constant);
		});

		test("Offers workspace files for a file option", async () => {
			const items = await complete("completion-values.qmd", (d) => positionAfter(d, "template: "));
			const labels = labelsOf(items);
			assert.ok(labels.includes("hover.qmd"), `Expected hover.qmd in ${JSON.stringify(labels)}.`);
			assert.ok(labels.every((label) => label.endsWith(".qmd")));
		});

		test("Offers values for a boolean nested in an object option", async () => {
			const items = await complete("completion-values.qmd", (d) => positionAfter(d, "strict: "));
			assert.deepStrictEqual(labelsOf(items), ["true", "false"]);
		});

		test("Offers the enum values of a format option", async () => {
			const items = await complete("completion-values.qmd", (d) => positionAfter(d, "highlight: "));
			assert.deepStrictEqual(labelsOf(items), ["plain", "bold"]);
		});

		test("Replaces the whitespace after the colon", async () => {
			const document = await openProviderFixture("completion-values.qmd");
			const position = positionAfter(document, "mode: ");
			const items = await provider.provideCompletionItems(document, position);
			const range = items?.[0].range as vscode.Range;
			assert.strictEqual(range.start.character, position.character - 1);
			assert.strictEqual(range.end.character, position.character);
		});
	});

	suite("nothing", () => {
		test("Returns nothing in the body of a Quarto document", async () => {
			const items = await complete("completion-top-level.qmd", (d) => positionAfter(d, "# Body"));
			assert.strictEqual(items, undefined);
		});

		test("Returns nothing for an extension without a schema", async () => {
			const items = await complete("completion-unmatched.qmd", (d) => endOfLineAfter(d, "missing:"));
			assert.strictEqual(items, undefined);
		});

		test("Returns nothing for a format that no schema contributes", async () => {
			const items = await complete("completion-unmatched.qmd", (d) => endOfLineAfter(d, "pdf:"));
			assert.strictEqual(items, undefined);
		});

		test("Returns nothing for a string option without a value list", async () => {
			const items = await complete("completion-values.qmd", (d) => positionAfter(d, "size: "));
			assert.strictEqual(items, undefined);
		});

		test("Returns nothing for a number option", async () => {
			const items = await complete("completion-values.qmd", (d) => positionAfter(d, "depth: "));
			assert.strictEqual(items, undefined);
		});
	});
});
