import * as assert from "assert";
import * as vscode from "vscode";
import { SchemaCache } from "@quarto-wizard/schema";
import { CellOptionCompletionProvider, CellOptionHoverProvider } from "../../providers/cellOptionCompletionProvider";
import {
	hoverText,
	labelOf,
	labelsOf,
	openProviderFixture,
	positionAt,
	releaseProviderProject,
	useProviderProject,
} from "./providerFixtures";

suite("Cell option completion", () => {
	let completion: CellOptionCompletionProvider;
	let hover: CellOptionHoverProvider;

	setup(() => {
		useProviderProject();
		const schemaCache = new SchemaCache();
		completion = new CellOptionCompletionProvider(schemaCache);
		hover = new CellOptionHoverProvider(schemaCache);
	});

	teardown(() => {
		releaseProviderProject();
	});

	async function complete(position: (document: vscode.TextDocument) => vscode.Position) {
		const document = await openProviderFixture("cells.qmd");
		return completion.provideCompletionItems(document, position(document));
	}

	suite("completion", () => {
		test("Offers the option names after the prefix of a Typst cell", async () => {
			const items = await complete((d) => positionAt(d, "//| \n#let key-cell", 4));
			const labels = labelsOf(items);
			assert.ok(labels.includes("dpi"), JSON.stringify(labels));
			assert.ok(labels.includes("format"), JSON.stringify(labels));
			assert.ok(!labels.includes("engine-mode"));
			const dpi = items?.find((item) => labelOf(item) === "dpi");
			assert.ok(dpi?.insertText instanceof vscode.SnippetString);
			assert.strictEqual(dpi.insertText.value, "dpi: ");
		});

		test("Tags a deprecated option", async () => {
			const items = await complete((d) => positionAt(d, "//| \n#let key-cell", 4));
			const old = items?.find((item) => labelOf(item) === "old");
			assert.deepStrictEqual(old?.tags, [vscode.CompletionItemTag.Deprecated]);
		});

		test("Leaves out an option that the run already sets", async () => {
			const labels = labelsOf(await complete((d) => positionAt(d, "//| \n#let occupied-cell", 4)));
			assert.ok(labels.includes("format"), JSON.stringify(labels));
			assert.ok(!labels.includes("dpi"), JSON.stringify(labels));
		});

		test("Offers the enum values after an option name", async () => {
			const items = await complete((d) => positionAt(d, "\n#let value-cell"));
			assert.deepStrictEqual(labelsOf(items), ["png", "svg", "pdf"]);
		});

		test("Offers the options of the language of the cell", async () => {
			const items = await complete((d) => positionAt(d, "#| \nx <- 1", 3));
			assert.deepStrictEqual(labelsOf(items), ["engine-mode"]);
		});

		test("Offers nothing with the wrong prefix for the language", async () => {
			const items = await complete((d) => positionAt(d, "#| \n#let wrong-prefix", 3));
			assert.ok(!items || items.length === 0);
		});

		test("Offers nothing in a class block or a bare fence", async () => {
			const classBlock = await complete((d) => positionAt(d, "//| \n#let class-block", 4));
			assert.ok(!classBlock || classBlock.length === 0);
			const bare = await complete((d) => positionAt(d, "//| \n#let bare-fence", 4));
			assert.ok(!bare || bare.length === 0);
		});

		test("Offers nothing after the option run", async () => {
			const document = await openProviderFixture("cells.qmd");
			const text = document.getText();
			const at = text.indexOf("#let after-run");
			const afterRun = text.indexOf("//| \n```", at) + 4;
			const items = await completion.provideCompletionItems(document, document.positionAt(afterRun));
			assert.ok(!items || items.length === 0);
		});
	});

	suite("hover", () => {
		test("Describes an option and names its extension", async () => {
			const document = await openProviderFixture("cells.qmd");
			const found = await hover.provideHover(document, positionAt(document, "//| dpi: 300", 5));
			const text = hoverText(found);
			assert.ok(text.includes("Dots per inch."), text);
			assert.ok(text.includes("Demo"), text);
		});

		test("Describes the option when the cursor is on its value", async () => {
			const document = await openProviderFixture("cells.qmd");
			const found = await hover.provideHover(document, positionAt(document, "//| dpi: 300", 10));
			assert.ok(hoverText(found).includes("Dots per inch."));
		});

		test("Says nothing outside the option run", async () => {
			const document = await openProviderFixture("cells.qmd");
			const found = await hover.provideHover(document, positionAt(document, "#let used-cell", 6));
			assert.strictEqual(found, null);
		});
	});
});
