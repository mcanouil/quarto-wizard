import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as semver from "semver";
import { debounce } from "lodash";
import { logMessage, showLogsCommand } from "../utils/log";
import {
	getInstalledExtensionsRecord,
	getExtensionRepository,
	getExtensionContributes,
	type InstalledExtension,
} from "../utils/extensions";
import { removeQuartoExtension, removeQuartoExtensions, installQuartoExtension } from "../utils/quarto";
import { getExtensionsDetails } from "../utils/extensionDetails";
import { withProgressNotification } from "../utils/withProgressNotification";
import { installQuartoExtensionFolderCommand } from "../commands/installQuartoExtension";
import { getAuthConfig } from "../utils/auth";

/**
 * Represents a tree item for a workspace folder.
 */
class WorkspaceFolderTreeItem extends vscode.TreeItem {
	public workspaceFolder: string;

	constructor(
		public readonly label: string,
		public readonly folderPath: string,
	) {
		super(label, vscode.TreeItemCollapsibleState.Expanded);
		this.contextValue = "quartoExtensionWorkspaceFolder";
		this.iconPath = new vscode.ThemeIcon("folder");
		this.tooltip = folderPath;
		this.workspaceFolder = folderPath;
	}
}

/**
 * Represents a tree item for a Quarto extension.
 */
class ExtensionTreeItem extends vscode.TreeItem {
	public latestVersion?: string;
	public workspaceFolder: string;
	public repository?: string;

	constructor(
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly workspacePath: string,
		public readonly extension?: InstalledExtension,
		icon?: string,
		latestVersion?: string,
		hasIssue?: boolean,
	) {
		super(label, collapsibleState);
		const needsUpdate = latestVersion !== undefined;
		const noSource = extension && !extension.manifest.source;
		const baseContextValue = "quartoExtensionItem";
		let contextValue = baseContextValue;

		// Set context value based on extension state for VS Code context menus
		// This determines which commands are available when right-clicking
		if (needsUpdate) {
			contextValue = baseContextValue + "Outdated"; // Shows "update" option
		} else if (noSource) {
			contextValue = baseContextValue + "NoSource"; // Cannot be updated, shows limited options
		}

		// Build tooltip with warning if there are issues
		let tooltipText = `${this.label}`;
		if (hasIssue) {
			tooltipText += "\n\nCould not parse extension manifest";
		} else if (noSource) {
			tooltipText += "\n\nNo source in manifest (cannot check for updates)";
		}
		this.tooltip = tooltipText;
		this.description = this.extension
			? `${this.extension.manifest.version}${needsUpdate ? ` (latest: ${latestVersion})` : ""}`
			: "";
		this.contextValue = this.extension ? contextValue : "quartoExtensionItemDetails";

		// Show warning icon if there are issues preventing full functionality
		if (hasIssue || noSource) {
			this.iconPath = new vscode.ThemeIcon("warning", new vscode.ThemeColor("problemsWarningIcon.foreground"));
		} else if (icon) {
			this.iconPath = new vscode.ThemeIcon(icon);
		}

		// Format version for installation commands
		this.latestVersion = latestVersion !== "unknown" ? `@${latestVersion}` : "";
		this.workspaceFolder = workspacePath;

		// Store repository for update commands
		if (extension) {
			this.repository = getExtensionRepository(extension);
		}

		// Set resource URI for the extension directory to enable "Reveal in Explorer" functionality
		if (this.extension) {
			const extensionPath = path.join(workspacePath, "_extensions", this.label);
			this.resourceUri = vscode.Uri.file(extensionPath);
		}
	}
}

/**
 * Cached data for a workspace folder.
 */
interface FolderCache {
	extensions: Record<string, InstalledExtension>;
	latestVersions: Record<string, string>;
	parseErrors: Set<string>;
}

/**
 * Provides data for the Quarto extensions tree view.
 */
class QuartoExtensionTreeDataProvider implements vscode.TreeDataProvider<WorkspaceFolderTreeItem | ExtensionTreeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<WorkspaceFolderTreeItem | ExtensionTreeItem | undefined | void> =
		new vscode.EventEmitter<WorkspaceFolderTreeItem | ExtensionTreeItem | undefined | void>();
	readonly onDidChangeTreeData: vscode.Event<WorkspaceFolderTreeItem | ExtensionTreeItem | undefined | void> =
		this._onDidChangeTreeData.event;

	// Consolidated cache for extension data per workspace folder
	private cache: Record<string, FolderCache> = {};

	constructor(private workspaceFolders: readonly vscode.WorkspaceFolder[]) {
		this.refreshAllExtensionsData();
	}

	getTreeItem(element: WorkspaceFolderTreeItem | ExtensionTreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(
		element?: WorkspaceFolderTreeItem | ExtensionTreeItem,
	): Thenable<(WorkspaceFolderTreeItem | ExtensionTreeItem)[]> {
		if (!element) {
			if (this.workspaceFolders.length === 0) {
				return Promise.resolve([
					new ExtensionTreeItem(
						"No workspace folders open.",
						vscode.TreeItemCollapsibleState.None,
						"",
						undefined,
						"info",
					),
				]);
			}
			return Promise.resolve(this.getWorkspaceFolderItems());
		}

		if (element instanceof WorkspaceFolderTreeItem) {
			return Promise.resolve(this.getExtensionItems(element.folderPath));
		}

		return Promise.resolve(this.getExtensionDetailItems(element));
	}

	private getWorkspaceFolderItems(): WorkspaceFolderTreeItem[] {
		if (this.workspaceFolders.length > 1) {
			return this.workspaceFolders.map((folder) => {
				return new WorkspaceFolderTreeItem(folder.name, folder.uri.fsPath);
			});
		}
		return this.workspaceFolders
			.filter((folder) => {
				const folderCache = this.cache[folder.uri.fsPath];
				return folderCache && Object.keys(folderCache.extensions).length > 0;
			})
			.map((folder) => new WorkspaceFolderTreeItem(folder.name, folder.uri.fsPath));
	}

	private getExtensionItems(workspacePath: string): ExtensionTreeItem[] {
		const folderCache = this.cache[workspacePath];
		if (!folderCache || Object.keys(folderCache.extensions).length === 0) {
			return [
				new ExtensionTreeItem(
					"No extensions installed.",
					vscode.TreeItemCollapsibleState.None,
					workspacePath,
					undefined,
					"info",
				),
			];
		}

		return Object.keys(folderCache.extensions).map(
			(ext) =>
				new ExtensionTreeItem(
					ext,
					vscode.TreeItemCollapsibleState.Collapsed,
					workspacePath,
					folderCache.extensions[ext],
					"package",
					folderCache.latestVersions[ext],
					folderCache.parseErrors.has(ext),
				),
		);
	}

	private getExtensionDetailItems(element: ExtensionTreeItem): ExtensionTreeItem[] {
		const ext = element.extension;
		if (!ext) {
			return [];
		}
		const manifest = ext.manifest;
		return [
			new ExtensionTreeItem(`Title: ${manifest.title}`, vscode.TreeItemCollapsibleState.None, element.workspaceFolder),
			new ExtensionTreeItem(
				`Author: ${manifest.author}`,
				vscode.TreeItemCollapsibleState.None,
				element.workspaceFolder,
			),
			new ExtensionTreeItem(
				`Version: ${manifest.version}`,
				vscode.TreeItemCollapsibleState.None,
				element.workspaceFolder,
			),
			new ExtensionTreeItem(
				`Contributes: ${getExtensionContributes(ext)}`,
				vscode.TreeItemCollapsibleState.None,
				element.workspaceFolder,
			),
			new ExtensionTreeItem(
				`Repository: ${getExtensionRepository(ext)}`,
				vscode.TreeItemCollapsibleState.None,
				element.workspaceFolder,
			),
			new ExtensionTreeItem(
				`Source: ${manifest.source}`,
				vscode.TreeItemCollapsibleState.None,
				element.workspaceFolder,
			),
		];
	}

	/**
	 * Refreshes the tree data with a debounce.
	 */
	refresh = debounce((): void => {
		this.refreshAllExtensionsData();
		this._onDidChangeTreeData.fire();
	}, 300); // Debounce refresh calls with a 300ms delay

	/**
	 * Forces a refresh of the tree data.
	 */
	forceRefresh(): void {
		this.refresh();
		this.refresh.flush();
	}

	/**
	 * Centralised method to handle post-action refresh and update checking.
	 * Ensures proper order: check for updates first, then refresh display.
	 */
	refreshAfterAction(
		context: vscode.ExtensionContext,
		view?: vscode.TreeView<WorkspaceFolderTreeItem | ExtensionTreeItem>,
	): void {
		this.refreshAllExtensionsDataAsync().then(() => {
			this.checkUpdate(context, view);
			this._onDidChangeTreeData.fire();
		});
	}

	private refreshAllExtensionsData(): void {
		// Synchronous initialization - starts async refresh in background
		this.refreshAllExtensionsDataAsync();
	}

	private async refreshAllExtensionsDataAsync(): Promise<void> {
		const newCache: Record<string, FolderCache> = {};

		for (const folder of this.workspaceFolders) {
			const workspaceFolder = folder.uri.fsPath;
			const extensions = await getInstalledExtensionsRecord(workspaceFolder);

			const parseErrors = new Set<string>();
			for (const [extId, ext] of Object.entries(extensions)) {
				const manifest = ext.manifest;
				// Mark as parse error if essential fields are missing
				if (!manifest.title && !manifest.version && !manifest.contributes) {
					parseErrors.add(extId);
				}
			}

			newCache[workspaceFolder] = {
				extensions,
				latestVersions: this.cache[workspaceFolder]?.latestVersions || {},
				parseErrors,
			};
		}

		this.cache = newCache;
	}

	/**
	 * Gets all outdated extensions across all workspace folders.
	 *
	 * @returns Array of objects with extension info and update details.
	 */
	getOutdatedExtensions(): {
		extensionId: string;
		workspaceFolder: string;
		repository: string | undefined;
		latestVersion: string;
	}[] {
		const outdated: {
			extensionId: string;
			workspaceFolder: string;
			repository: string | undefined;
			latestVersion: string;
		}[] = [];

		for (const folder of this.workspaceFolders) {
			const workspacePath = folder.uri.fsPath;
			const folderCache = this.cache[workspacePath];
			if (!folderCache) continue;

			for (const ext of Object.keys(folderCache.latestVersions)) {
				const version = folderCache.latestVersions[ext];
				if (version && version !== "unknown") {
					const extension = folderCache.extensions[ext];
					outdated.push({
						extensionId: ext,
						workspaceFolder: workspacePath,
						repository: extension ? getExtensionRepository(extension) : undefined,
						latestVersion: version,
					});
				}
			}
		}

		return outdated;
	}

	/**
	 * Gets all installed extensions in a workspace folder.
	 *
	 * @param workspaceFolder - The workspace folder path.
	 * @returns Array of extension IDs.
	 */
	getInstalledExtensions(workspaceFolder: string): string[] {
		const folderCache = this.cache[workspaceFolder];
		return folderCache ? Object.keys(folderCache.extensions) : [];
	}

	/**
	 * Checks for updates to the installed extensions.
	 *
	 * @param context - The extension context.
	 * @param view - The tree view.
	 * @param silent - Whether to show update messages.
	 * @returns The number of updates available.
	 */
	async checkUpdate(
		context: vscode.ExtensionContext,
		view?: vscode.TreeView<WorkspaceFolderTreeItem | ExtensionTreeItem>,
		silent = true,
	): Promise<number> {
		const extensionsDetails = await getExtensionsDetails(context);
		const updatesAvailable: string[] = [];
		let totalUpdates = 0;

		for (const folder of this.workspaceFolders) {
			const workspacePath = folder.uri.fsPath;
			const folderCache = this.cache[workspacePath];
			if (!folderCache) continue;

			// Reset latest versions for this folder
			folderCache.latestVersions = {};

			for (const [extId, ext] of Object.entries(folderCache.extensions)) {
				const repository = getExtensionRepository(ext);
				const matchingDetail = extensionsDetails.find((detail) => detail.id === repository);

				const version = ext.manifest.version;
				if (!version || version === "none") {
					continue;
				}

				if (matchingDetail?.version === "none") {
					folderCache.latestVersions[extId] = "unknown";
					continue;
				}

				if (matchingDetail && semver.lt(version, matchingDetail.version)) {
					updatesAvailable.push(`${folder.name}/${extId}`);
					folderCache.latestVersions[extId] = matchingDetail.tag;
					totalUpdates++;
				}
			}
		}

		if (updatesAvailable.length > 0 && !silent) {
			const message = `Updates available for the following extensions: ${updatesAvailable.join(", ")}.`;
			logMessage(message, "info");
		}

		if (view) {
			view.badge = {
				value: totalUpdates,
				tooltip: `${totalUpdates} update${totalUpdates === 1 ? "" : "s"} available`,
			};
		}

		return totalUpdates;
	}
}

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
	private initialise(context: vscode.ExtensionContext) {
		const workspaceFolders = vscode.workspace.workspaceFolders || [];
		if (workspaceFolders.length === 0) {
			const message = `Please open a workspace/folder to install Quarto extensions.`;
			logMessage(message, "error");
			vscode.window.showErrorMessage(`${message} ${showLogsCommand()}.`);
			return;
		}

		this.treeDataProvider = new QuartoExtensionTreeDataProvider(workspaceFolders);
		const view = vscode.window.createTreeView("quartoWizard.extensionsInstalled", {
			treeDataProvider: this.treeDataProvider,
			showCollapseAll: true,
		});

		// Initial setup with update check and refresh
		this.treeDataProvider.refreshAfterAction(context, view);

		view.onDidChangeVisibility((e) => {
			if (e.visible) {
				this.treeDataProvider.refreshAfterAction(context, view);
			}
		});

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
					vscode.env.openExternal(vscode.Uri.parse(url));
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
				const latestVersion = item.latestVersion?.replace(/^@/, "");
				const latestSemver = latestVersion ? latestVersion.replace(/^v/, "") : undefined;
				const auth = await getAuthConfig(context, { createIfNone: true });
				const success = await withProgressNotification(
					`Updating "${item.repository ?? item.label}" to ${latestSemver} ...`,
					async () => {
						return installQuartoExtension(
							`${item.repository ?? item.label}${item.latestVersion}`,
							item.workspaceFolder,
							auth,
							undefined,
							true, // skipOverwritePrompt - updates are expected to overwrite
						);
					},
				);
				if (success) {
					vscode.window.showInformationMessage(`Extension "${item.label}" updated successfully.`);
					this.treeDataProvider.refreshAfterAction(context, view);
				} else {
					if (!item.repository) {
						vscode.window.showErrorMessage(
							`Failed to update extension "${item.label}". ` +
								`Source not found in extension manifest. ` +
								`${showLogsCommand()}.`,
						);
					} else {
						vscode.window.showErrorMessage(`Failed to update extension ${item.label}. ${showLogsCommand()}.`);
					}
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
					vscode.window.showInformationMessage(`Extension "${item.label}" removed successfully.`);
					this.treeDataProvider.refreshAfterAction(context, view);
				} else {
					vscode.window.showErrorMessage(`Failed to remove extension "${item.label}". ${showLogsCommand()}.`);
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
						vscode.window.showWarningMessage(`Cannot reveal extension "${item.label}" in Explorer.`);
						return;
					}

					// Check if extension directory exists
					if (!fs.existsSync(item.resourceUri.fsPath)) {
						logMessage(`Extension directory not found: ${item.resourceUri.fsPath}`, "warn");
						vscode.window.showWarningMessage(`Extension directory for "${item.label}" not found.`);
						return;
					}

					// Try to find _extension.yml or _extension.yaml
					const extensionYml = path.join(item.resourceUri.fsPath, "_extension.yml");
					const extensionYaml = path.join(item.resourceUri.fsPath, "_extension.yaml");

					let targetUri: vscode.Uri;
					if (fs.existsSync(extensionYml)) {
						targetUri = vscode.Uri.file(extensionYml);
					} else if (fs.existsSync(extensionYaml)) {
						targetUri = vscode.Uri.file(extensionYaml);
					} else {
						// Fallback to directory if no extension file found
						logMessage(
							`No _extension.yml or _extension.yaml found for "${item.label}", showing directory instead.`,
							"info",
						);
						targetUri = item.resourceUri;
					}

					try {
						await vscode.commands.executeCommand("revealInExplorer", targetUri);
						logMessage(`Revealed "${item.label}" in Explorer.`, "info");
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : String(error);
						logMessage(`Failed to reveal "${item.label}" in Explorer: ${errorMessage}`, "error");
						vscode.window.showErrorMessage(
							`Failed to reveal extension "${item.label}" in Explorer. ${showLogsCommand()}.`,
						);
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

				const auth = await getAuthConfig(context, { createIfNone: true });
				let successCount = 0;
				let failedCount = 0;

				await withProgressNotification(`Updating ${outdated.length} extension(s) ...`, async () => {
					for (const ext of outdated) {
						const source = ext.repository
							? `${ext.repository}@${ext.latestVersion}`
							: `${ext.extensionId}@${ext.latestVersion}`;
						const success = await installQuartoExtension(
							source,
							ext.workspaceFolder,
							auth,
							undefined,
							true, // skipOverwritePrompt - updates are expected to overwrite
						);
						if (success) {
							successCount++;
						} else {
							failedCount++;
						}
					}
					return successCount > 0;
				});

				if (successCount > 0) {
					vscode.window.showInformationMessage(
						`Successfully updated ${successCount} extension(s)${failedCount > 0 ? `, ${failedCount} failed` : ""}.`,
					);
				} else {
					vscode.window.showErrorMessage(`Failed to update extensions. ${showLogsCommand()}.`);
				}

				this.treeDataProvider.refreshAfterAction(context, view);
			}),
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
						vscode.window.showErrorMessage(`Failed to remove extensions. ${showLogsCommand()}.`);
					}

					this.treeDataProvider.refreshAfterAction(context, view);
				},
			),
		);
	}

	constructor(context: vscode.ExtensionContext) {
		this.initialise(context);
	}
}
