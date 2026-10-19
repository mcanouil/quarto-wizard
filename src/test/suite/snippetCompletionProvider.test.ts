import * as assert from "assert";
import * as vscode from "vscode";
import { SnippetCache } from "@quarto-wizard/snippets";
import { registerSnippetCompletionProvider } from "../../providers/snippetCompletionProvider";
import { invalidateProjectRoots, setProjectRoots } from "../../utils/projectRootsRegistry";
import {
	labelOf,
	openProviderFixture,
	positionAfter,
	releaseProviderProject,
	useProviderProject,
} from "./providerFixtures";

suite("Snippet Completion Provider", () => {
	const registered: vscode.CompletionItemProvider[] = [];
	let disposables: vscode.Disposable[];

	setup(() => {
		useProviderProject();
		const context = { subscriptions: [] as vscode.Disposable[] } as vscode.ExtensionContext;
		const original = vscode.languages.registerCompletionItemProvider;
		(vscode.languages as { registerCompletionItemProvider: unknown }).registerCompletionItemProvider = (
			_selector: vscode.DocumentSelector,
			provider: vscode.CompletionItemProvider,
		) => {
			registered.push(provider);
			return new vscode.Disposable(() => undefined);
		};
		try {
			registerSnippetCompletionProvider(context, new SnippetCache());
		} finally {
			(vscode.languages as { registerCompletionItemProvider: unknown }).registerCompletionItemProvider = original;
		}
		disposables = context.subscriptions;
	});

	teardown(() => {
		registered.length = 0;
		for (const disposable of disposables) {
			disposable.dispose();
		}
		releaseProviderProject();
	});

	async function complete(position: (document: vscode.TextDocument) => vscode.Position) {
		const document = await openProviderFixture("snippets.qmd");
		return registered[0].provideCompletionItems(
			document,
			position(document),
			new vscode.CancellationTokenSource().token,
			{ triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined },
		) as Promise<vscode.CompletionItem[] | null>;
	}

	test("Offers every snippet prefix, qualified by the extension namespace", async () => {
		const items = await complete((d) => positionAfter(d, "# Snippets\n"));
		assert.deepStrictEqual(items?.map(labelOf).sort(), ["acme-demo:box", "acme-demo:demo-box", "acme-demo:widget"]);
	});

	test("Builds snippet items from the snippet definition", async () => {
		const items = await complete((d) => positionAfter(d, "# Snippets\n"));
		const widget = items?.find((item) => labelOf(item) === "acme-demo:widget");
		assert.strictEqual(widget?.kind, vscode.CompletionItemKind.Snippet);
		assert.strictEqual(widget?.detail, "Demo widget (demo)");
		assert.ok(widget?.insertText instanceof vscode.SnippetString);
		assert.strictEqual((widget.insertText as vscode.SnippetString).value, "{{< demo ${1:alpha} >}}");
		assert.strictEqual((widget.documentation as vscode.MarkdownString).value, "Insert a demo widget");
		assert.strictEqual(widget.sortText, "~snippet_acme-demo:widget");
	});

	test("Joins a multi-line body and offers one item per prefix", async () => {
		const items = await complete((d) => positionAfter(d, "# Snippets\n"));
		const box = items?.filter((item) => item.detail === "Demo box (demo)");
		assert.strictEqual(box?.length, 2);
		assert.strictEqual((box?.[0].insertText as vscode.SnippetString).value, ":::: {.demo-box}\n$0\n::::");
	});

	test("Offers snippets on a blank line and at the end of a line", async () => {
		const blank = await complete((d) => positionAfter(d, "# Snippets\n"));
		const endOfLine = await complete((d) => positionAfter(d, "word"));
		assert.ok(blank && blank.length > 0);
		assert.ok(endOfLine && endOfLine.length > 0);
	});

	test("Returns nothing when the cursor is in front of a word character", async () => {
		const items = await complete((d) => positionAfter(d, "\nword").translate(0, -4));
		assert.strictEqual(items, null);
	});

	test("Returns nothing when no extension has snippets", async () => {
		invalidateProjectRoots();
		setProjectRoots([]);
		const items = await complete((d) => positionAfter(d, "# Snippets\n"));
		assert.strictEqual(items, null);
	});
});
