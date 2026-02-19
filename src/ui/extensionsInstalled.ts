import * as vscode from "vscode";
import * as path from "node:path";
import type { SchemaCache } from "@quarto-wizard/schema";
import type { SnippetCache, SnippetDefinition } from "@quarto-wizard/snippets";
import { normaliseVersion } from "@quarto-wizard/core";
import { logMessage, showMessageWithLogs } from "../utils/log";
import { removeQuartoExtension, removeQuartoExtensions, installQuartoExtension } from "../utils/quarto";
import { withProgressNotification } from "../utils/withProgressNotification";
import { installQuartoExtensionFolderCommand } from "../commands/installQuartoExtension";
import { getAuthConfig } from "../utils/auth";
import { WorkspaceFolderTreeItem, ExtensionTreeItem, SnippetItemTreeItem } from "./extensionTreeItems";
import { QuartoExtensionTreeDataProvider } from "./extensionTreeDataProvider";

/**
 * Manages the installed Quarto extensions.
 * Sets up the tree data provider and registers the necessary commands.
 */
export class ExtensionsInstalled {
	private treeDataProvider!: QuartoExtensionTreeDataProvider;

	/**
	 * Initialises the extensions view and sets up the tree data provider and commands.
	 *
	 * @param context - The extension context.
	 */
	private initialise(context: vscode.ExtensionContext, schemaCache: SchemaCache, snippetCache: SnippetCache) {
		const workspaceFolders = vscode.workspace.workspaceFolders || [];
		if (workspaceFolders.length === 0) {
			logMessage("No workspace folders open. Extensions view not initialised.", "debug");
			return;
		}

		this.treeDataProvider = new QuartoExtensionTreeDataProvider(workspaceFolders, schemaCache, snippetCache);
		context.subscriptions.push(this.treeDataProvider);
		const view = vscode.window.createTreeView("quartoWizard.extensionsInstalled", {
			treeDataProvider: this.treeDataProvider,
			showCollapseAll: true,
		});

		// Initial setup with update check and refresh
		this.treeDataProvider.refreshAfterAction(context, view);

		const visibilityDisposable = view.onDidChangeVisibility((e) => {
			if (e.visible) {
				this.treeDataProvider.refreshAfterAction(context, view);
			}
		});
		context.subscriptions.push(visibilityDisposable);

		// Watch for changes to _extensions directories for real-time tree view updates
		const extensionWatcher = vscode.workspace.createFileSystemWatcher("**/_extensions/**/_extension.{yml,yaml}");
		context.subscriptions.push(extensionWatcher.onDidCreate(() => this.treeDataProvider.refresh()));
		context.subscriptions.push(extensionWatcher.onDidDelete(() => this.treeDataProvider.refresh()));
		context.subscriptions.push(extensionWatcher.onDidChange(() => this.treeDataProvider.refresh()));
		context.subscriptions.push(extensionWatcher);

		// Watch for changes to schema files for real-time tree view updates
		const schemaWatcher = vscode.workspace.createFileSystemWatcher("**/_extensions/**/_schema.{yml,yaml,json}");
		const invalidateSchemaAndRefresh = (uri: vscode.Uri) => {
			schemaCache.invalidate(path.dirname(uri.fsPath));
			this.treeDataProvider.refresh();
		};
		context.subscriptions.push(schemaWatcher.onDidCreate(invalidateSchemaAndRefresh));
		context.subscriptions.push(schemaWatcher.onDidDelete(invalidateSchemaAndRefresh));
		context.subscriptions.push(schemaWatcher.onDidChange(invalidateSchemaAndRefresh));
		context.subscriptions.push(schemaWatcher);

		// Watch for changes to snippet files for real-time tree view updates
		const snippetWatcher = vscode.workspace.createFileSystemWatcher("**/_extensions/**/_snippets.json");
		const invalidateSnippetAndRefresh = (uri: vscode.Uri) => {
			snippetCache.invalidate(path.dirname(uri.fsPath));
			this.treeDataProvider.refresh();
		};
		context.subscriptions.push(snippetWatcher.onDidCreate(invalidateSnippetAndRefresh));
		context.subscriptions.push(snippetWatcher.onDidDelete(invalidateSnippetAndRefresh));
		context.subscriptions.push(snippetWatcher.onDidChange(invalidateSnippetAndRefresh));
		context.subscriptions.push(snippetWatcher);

		context.subscriptions.push(view);
		context.subscriptions.push(
			vscode.commands.registerCommand("quartoWizard.extensionsInstalled.refresh", () => {
				this.treeDataProvider.refreshAfterAction(context, view);
			}),
		);

		context.subscriptions.push(
			vscode.commands.registerCommand("quartoWizard.extensionsInstalled.openSource", (item: ExtensionTreeItem) => {
				if (item.repository) {
					const url = `https://github.com/${item.repository}`;
					void vscode.env.openExternal(vscode.Uri.parse(url));
				}
			}),
		);

		context.subscriptions.push(
			vscode.commands.registerCommand("quartoWizard.extensionsInstalled.install", async (item: ExtensionTreeItem) => {
				await installQuartoExtensionFolderCommand(context, item.workspaceFolder, false);
				this.treeDataProvider.refreshAfterAction(context, view);
			}),
		);

		context.subscriptions.push(
			vscode.commands.registerCommand(
				"quartoWizard.extensionsInstalled.useTemplate",
				async (item: ExtensionTreeItem) => {
					await installQuartoExtensionFolderCommand(context, item.workspaceFolder, true);
					this.treeDataProvider.refreshAfterAction(context, view);
				},
			),
		);

		/**
		 * Updates a Quarto extension to the latest version.
		 * Uses the source repository information from the extension manifest.
		 */
		context.subscriptions.push(
			vscode.commands.registerCommand("quartoWizard.extensionsInstalled.update", async (item: ExtensionTreeItem) => {
				const latestVersion = item.latestVersion;
				const latestSemver = latestVersion ? (normaliseVersion(latestVersion) ?? latestVersion) : undefined;
				const auth = await getAuthConfig(context);
				// result is true (success), false (failure), or null (cancelled)
				const result = await withProgressNotification(
					`Updating "${item.repository ?? item.label}" to ${latestSemver} ...`,
					async (token) => {
						const versionSuffix = latestVersion ? `@${latestVersion}` : "";
						return installQuartoExtension(
							`${item.repository ?? item.label}${versionSuffix}`,
							item.workspaceFolder,
							auth,
							undefined,
							true, // skipOverwritePrompt - updates are expected to overwrite
							token,
						);
					},
				);
				if (result === true) {
					vscode.window.showInformationMessage(`Extension "${item.label}" updated successfully.`);
					this.treeDataProvider.refreshAfterAction(context, view);
				} else if (result === false) {
					// Only show error for actual failures, not cancellations
					if (!item.repository) {
						showMessageWithLogs(
							`Failed to update extension "${item.label}". Source not found in extension manifest.`,
							"error",
						);
					} else {
						showMessageWithLogs(`Failed to update extension "${item.label}".`, "error");
					}
				}
				// result === null means cancelled by user, no message needed
			}),
		);

		/**
		 * Removes a Quarto extension from the workspace.
		 * Deletes the extension directory and refreshes the view.
		 */
		context.subscriptions.push(
			vscode.commands.registerCommand("quartoWizard.extensionsInstalled.remove", async (item: ExtensionTreeItem) => {
				const success = await withProgressNotification(`Removing "${item.label}" ...`, async () => {
					return removeQuartoExtension(item.label, item.workspaceFolder);
				});
				if (success) {
					vscode.window.showInformationMessage(`Extension "${item.label}" removed successfully.`);
					this.treeDataProvider.refreshAfterAction(context, view);
				} else {
					showMessageWithLogs(`Failed to remove extension "${item.label}".`, "error");
				}
			}),
		);

		/**
		 * Reveals the extension's YAML manifest file in VS Code's Explorer view.
		 */
		context.subscriptions.push(
			vscode.commands.registerCommand(
				"quartoWizard.extensionsInstalled.revealInExplorer",
				async (item: ExtensionTreeItem) => {
					// Early return if resourceUri is not available
					if (!item.resourceUri) {
						logMessage(`Cannot reveal "${item.label}": resource URI not available.`, "warn");
						showMessageWithLogs(`Cannot reveal extension "${item.label}" in Explorer.`, "warning");
						return;
					}

					// Check if extension directory exists
					try {
						await vscode.workspace.fs.stat(item.resourceUri);
					} catch {
						logMessage(`Extension directory not found: ${item.resourceUri.fsPath}.`, "warn");
						showMessageWithLogs(`Extension directory for "${item.label}" not found.`, "warning");
						return;
					}

					// Try to find _extension.yml or _extension.yaml
					const extensionYml = vscode.Uri.joinPath(item.resourceUri, "_extension.yml");
					const extensionYaml = vscode.Uri.joinPath(item.resourceUri, "_extension.yaml");

					let targetUri: vscode.Uri;
					try {
						await vscode.workspace.fs.stat(extensionYml);
						targetUri = extensionYml;
					} catch {
						try {
							await vscode.workspace.fs.stat(extensionYaml);
							targetUri = extensionYaml;
						} catch {
							// Fallback to directory if no extension file found
							logMessage(
								`No _extension.yml or _extension.yaml found for "${item.label}", showing directory instead.`,
								"info",
							);
							targetUri = item.resourceUri;
						}
					}

					try {
						await vscode.commands.executeCommand("revealInExplorer", targetUri);
						logMessage(`Revealed "${item.label}" in Explorer.`, "info");
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : String(error);
						logMessage(`Failed to reveal "${item.label}" in Explorer: ${errorMessage}`, "error");
						showMessageWithLogs(`Failed to reveal extension "${item.label}" in Explorer.`, "error");
					}
				},
			),
		);

		/**
		 * Updates all outdated extensions to their latest versions.
		 */
		context.subscriptions.push(
			vscode.commands.registerCommand("quartoWizard.extensionsInstalled.updateAll", async () => {
				const outdated = this.treeDataProvider.getOutdatedExtensions();

				if (outdated.length === 0) {
					vscode.window.showInformationMessage("All extensions are up to date.");
					return;
				}

				const confirm = await vscode.window.showWarningMessage(
					`Update ${outdated.length} extension(s) to their latest versions?`,
					{ modal: true },
					"Update All",
				);

				if (confirm !== "Update All") {
					return;
				}

				const auth = await getAuthConfig(context);
				let successCount = 0;
				let failedCount = 0;

				await withProgressNotification(`Updating ${outdated.length} extension(s) ...`, async (token) => {
					for (const ext of outdated) {
						if (token.isCancellationRequested) {
							break;
						}
						const source = ext.repository
							? `${ext.repository}@${ext.latestVersion}`
							: `${ext.extensionId}@${ext.latestVersion}`;
						// result is true (success), false (failure), or null (cancelled)
						const result = await installQuartoExtension(
							source,
							ext.workspaceFolder,
							auth,
							undefined,
							true, // skipOverwritePrompt - updates are expected to overwrite
							token,
						);
						if (result === true) {
							successCount++;
						} else if (result === false) {
							failedCount++;
						} else {
							// result === null means cancelled by user, stop processing
							break;
						}
					}
					return successCount > 0;
				});

				if (successCount > 0) {
					vscode.window.showInformationMessage(
						`Successfully updated ${successCount} extension(s)${failedCount > 0 ? `, ${failedCount} failed` : ""}.`,
					);
				} else {
					showMessageWithLogs("Failed to update extensions.", "error");
				}

				this.treeDataProvider.refreshAfterAction(context, view);
			}),
		);

		/**
		 * Inserts a snippet at the cursor position in the active editor.
		 */
		context.subscriptions.push(
			vscode.commands.registerCommand(
				"quartoWizard.extensionsInstalled.insertSnippet",
				async (arg: SnippetItemTreeItem | SnippetDefinition) => {
					if (!arg) {
						return;
					}
					const editor = vscode.window.activeTextEditor;
					if (!editor) {
						vscode.window.showInformationMessage("Open a file in the editor to insert a snippet.");
						return;
					}
					const definition: SnippetDefinition = arg instanceof SnippetItemTreeItem ? arg.definition : arg;
					const body = Array.isArray(definition.body) ? definition.body.join("\n") : definition.body;
					await editor.insertSnippet(new vscode.SnippetString(body));
				},
			),
		);

		/**
		 * Removes multiple selected extensions from a workspace folder.
		 */
		context.subscriptions.push(
			vscode.commands.registerCommand(
				"quartoWizard.extensionsInstalled.removeMultiple",
				async (item: WorkspaceFolderTreeItem) => {
					const extensions = this.treeDataProvider.getInstalledExtensions(item.workspaceFolder);

					if (extensions.length === 0) {
						vscode.window.showInformationMessage("No extensions to remove.");
						return;
					}

					const selected = await vscode.window.showQuickPick(
						extensions.map((ext) => ({ label: ext, picked: false })),
						{
							placeHolder: "Select extensions to remove",
							canPickMany: true,
						},
					);

					if (!selected || selected.length === 0) {
						return;
					}

					const confirm = await vscode.window.showWarningMessage(
						`Remove ${selected.length} extension(s)? This cannot be undone.`,
						{ modal: true },
						"Remove",
					);

					if (confirm !== "Remove") {
						return;
					}

					const extensionNames = selected.map((s) => s.label);
					const result = await withProgressNotification(
						`Removing ${extensionNames.length} extension(s) ...`,
						async () => {
							return removeQuartoExtensions(extensionNames, item.workspaceFolder);
						},
					);

					if (result.successCount > 0) {
						vscode.window.showInformationMessage(
							`Successfully removed ${result.successCount} extension(s)${result.failedExtensions.length > 0 ? `, ${result.failedExtensions.length} failed` : ""}.`,
						);
					} else {
						showMessageWithLogs("Failed to remove extensions.", "error");
					}

					this.treeDataProvider.refreshAfterAction(context, view);
				},
			),
		);
	}

	constructor(context: vscode.ExtensionContext, schemaCache: SchemaCache, snippetCache: SnippetCache) {
		this.initialise(context, schemaCache, snippetCache);
	}
}
