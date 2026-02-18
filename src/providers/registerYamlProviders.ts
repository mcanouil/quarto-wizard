import * as vscode from "vscode";
import * as path from "node:path";
import type { SchemaCache } from "@quarto-wizard/schema";
import { YamlCompletionProvider, YAML_DOCUMENT_SELECTOR } from "./yamlCompletionProvider";
import { YamlDiagnosticsProvider } from "./yamlDiagnosticsProvider";
import { YamlHoverProvider } from "./yamlHoverProvider";
import { SchemaDiagnosticsProvider } from "./schemaDiagnosticsProvider";
import { SchemaDefinitionCompletionProvider, SCHEMA_DEFINITION_SELECTOR } from "./schemaDefinitionCompletionProvider";
import { debounce } from "../utils/debounce";
import { isInYamlRegion } from "../utils/yamlPosition";
import { logMessage } from "../utils/log";

/**
 * Check whether a document matches one of the YAML document selectors
 * used by completion providers.
 */
function matchesYamlSelector(document: vscode.TextDocument): boolean {
	return (
		vscode.languages.match(YAML_DOCUMENT_SELECTOR, document) > 0 ||
		vscode.languages.match(SCHEMA_DEFINITION_SELECTOR, document) > 0
	);
}

/**
 * Register YAML completion and diagnostics providers for Quarto
 * extension schemas, and set up a file watcher that invalidates the
 * schema cache when schema files change.
 *
 * @param context - The VS Code extension context.
 * @param schemaCache - Shared schema cache instance.
 */
export function registerYamlProviders(context: vscode.ExtensionContext, schemaCache: SchemaCache): void {
	// Register completion provider with trigger characters for proactive suggestions.
	const completionProvider = new YamlCompletionProvider(schemaCache);
	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(YAML_DOCUMENT_SELECTOR, completionProvider, ":", "\n", " "),
	);

	// Register hover provider.
	const hoverProvider = new YamlHoverProvider(schemaCache);
	context.subscriptions.push(vscode.languages.registerHoverProvider(YAML_DOCUMENT_SELECTOR, hoverProvider));

	// Register diagnostics provider for user documents (_quarto.yml, .qmd).
	const diagnosticsProvider = new YamlDiagnosticsProvider(schemaCache);
	context.subscriptions.push(diagnosticsProvider);

	// Register diagnostics provider for schema definition files (_schema.yml, _schema.json).
	const schemaDiagnosticsProvider = new SchemaDiagnosticsProvider();
	context.subscriptions.push(schemaDiagnosticsProvider);

	// Register completion provider for schema definition YAML files.
	const schemaDefinitionCompletionProvider = new SchemaDefinitionCompletionProvider();
	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(
			SCHEMA_DEFINITION_SELECTOR,
			schemaDefinitionCompletionProvider,
			":",
			"\n",
			" ",
		),
	);

	// Re-trigger suggestions on backspace.  Backspace is not a valid
	// trigger character, so we listen for text document changes that
	// look like single-character deletions and re-invoke the suggest
	// widget after a short debounce.
	const retriggerSuggest = debounce(() => {
		vscode.commands.executeCommand("editor.action.triggerSuggest");
	}, 50);
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument((event) => {
			if (!matchesYamlSelector(event.document)) {
				return;
			}
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document !== event.document) {
				return;
			}
			const isDeletion =
				event.contentChanges.length === 1 &&
				event.contentChanges[0].text === "" &&
				event.contentChanges[0].rangeLength > 0;
			if (!isDeletion) {
				return;
			}
			const lines = event.document.getText().split("\n");
			const cursorLine = editor.selection.active.line;
			if (isInYamlRegion(lines, cursorLine, event.document.languageId)) {
				retriggerSuggest();
			}
		}),
	);
	context.subscriptions.push({ dispose: () => retriggerSuggest.cancel() });

	// Watch for schema file changes to invalidate the cache and revalidate.
	const schemaWatcher = vscode.workspace.createFileSystemWatcher("**/_schema.{yml,yaml,json}");
	const invalidateAndRevalidate = (uri: vscode.Uri) => {
		const dir = path.normalize(vscode.Uri.joinPath(uri, "..").fsPath);
		schemaCache.invalidate(dir);
		diagnosticsProvider.revalidateAll();
		schemaDiagnosticsProvider.revalidateAll();
		logMessage(`Schema cache invalidated for ${dir}.`, "debug");
	};

	context.subscriptions.push(schemaWatcher.onDidChange(invalidateAndRevalidate));
	context.subscriptions.push(schemaWatcher.onDidCreate(invalidateAndRevalidate));
	context.subscriptions.push(schemaWatcher.onDidDelete(invalidateAndRevalidate));
	context.subscriptions.push(schemaWatcher);

	logMessage("YAML completion, hover, and diagnostics providers registered.", "debug");
}
