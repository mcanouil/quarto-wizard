import * as assert from "assert";
import * as vscode from "vscode";
import { SnippetItemTreeItem } from "../../ui/extensionTreeItems";
import type { SnippetDefinition } from "@quarto-wizard/snippets";

suite("Insert Snippet Test Suite", () => {
	test("SnippetItemTreeItem stores definition", () => {
		const definition: SnippetDefinition = {
			prefix: "hello",
			body: "Hello, world!",
			description: "A greeting snippet",
		};
		const item = new SnippetItemTreeItem("Hello", definition, "ext");
		assert.deepStrictEqual(item.definition, definition);
	});

	test("SnippetItemTreeItem has correct command property", () => {
		const definition: SnippetDefinition = {
			prefix: "test",
			body: ["line1", "line2"],
		};
		const item = new SnippetItemTreeItem("Test", definition, "ext");
		assert.ok(item.command, "TreeItem should have a command");
		assert.strictEqual(item.command.command, "quartoWizard.extensionsInstalled.insertSnippet");
		assert.strictEqual(item.command.title, "Insert Snippet");
		assert.ok(Array.isArray(item.command.arguments), "Command should have arguments");
		assert.deepStrictEqual(item.command.arguments![0], definition);
	});

	test("SnippetItemTreeItem command arguments are serialisable", () => {
		const definition: SnippetDefinition = {
			prefix: "test",
			body: "some body",
		};
		const item = new SnippetItemTreeItem("Test", definition, "ext");

		// Verify no circular references by ensuring JSON serialisation succeeds
		const serialised = JSON.stringify(item.command!.arguments);
		assert.ok(serialised, "Arguments should be JSON-serialisable");

		const parsed = JSON.parse(serialised) as SnippetDefinition[];
		assert.strictEqual(parsed[0].body, "some body");
	});

	test("String body is passed as-is in command arguments", () => {
		const definition: SnippetDefinition = {
			prefix: "greet",
			body: "Hello!",
		};
		const item = new SnippetItemTreeItem("Greeting", definition, "ext");
		const arg = item.command!.arguments![0] as SnippetDefinition;
		assert.strictEqual(arg.body, "Hello!");
	});

	test("Array body is preserved in command arguments", () => {
		const definition: SnippetDefinition = {
			prefix: "multi",
			body: ["line1", "line2", "line3"],
		};
		const item = new SnippetItemTreeItem("Multi", definition, "ext");
		const arg = item.command!.arguments![0] as SnippetDefinition;
		assert.ok(Array.isArray(arg.body));

		const body = (arg.body as string[]).join("\n");
		assert.strictEqual(body, "line1\nline2\nline3");
	});

	test("Snippet tooltip includes description and body preview", () => {
		const definition: SnippetDefinition = {
			prefix: "greet",
			body: "Hello, ${1:world}!\nBye.",
			description: "Greeting snippet",
		};
		const item = new SnippetItemTreeItem("Greeting", definition, "ext");
		assert.ok(item.tooltip instanceof vscode.MarkdownString);
		assert.ok(item.tooltip.value.includes("Greeting snippet"));
		assert.ok(item.tooltip.value.includes("```markdown"));
		assert.ok(item.tooltip.value.includes("Hello, ${1:world}!"));
		assert.ok(item.tooltip.value.includes("Bye."));
	});

	test("Snippet tooltip truncates long previews", () => {
		const definition: SnippetDefinition = {
			prefix: "long",
			body: Array.from({ length: 16 }, (_, i) => String(i + 1)),
		};
		const item = new SnippetItemTreeItem("Long", definition, "ext");
		assert.ok(item.tooltip instanceof vscode.MarkdownString);
		assert.ok(item.tooltip.value.includes("_(Preview truncated)_"));
		assert.ok(item.tooltip.value.includes("15"));
		assert.ok(!item.tooltip.value.includes("16"));
	});

	test("Insert snippet into active editor via insertSnippet API", async () => {
		const doc = await vscode.workspace.openTextDocument({ content: "", language: "markdown" });
		const editor = await vscode.window.showTextDocument(doc);

		const body = "Hello, snippet!";
		await editor.insertSnippet(new vscode.SnippetString(body));

		assert.strictEqual(editor.document.getText(), "Hello, snippet!");
	});

	test("Insert multi-line snippet into active editor via insertSnippet API", async () => {
		const doc = await vscode.workspace.openTextDocument({ content: "", language: "markdown" });
		const editor = await vscode.window.showTextDocument(doc);

		const lines = ["line1", "line2", "line3"];
		const body = lines.join("\n");
		await editor.insertSnippet(new vscode.SnippetString(body));

		// Normalise line endings for cross-platform compatibility (Windows uses \r\n)
		const text = editor.document.getText().replace(/\r\n/g, "\n");
		assert.strictEqual(text, "line1\nline2\nline3");
	});

	test("Insert snippet on non-empty line inserts on a new line", async () => {
		const doc = await vscode.workspace.openTextDocument({ content: "existing content", language: "markdown" });
		const editor = await vscode.window.showTextDocument(doc);

		// Place cursor in the middle of the existing line
		editor.selection = new vscode.Selection(new vscode.Position(0, 5), new vscode.Position(0, 5));

		const definition: SnippetDefinition = {
			prefix: "test",
			body: "inserted snippet",
		};

		await vscode.commands.executeCommand("quartoWizard.extensionsInstalled.insertSnippet", definition);

		const text = editor.document.getText().replace(/\r\n/g, "\n");
		const lines = text.split("\n");
		assert.strictEqual(lines[0], "existing content", "Original non-empty line should remain unchanged");
		assert.strictEqual(lines[1], "inserted snippet", "Snippet should be appended on a new line");
		assert.strictEqual(lines.length, 2, "Inserting on non-empty line should not split the existing line");
	});

	test("Insert snippet on empty line inserts at cursor position", async () => {
		const doc = await vscode.workspace.openTextDocument({ content: "", language: "markdown" });
		const editor = await vscode.window.showTextDocument(doc);

		editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0));

		const definition: SnippetDefinition = {
			prefix: "test",
			body: "inserted snippet",
		};

		await vscode.commands.executeCommand("quartoWizard.extensionsInstalled.insertSnippet", definition);

		const text = editor.document.getText().replace(/\r\n/g, "\n");
		assert.strictEqual(text, "inserted snippet");
	});
});
