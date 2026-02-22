import * as vscode from "vscode";
import * as path from "node:path";
import type { SchemaCache } from "@quarto-wizard/schema";
import { YamlCompletionProvider, YAML_DOCUMENT_SELECTOR } from "./yamlCompletionProvider";
import { YamlDiagnosticsProvider } from "./yamlDiagnosticsProvider";
import { YamlHoverProvider } from "./yamlHoverProvider";
import { SchemaDiagnosticsProvider } from "./schemaDiagnosticsProvider";
import { SchemaDefinitionCompletionProvider, SCHEMA_DEFINITION_SELECTOR } from "./schemaDefinitionCompletionProvider";
import { logMessage } from "../utils/log";
import { invalidateWorkspaceSchemaIndex } from "../utils/workspaceSchemaIndex";

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

	// Watch for schema file changes to invalidate the cache and revalidate.
	const schemaWatcher = vscode.workspace.createFileSystemWatcher("**/_schema.{yml,yaml,json}");
	const invalidateAndRevalidate = (uri: vscode.Uri) => {
		const dir = path.normalize(vscode.Uri.joinPath(uri, "..").fsPath);
		schemaCache.invalidate(dir);
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
		if (workspaceFolder) {
			invalidateWorkspaceSchemaIndex(workspaceFolder.uri.fsPath);
		} else {
			invalidateWorkspaceSchemaIndex();
		}
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
