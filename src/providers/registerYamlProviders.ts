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
import { findOwningProjectRoot, findOwningProjectRootSync } from "../utils/projectRootsRegistry";
import { invalidateMetadataFiles, isQmdFile, refreshSource } from "../utils/metadataFilesRegistry";

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
		const owningRoot = uri.scheme === "file" ? findOwningProjectRootSync(uri.fsPath) : undefined;
		if (owningRoot) {
			invalidateWorkspaceSchemaIndex(owningRoot);
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

	const applyMetadataChange = (owningRoot: string) => {
		invalidateWorkspaceSchemaIndex(owningRoot);
		diagnosticsProvider.revalidateAll();
	};

	// Watch Quarto config sources for changes in `metadata-files:` entries.
	const metadataSourceWatcher = vscode.workspace.createFileSystemWatcher("**/_{quarto,metadata}.{yml,yaml}");
	const refreshMetadataSource = async (uri: vscode.Uri) => {
		if (uri.scheme !== "file") {
			return;
		}
		const owningRoot = findOwningProjectRootSync(uri.fsPath);
		if (!owningRoot) {
			return;
		}
		const changed = await refreshSource(owningRoot, uri.fsPath);
		if (!changed) {
			return;
		}
		applyMetadataChange(owningRoot);
		logMessage(`Metadata-files registry refreshed for ${uri.fsPath}.`, "debug");
	};
	context.subscriptions.push(metadataSourceWatcher.onDidChange(refreshMetadataSource));
	context.subscriptions.push(metadataSourceWatcher.onDidCreate(refreshMetadataSource));
	context.subscriptions.push(metadataSourceWatcher.onDidDelete(refreshMetadataSource));
	context.subscriptions.push(metadataSourceWatcher);

	// `.qmd` front-matter can also list metadata-files; refresh on save/open.
	// Uses the async project-root lookup so first-open during activation succeeds
	// before tree-view discovery has populated the sync snapshot.
	const refreshQmdSource = async (document: vscode.TextDocument): Promise<string | undefined> => {
		if (document.uri.scheme !== "file") {
			return undefined;
		}
		if (document.languageId !== "quarto" && !isQmdFile(document.fileName)) {
			return undefined;
		}
		const owningRoot = await findOwningProjectRoot(document.uri);
		if (!owningRoot) {
			return undefined;
		}
		const changed = await refreshSource(owningRoot, document.uri.fsPath);
		return changed ? owningRoot : undefined;
	};
	const refreshQmdAndInvalidate = async (document: vscode.TextDocument) => {
		const changedRoot = await refreshQmdSource(document);
		if (changedRoot) {
			applyMetadataChange(changedRoot);
		}
	};
	context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(refreshQmdAndInvalidate));
	context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(refreshQmdAndInvalidate));

	// Prime the registry from already-open .qmd documents in one batched pass:
	// invalidate each affected root once instead of N times.
	void (async () => {
		const results = await Promise.all(vscode.workspace.textDocuments.map(refreshQmdSource));
		const changedRoots = new Set<string>();
		for (const root of results) {
			if (root) {
				changedRoots.add(root);
			}
		}
		for (const root of changedRoots) {
			invalidateWorkspaceSchemaIndex(root);
		}
		if (changedRoots.size > 0) {
			diagnosticsProvider.revalidateAll();
		}
	})();

	// Workspace folder changes can invalidate project-root identity; rebuild lazily.
	context.subscriptions.push(
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			invalidateMetadataFiles();
		}),
	);

	logMessage("YAML completion, hover, and diagnostics providers registered.", "debug");
}
