import * as assert from "assert";
import * as path from "node:path";
import * as vscode from "vscode";
import { SchemaCache } from "@quarto-wizard/schema";
import { registerYamlProviders } from "../../providers/registerYamlProviders";
import { invalidateInstalledExtensionsCache } from "../../utils/installedExtensionsCache";
import { invalidateProjectRoots, setProjectRoots } from "../../utils/projectRootsRegistry";
import { invalidateWorkspaceSchemaIndex } from "../../utils/workspaceSchemaIndex";
import { makeRoot } from "./projectFixtures";

const FIXTURES = path.resolve(__dirname, "..", "..", "..", "test-fixtures", "schema-diagnostics");
const DOCUMENT = path.join(FIXTURES, "hover", "_metadata.yml");
const COMPLETION_DOCUMENT = path.join(FIXTURES, "complete", "_metadata.yml");

suite("Register YAML Providers", () => {
	let context: vscode.ExtensionContext;

	setup(() => {
		const folder = vscode.workspace.workspaceFolders?.[0];
		assert.ok(folder, "The test workspace folder is missing.");
		invalidateInstalledExtensionsCache();
		invalidateWorkspaceSchemaIndex();
		setProjectRoots([makeRoot(folder)]);
		context = { subscriptions: [] as vscode.Disposable[] } as vscode.ExtensionContext;
		registerYamlProviders(context, new SchemaCache());
	});

	teardown(() => {
		for (const disposable of context.subscriptions) {
			disposable.dispose();
		}
		invalidateInstalledExtensionsCache();
		invalidateWorkspaceSchemaIndex();
		invalidateProjectRoots();
	});

	test("Hands every registration to the extension context", () => {
		assert.ok(context.subscriptions.length >= 10, `Only ${context.subscriptions.length} subscriptions.`);
		assert.ok(context.subscriptions.every((disposable) => typeof disposable.dispose === "function"));
	});

	test("Serves schema hovers on a metadata file", async () => {
		const uri = vscode.Uri.file(DOCUMENT);
		const document = await vscode.workspace.openTextDocument(uri);
		const position = document.positionAt(document.getText().indexOf("repository-name") + 1);
		const hovers = await vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", uri, position);
		const text = hovers.flatMap((hover) => hover.contents.map((c) => (typeof c === "string" ? c : c.value))).join("\n");
		assert.ok(text.includes("GitHub repository in 'owner/repo' format"), text);
	});

	test("Serves schema completions on a metadata file", async () => {
		const uri = vscode.Uri.file(COMPLETION_DOCUMENT);
		const document = await vscode.workspace.openTextDocument(uri);
		const position = document.lineAt(3).range.end;
		const list = await vscode.commands.executeCommand<vscode.CompletionList>(
			"vscode.executeCompletionItemProvider",
			uri,
			position,
		);
		const labels = list.items.map((item) => (typeof item.label === "string" ? item.label : item.label.label));
		assert.ok(labels.includes("base-url"), JSON.stringify(labels));
	});
});
