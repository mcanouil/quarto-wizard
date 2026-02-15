import * as vscode from "vscode";
import { SchemaCache } from "@quarto-wizard/core";
import { YamlCompletionProvider, YAML_DOCUMENT_SELECTOR } from "./yamlCompletionProvider";
import { YamlDiagnosticsProvider } from "./yamlDiagnosticsProvider";
import { logMessage } from "../utils/log";

/**
 * Register YAML completion and diagnostics providers for Quarto
 * extension schemas, and set up a file watcher that invalidates the
 * schema cache when _schema.yml files change.
 *
 * @param context - The VS Code extension context.
 */
export function registerYamlProviders(context: vscode.ExtensionContext): void {
	const schemaCache = new SchemaCache();

	// Register completion provider.
	const completionProvider = new YamlCompletionProvider(schemaCache);
	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(YAML_DOCUMENT_SELECTOR, completionProvider),
	);

	// Register diagnostics provider.
	const diagnosticsProvider = new YamlDiagnosticsProvider(schemaCache);
	context.subscriptions.push(diagnosticsProvider);

	// Watch for _schema.yml changes to invalidate the cache and revalidate.
	const schemaWatcher = vscode.workspace.createFileSystemWatcher("**/_schema.{yml,yaml}");
	const invalidateAndRevalidate = (uri: vscode.Uri) => {
		const dir = vscode.Uri.joinPath(uri, "..").fsPath;
		schemaCache.invalidate(dir);
		diagnosticsProvider.revalidateAll();
		logMessage(`Schema cache invalidated for ${dir}.`, "debug");
	};

	schemaWatcher.onDidChange(invalidateAndRevalidate);
	schemaWatcher.onDidCreate(invalidateAndRevalidate);
	schemaWatcher.onDidDelete(invalidateAndRevalidate);
	context.subscriptions.push(schemaWatcher);

	logMessage("YAML completion and diagnostics providers registered.", "info");
}
