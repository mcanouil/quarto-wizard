import * as assert from "assert";
import * as path from "node:path";
import * as vscode from "vscode";
import { SchemaCache } from "@quarto-wizard/schema";
import { registerYamlProviders } from "../../providers/registerYamlProviders";
import { SCHEMA_DEFINITION_SELECTOR } from "../../providers/schemaDefinitionCompletionProvider";
import { YAML_DOCUMENT_SELECTOR } from "../../providers/yamlCompletionProvider";
import { invalidateInstalledExtensionsCache } from "../../utils/installedExtensionsCache";
import { invalidateProjectRoots, setProjectRoots } from "../../utils/projectRootsRegistry";
import { invalidateWorkspaceSchemaIndex } from "../../utils/workspaceSchemaIndex";
import { makeRoot } from "./projectFixtures";

const FIXTURES = path.resolve(__dirname, "..", "..", "..", "test-fixtures", "schema-diagnostics");
const HOVER_DOCUMENT = path.join(FIXTURES, "hover", "_metadata.yml");
const COMPLETION_DOCUMENT = path.join(FIXTURES, "complete", "_metadata.yml");

interface CompletionRegistration {
	selector: vscode.DocumentSelector;
	provider: vscode.CompletionItemProvider;
	triggers: string[];
}

interface HoverRegistration {
	selector: vscode.DocumentSelector;
	provider: vscode.HoverProvider;
}

suite("Register YAML Providers", () => {
	const languages = vscode.languages as unknown as Record<string, unknown>;
	const originalCompletion = languages.registerCompletionItemProvider;
	const originalHover = languages.registerHoverProvider;
	let context: vscode.ExtensionContext;
	let completions: CompletionRegistration[];
	let hovers: HoverRegistration[];

	setup(() => {
		const folder = vscode.workspace.workspaceFolders?.[0];
		assert.ok(folder, "The test workspace folder is missing.");
		invalidateInstalledExtensionsCache();
		invalidateWorkspaceSchemaIndex();
		setProjectRoots([makeRoot(folder)]);

		completions = [];
		hovers = [];
		languages.registerCompletionItemProvider = (
			selector: vscode.DocumentSelector,
			provider: vscode.CompletionItemProvider,
			...triggers: string[]
		) => {
			completions.push({ selector, provider, triggers });
			return (originalCompletion as typeof vscode.languages.registerCompletionItemProvider)(
				selector,
				provider,
				...triggers,
			);
		};
		languages.registerHoverProvider = (selector: vscode.DocumentSelector, provider: vscode.HoverProvider) => {
			hovers.push({ selector, provider });
			return (originalHover as typeof vscode.languages.registerHoverProvider)(selector, provider);
		};

		context = { subscriptions: [] as vscode.Disposable[] } as vscode.ExtensionContext;
		try {
			registerYamlProviders(context, new SchemaCache());
		} finally {
			languages.registerCompletionItemProvider = originalCompletion;
			languages.registerHoverProvider = originalHover;
		}
	});

	teardown(() => {
		for (const disposable of context.subscriptions) {
			disposable.dispose();
		}
		invalidateInstalledExtensionsCache();
		invalidateWorkspaceSchemaIndex();
		invalidateProjectRoots();
	});

	test("Registers the user document completion provider with its trigger characters", () => {
		const registration = completions.find((entry) => entry.selector === YAML_DOCUMENT_SELECTOR);
		assert.ok(registration, "No completion provider for YAML_DOCUMENT_SELECTOR.");
		assert.deepStrictEqual(registration.triggers, [":", "\n", " "]);
	});

	test("Registers the schema definition completion provider with its trigger characters", () => {
		const registration = completions.find((entry) => entry.selector === SCHEMA_DEFINITION_SELECTOR);
		assert.ok(registration, "No completion provider for SCHEMA_DEFINITION_SELECTOR.");
		assert.deepStrictEqual(registration.triggers, [":", "\n", " "]);
	});

	test("Registers exactly two completion providers and one hover provider", () => {
		assert.strictEqual(completions.length, 2);
		assert.strictEqual(hovers.length, 1);
		assert.strictEqual(hovers[0].selector, YAML_DOCUMENT_SELECTOR);
	});

	test("Hands the registrations to the extension context", () => {
		assert.ok(context.subscriptions.length > 0);
		assert.ok(context.subscriptions.every((disposable) => typeof disposable.dispose === "function"));
	});

	test("The registered hover provider describes a schema option", async () => {
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(HOVER_DOCUMENT));
		const position = document.positionAt(document.getText().indexOf("repository-name") + 1);
		const hover = await hovers[0].provider.provideHover(document, position, new vscode.CancellationTokenSource().token);
		const contents = (hover as vscode.Hover).contents.map((c) => (typeof c === "string" ? c : c.value)).join("\n");
		assert.ok(contents.includes("GitHub repository in 'owner/repo' format"), contents);
	});

	test("The registered hover provider returns nothing for an option the schema does not define", async () => {
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(HOVER_DOCUMENT));
		const position = document.positionAt(document.getText().indexOf("unknown-key") + 1);
		const hover = await hovers[0].provider.provideHover(document, position, new vscode.CancellationTokenSource().token);
		assert.ok(!hover);
	});

	test("The registered completion provider offers the remaining options", async () => {
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(COMPLETION_DOCUMENT));
		const registration = completions.find((entry) => entry.selector === YAML_DOCUMENT_SELECTOR);
		const items = await registration?.provider.provideCompletionItems(
			document,
			document.lineAt(3).range.end,
			new vscode.CancellationTokenSource().token,
			{ triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined },
		);
		const labels = (items as vscode.CompletionItem[]).map((item) =>
			typeof item.label === "string" ? item.label : item.label.label,
		);
		assert.ok(labels.includes("base-url"), JSON.stringify(labels));
		assert.ok(!labels.includes("repository-name"));
	});

	test("The registered completion provider returns nothing for an option the schema does not define", async () => {
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(HOVER_DOCUMENT));
		const registration = completions.find((entry) => entry.selector === YAML_DOCUMENT_SELECTOR);
		const items = await registration?.provider.provideCompletionItems(
			document,
			document.lineAt(3).range.end,
			new vscode.CancellationTokenSource().token,
			{ triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined },
		);
		assert.ok(!items);
	});
});
