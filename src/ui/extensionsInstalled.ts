import * as vscode from "vscode";
import * as path from "node:path";
import type { SchemaCache } from "@quarto-wizard/schema";
import type { SnippetCache, SnippetDefinition } from "@quarto-wizard/snippets";
import {
	checkForUpdates,
	formatExtensionId,
	getErrorMessage,
	isCancellationError,
	pluralise,
	type AuthConfig,
	type ExtensionId,
	type UpdateCheckResult,
	type UpdateInfo,
} from "@quarto-wizard/core";
import { REGISTRY_FETCH_TIMEOUT_MS } from "../constants";
import { logMessage, showMessageWithLogs } from "../utils/log";
import { removeQuartoExtension, removeQuartoExtensions, installQuartoExtension } from "../utils/coreOperations";
import { withProgressNotification } from "../utils/withProgressNotification";
import { getAuthConfig } from "../utils/auth";
import { getEffectiveSourceType, resolveLocalSourcePath } from "../utils/extensions";
import { invalidateInstalledExtensionsCache } from "../utils/installedExtensionsCache";
import { invalidateWorkspaceSchemaIndex } from "../utils/workspaceSchemaIndex";
import { invalidateMetadataFiles } from "../utils/metadataFilesRegistry";
import { QUARTO_PROJECT_GLOB, EXTENSION_MANIFEST_GLOB } from "../utils/quartoProjectDiscovery";
import {
	findOwningProjectRootSync,
	invalidateProjectRoots,
	refreshProjectRoots as rediscoverProjectRoots,
} from "../utils/projectRootsRegistry";
import { debounce } from "../utils/debounce";
import { ProjectVisibility } from "../utils/projectVisibility";
import { WorkspaceFolderTreeItem, ExtensionTreeItem, SnippetItemTreeItem } from "./extensionTreeItems";
import { QuartoExtensionTreeDataProvider } from "./extensionTreeDataProvider";
import { DetectedProjectsProvider, registerDetectedProjectsView, runReporting } from "./detectedProjectsView";

const PROJECT_ROOTS_REFRESH_DEBOUNCE_MS = 500;

const QUARTO_IGNORE_GLOB = "**/.quartoignore";

/**
 * Resolves the latest GitHub tag or commit of each extension, with or without a token, so that an
 * update installs the version that its messages give.
 *
 * @returns The check result, or undefined when the user cancelled the check.
 */
async function checkGitHubUpdates(
	projectDirs: string[],
	auth: AuthConfig,
	token: vscode.CancellationToken,
	extension?: ExtensionId,
): Promise<UpdateCheckResult | undefined> {
	const controller = new AbortController();
	if (token.isCancellationRequested) {
		controller.abort();
	}
	const cancellation = token.onCancellationRequested(() => controller.abort());
	try {
		return await checkForUpdates({
			projectDirs,
			extension,
			source: "github",
			auth,
			timeout: REGISTRY_FETCH_TIMEOUT_MS,
			signal: controller.signal,
		});
	} catch (error) {
		if (isCancellationError(error)) {
			return undefined;
		}
		return {
			checkedOn: "github",
			updates: [],
			repositoryFailures: [],
			checkFailure: { kind: "network", message: getErrorMessage(error) },
		};
	} finally {
		cancellation.dispose();
	}
}

/**
 * Logs the failures of a GitHub check and tells the user when the whole check failed.
 *
 * @returns True when the check failed as a whole.
 */
async function reportCheckFailures(
	result: UpdateCheckResult,
	failureMessage: string,
	auth: AuthConfig,
): Promise<boolean> {
	for (const failure of result.repositoryFailures) {
		logMessage(`Failed to check updates for ${failure.repository}: ${failure.message}.`, "warn");
	}
	if (!result.checkFailure) {
		return false;
	}
	logMessage(`Failed to check for updates: ${result.checkFailure.message}.`, "error");
	if (result.checkFailure.kind === "rate-limited" && auth.githubToken) {
		showMessageWithLogs(`${failureMessage} GitHub rate limit reached.`, "warning");
	} else if (result.checkFailure.kind === "rate-limited") {
		const action = await vscode.window.showWarningMessage(
			`${failureMessage} GitHub rate limit reached. Sign in to GitHub and try again.`,
			"Sign In",
		);
		if (action === "Sign In") {
			await vscode.commands.executeCommand("quartoWizard.signInWithGitHubSession");
		}
	} else {
		showMessageWithLogs(`${failureMessage} The update check failed.`, "error");
	}
	return true;
}

function describeUpdate(update: UpdateInfo): string {
	return `${formatExtensionId(update.extension.id)} ${update.currentVersion} to ${update.latestVersion}`;
}

/**
 * Manages the installed Quarto extensions.
 * Sets up the tree data provider and registers the necessary commands.
 */
export class ExtensionsInstalled {
	private treeDataProvider!: QuartoExtensionTreeDataProvider;

	/**
	 * Drops the cached data of a folder and refreshes the view after an install into it.
	 * Does nothing while the view is not initialised.
	 */
	refreshAfterInstall: (folder: string) => void = () => undefined;

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

		// Project roots are discovered asynchronously; start with an empty set so the view can
		// render immediately, then update once discovery completes.
		const visibility = new ProjectVisibility(context.workspaceState);
		context.subscriptions.push(visibility);
		this.treeDataProvider = new QuartoExtensionTreeDataProvider([], schemaCache, snippetCache, visibility);
		context.subscriptions.push(this.treeDataProvider);
		const view = vscode.window.createTreeView("quartoWizard.extensionsInstalled", {
			treeDataProvider: this.treeDataProvider,
			showCollapseAll: true,
		});
		context.subscriptions.push(visibility.onDidChange(() => this.treeDataProvider.updateViewState(view)));
		const detectedProjects = new DetectedProjectsProvider(
			visibility,
			(fsPath) => this.treeDataProvider.getProjectCounts(fsPath),
			() => this.treeDataProvider.getProjectRoots(),
		);
		context.subscriptions.push(this.treeDataProvider.onDidChangeCounts(() => detectedProjects.refresh()));
		registerDetectedProjectsView(context, detectedProjects, visibility, () => this.treeDataProvider.getProjectRoots());
		const invalidateProviderCaches = (cacheKey?: string) => {
			invalidateInstalledExtensionsCache(cacheKey);
			invalidateWorkspaceSchemaIndex(cacheKey);
		};

		const resolveCacheKeyForUri = (uri: vscode.Uri): string | undefined => {
			if (uri.scheme === "file") {
				const owningRoot = findOwningProjectRootSync(uri.fsPath);
				if (owningRoot) {
					return owningRoot;
				}
			}
			return vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath;
		};

		this.refreshAfterInstall = (folder) => {
			invalidateProviderCaches(folder);
			this.treeDataProvider.refreshAfterAction(context, view);
		};

		const updateProjectRoots = async (): Promise<boolean> => {
			try {
				// The registry owns the scans and cancels the ones a newer trigger
				// supersedes. A superseded discovery reports nothing, and the newer
				// one updates the view.
				const roots = await rediscoverProjectRoots();
				if (!roots) {
					return false;
				}
				const changed = this.treeDataProvider.setProjectRoots(roots);
				detectedProjects.refresh();
				return changed;
			} catch (error) {
				logMessage(`Failed to discover Quarto project roots: ${getErrorMessage(error)}.`, "error");
				return false;
			}
		};

		// Background trigger: run discovery; only re-fetch extensions/updates if roots changed.
		const refreshProjectRoots = debounce(() => {
			void (async () => {
				if (await updateProjectRoots()) {
					this.treeDataProvider.refreshAfterAction(context, view);
				}
			})();
		}, PROJECT_ROOTS_REFRESH_DEBOUNCE_MS);
		context.subscriptions.push({ dispose: () => refreshProjectRoots.cancel() });

		// Explicit trigger (activation, manual refresh): always re-fetch downstream data.
		const refreshAll = () => {
			refreshProjectRoots.cancel();
			void (async () => {
				await updateProjectRoots();
				this.treeDataProvider.refreshAfterAction(context, view);
			})();
		};

		refreshAll();

		const visibilityDisposable = view.onDidChangeVisibility((e) => {
			if (e.visible) {
				this.treeDataProvider.refreshAfterAction(context, view);
			}
		});
		context.subscriptions.push(visibilityDisposable);

		context.subscriptions.push(
			vscode.workspace.onDidChangeConfiguration((event) => {
				// The scans read the exclude settings, so a change to either one changes
				// which projects and which metadata files the scans can reach.
				if (event.affectsConfiguration("files.exclude") || event.affectsConfiguration("search.exclude")) {
					invalidateMetadataFiles();
					invalidateProjectRoots();
					refreshProjectRoots();
				}
			}),
		);

		context.subscriptions.push(
			vscode.workspace.onDidChangeWorkspaceFolders(() => {
				refreshProjectRoots();
			}),
		);

		const projectFileWatcher = vscode.workspace.createFileSystemWatcher(QUARTO_PROJECT_GLOB);
		const onProjectFileChanged = (uri: vscode.Uri) => {
			invalidateProviderCaches(resolveCacheKeyForUri(uri));
			invalidateProjectRoots();
			refreshProjectRoots();
		};
		context.subscriptions.push(projectFileWatcher.onDidCreate(onProjectFileChanged));
		context.subscriptions.push(projectFileWatcher.onDidDelete(onProjectFileChanged));
		context.subscriptions.push(projectFileWatcher);

		// The default visibility of a project reads `.quartoignore`, which discovery marks on each root.
		const quartoIgnoreWatcher = vscode.workspace.createFileSystemWatcher(QUARTO_IGNORE_GLOB);
		const onQuartoIgnoreChanged = () => {
			invalidateProjectRoots();
			refreshProjectRoots();
		};
		context.subscriptions.push(quartoIgnoreWatcher.onDidCreate(onQuartoIgnoreChanged));
		context.subscriptions.push(quartoIgnoreWatcher.onDidChange(onQuartoIgnoreChanged));
		context.subscriptions.push(quartoIgnoreWatcher.onDidDelete(onQuartoIgnoreChanged));
		context.subscriptions.push(quartoIgnoreWatcher);

		// Create/delete also re-runs discovery so installing the first extension in a folder
		// promotes it into the detected roots without a manual refresh.
		const extensionWatcher = vscode.workspace.createFileSystemWatcher(EXTENSION_MANIFEST_GLOB);
		const onExtensionManifestEvent = (rediscover: boolean) => (uri: vscode.Uri) => {
			invalidateProviderCaches(resolveCacheKeyForUri(uri));
			if (rediscover) {
				invalidateProjectRoots();
				refreshProjectRoots();
			} else {
				this.treeDataProvider.refresh();
			}
		};
		context.subscriptions.push(extensionWatcher.onDidCreate(onExtensionManifestEvent(true)));
		context.subscriptions.push(extensionWatcher.onDidDelete(onExtensionManifestEvent(true)));
		context.subscriptions.push(extensionWatcher.onDidChange(onExtensionManifestEvent(false)));
		context.subscriptions.push(extensionWatcher);

		// Watch for changes to schema files for real-time tree view updates
		const schemaWatcher = vscode.workspace.createFileSystemWatcher("**/_extensions/**/_schema.{yml,yaml,json}");
		const invalidateSchemaAndRefresh = (uri: vscode.Uri) => {
			invalidateWorkspaceSchemaIndex(resolveCacheKeyForUri(uri));
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
				invalidateProviderCaches();
				refreshAll();
			}),
		);

		/**
		 * Hides a project from the view for the current user.
		 */
		context.subscriptions.push(
			vscode.commands.registerCommand(
				"quartoWizard.extensionsInstalled.hideProject",
				async (item: WorkspaceFolderTreeItem) => {
					const root = this.treeDataProvider.getProjectRoot(item.folderPath);
					if (!root) {
						logMessage(`Cannot hide "${item.label}": no detected project at ${item.folderPath}.`, "warn");
						return;
					}
					await runReporting("hide the project", [root], () => visibility.setVisible([root], false));
				},
			),
		);

		// Open Source command (branches on effective source type)
		context.subscriptions.push(
			vscode.commands.registerCommand(
				"quartoWizard.extensionsInstalled.openSource",
				async (item: ExtensionTreeItem) => {
					if (!item.sourceUrl) {
						return;
					}
					if (item.effectiveSourceType === "local") {
						const uri = item.sourceUrl.startsWith("file://")
							? vscode.Uri.parse(item.sourceUrl)
							: vscode.Uri.file(resolveLocalSourcePath(item.sourceUrl, item.workspaceFolder));
						const action = await vscode.window.showInformationMessage(
							"Open extension source folder in a new window?",
							"Open",
						);
						if (action === "Open") {
							await vscode.commands.executeCommand("vscode.openFolder", uri, { forceNewWindow: true });
						}
					} else {
						try {
							const uri = vscode.Uri.parse(item.sourceUrl);
							const scheme = uri.scheme.toLowerCase();
							if (scheme !== "http" && scheme !== "https") {
								showMessageWithLogs(
									`Failed to open source for "${item.label}". Only HTTP(S) URLs are supported.`,
									"warning",
								);
								return;
							}
							const opened = await vscode.env.openExternal(uri);
							if (!opened) {
								showMessageWithLogs(`Failed to open source for "${item.label}".`, "error");
							}
						} catch (error) {
							logMessage(`Failed to parse source URL for "${item.label}": ${getErrorMessage(error)}.`, "error");
							showMessageWithLogs(`Failed to open source for "${item.label}".`, "error");
						}
					}
				},
			),
		);

		/**
		 * Updates a Quarto extension to the latest version.
		 * A GitHub or registry extension resolves its latest GitHub tag at click time and installs that tag;
		 * a URL or local extension installs its source again.
		 */
		context.subscriptions.push(
			vscode.commands.registerCommand("quartoWizard.extensionsInstalled.update", async (item: ExtensionTreeItem) => {
				const extension = item.extension;
				const source = extension?.manifest.source;
				if (!extension || !source) {
					showMessageWithLogs(
						`Failed to update extension "${item.label}". Source not found in extension manifest.`,
						"error",
					);
					return;
				}
				const failureMessage = `Failed to update extension "${item.label}".`;
				const resolvesTag = item.effectiveSourceType === "github" || item.effectiveSourceType === "registry";
				const auth = await getAuthConfig(context);
				const install = (installSource: string, token: vscode.CancellationToken) =>
					installQuartoExtension(installSource, item.workspaceFolder, {
						auth,
						skipOverwritePrompt: true,
						cancellationToken: token,
						sourceType: item.effectiveSourceType,
					});
				const outcome = await withProgressNotification(`Updating "${item.label}" ...`, async (token) => {
					if (!resolvesTag) {
						return { installed: await install(source, token) };
					}
					const check = await checkGitHubUpdates([item.workspaceFolder], auth, token, extension.id);
					if (!check || token.isCancellationRequested) {
						return {};
					}
					const update = check.updates[0];
					if (!update || check.checkFailure || check.repositoryFailures.length > 0) {
						return { check };
					}
					return { check, update, installed: await install(update.source, token) };
				});

				if (outcome.check) {
					if (await reportCheckFailures(outcome.check, failureMessage, auth)) {
						return;
					}
					if (outcome.check.repositoryFailures.length > 0) {
						showMessageWithLogs(failureMessage, "error");
						return;
					}
					if (outcome.check.updates.length === 0) {
						vscode.window.showInformationMessage(`Extension "${item.label}" is up to date.`);
						return;
					}
				}
				if (outcome.installed === true) {
					invalidateProviderCaches(item.workspaceFolder);
					vscode.window.showInformationMessage(
						outcome.update
							? `Extension "${item.label}" updated to ${outcome.update.latestVersion}.`
							: `Extension "${item.label}" updated successfully.`,
					);
					this.treeDataProvider.refreshAfterAction(context, view);
				} else if (outcome.installed === false) {
					showMessageWithLogs(failureMessage, "error");
				}
			}),
		);

		/**
		 * Reinstalls a Quarto extension from its original source.
		 * Preserves the pinned version or re-downloads as-is.
		 */
		context.subscriptions.push(
			vscode.commands.registerCommand("quartoWizard.extensionsInstalled.reinstall", async (item: ExtensionTreeItem) => {
				const source = item.extension?.manifest.source;
				if (!source) {
					showMessageWithLogs(
						`Failed to reinstall extension "${item.label}". Source not found in extension manifest.`,
						"error",
					);
					return;
				}
				const auth = await getAuthConfig(context);
				const result = await withProgressNotification(`Reinstalling "${item.label}" ...`, async (token) => {
					return installQuartoExtension(source, item.workspaceFolder, {
						auth,
						skipOverwritePrompt: true,
						cancellationToken: token,
						sourceType: item.effectiveSourceType,
					});
				});
				if (result === true) {
					invalidateProviderCaches(item.workspaceFolder);
					vscode.window.showInformationMessage(`Extension "${item.label}" reinstalled successfully.`);
					this.treeDataProvider.refreshAfterAction(context, view);
				} else if (result === false) {
					showMessageWithLogs(`Failed to reinstall extension "${item.label}".`, "error");
				}
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
					invalidateProviderCaches(item.workspaceFolder);
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
					} catch (error) {
						logMessage(
							`Extension directory not accessible: ${item.resourceUri.fsPath}: ${getErrorMessage(error)}.`,
							"warn",
						);
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
						logMessage(`Failed to reveal "${item.label}" in Explorer: ${getErrorMessage(error)}`, "error");
						showMessageWithLogs(`Failed to reveal extension "${item.label}" in Explorer.`, "error");
					}
				},
			),
		);

		/**
		 * Updates every GitHub or registry extension that has a newer GitHub tag.
		 * The check runs against GitHub at click time, with or without a token, and each update installs
		 * the tag that the check found.
		 */
		context.subscriptions.push(
			vscode.commands.registerCommand("quartoWizard.extensionsInstalled.updateAll", async () => {
				const failureMessage = "Failed to update extensions.";
				const auth = await getAuthConfig(context);
				const check = await withProgressNotification("Checking for updates ...", async (token) => {
					const result = await checkGitHubUpdates(this.treeDataProvider.getProjectDirs(), auth, token);
					return token.isCancellationRequested ? undefined : result;
				});
				if (!check) {
					return;
				}
				if (await reportCheckFailures(check, failureMessage, auth)) {
					return;
				}
				const updates = check.updates.filter(
					(update) => !this.treeDataProvider.isSelfEmbedded(update.projectDir, update.extension),
				);
				const uncheckedCount = check.repositoryFailures.length;
				const uncheckedRepositories = pluralise(uncheckedCount, "repository", "repositories");

				if (updates.length === 0) {
					if (uncheckedCount > 0) {
						showMessageWithLogs(`Failed to check updates for ${uncheckedRepositories}.`, "warning");
					} else {
						vscode.window.showInformationMessage("All extensions are up to date.");
					}
					return;
				}

				const confirm = await vscode.window.showWarningMessage(
					`Update ${pluralise(updates.length, "extension")} to ${updates.length === 1 ? "its latest version" : "their latest versions"}?`,
					{ modal: true, detail: updates.map(describeUpdate).join("\n") },
					"Update All",
				);

				if (confirm !== "Update All") {
					return;
				}

				const updated: UpdateInfo[] = [];
				let failedCount = 0;

				const cancelled = await withProgressNotification(
					`Updating ${pluralise(updates.length, "extension")} ...`,
					async (token) => {
						for (const update of updates) {
							if (token.isCancellationRequested) {
								return true;
							}
							const result = await installQuartoExtension(update.source, update.projectDir, {
								auth,
								skipOverwritePrompt: true,
								cancellationToken: token,
								sourceType: getEffectiveSourceType(update.extension.manifest),
							});
							if (result === true) {
								updated.push(update);
							} else if (result === false) {
								failedCount++;
							} else {
								return token.isCancellationRequested;
							}
						}
						return token.isCancellationRequested;
					},
				);
				const notAttempted = updates.length - updated.length - failedCount;

				if (updated.length > 0) {
					invalidateProviderCaches();
					const versions = updated
						.map((update) => `${formatExtensionId(update.extension.id)} to ${update.latestVersion}`)
						.join(", ");
					const problems = [
						...(failedCount > 0 ? [`${failedCount} failed`] : []),
						...(uncheckedCount > 0 ? [`${uncheckedRepositories} could not be checked`] : []),
						...(cancelled && notAttempted > 0 ? [`cancelled before ${notAttempted} more`] : []),
					];
					vscode.window.showInformationMessage(`Updated ${[versions, ...problems].join("; ")}.`);
				} else if (!cancelled || failedCount > 0) {
					showMessageWithLogs(failureMessage, "error");
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
					const position = editor.selection.active;
					const line = editor.document.lineAt(position.line);
					if (line.text.trim().length > 0) {
						await editor.insertSnippet(new vscode.SnippetString("\n" + body), line.range.end);
					} else {
						await editor.insertSnippet(new vscode.SnippetString(body));
					}
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
						`Remove ${pluralise(selected.length, "extension")}? This cannot be undone.`,
						{ modal: true },
						"Remove",
					);

					if (confirm !== "Remove") {
						return;
					}

					const extensionNames = selected.map((s) => s.label);
					const result = await withProgressNotification(
						`Removing ${pluralise(extensionNames.length, "extension")} ...`,
						async () => {
							return removeQuartoExtensions(extensionNames, item.workspaceFolder);
						},
					);

					if (result.successCount > 0) {
						invalidateProviderCaches(item.workspaceFolder);
						vscode.window.showInformationMessage(
							`Successfully removed ${pluralise(result.successCount, "extension")}${result.failedExtensions.length > 0 ? `, ${result.failedExtensions.length} failed` : ""}.`,
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
