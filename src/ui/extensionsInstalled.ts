import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as semver from "semver";
import { debounce } from "lodash";
import {
	validateManifest,
	formatValidationIssues,
	type ValidationResult,
	parseManifestFile,
} from "@quarto-wizard/core";
import { logMessage, showLogsCommand } from "../utils/log";
import { ExtensionData, findQuartoExtensions, readExtensions } from "../utils/extensions";
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
	public validationResult?: ValidationResult;

	constructor(
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly workspacePath: string,
		public readonly data?: ExtensionData,
		icon?: string,
		latestVersion?: string,
		validationResult?: ValidationResult,
	) {
		super(label, collapsibleState);
		const needsUpdate = latestVersion !== undefined;
		const baseContextValue = "quartoExtensionItem";
		let contextValue = baseContextValue;

		// Set context value based on extension state for VS Code context menus
		// This determines which commands are available when right-clicking
		if (needsUpdate) {
			contextValue = baseContextValue + "Outdated"; // Shows "update" option
		} else if (data && !this.data?.source) {
			contextValue = baseContextValue + "NoSource"; // Cannot be updated, shows limited options
		}

		// Build tooltip with validation warnings if any
		let tooltipText = `${this.label}`;
		if (validationResult && validationResult.issues.length > 0) {
			const warnings = validationResult.issues.filter((i) => i.severity === "warning");
			const errors = validationResult.issues.filter((i) => i.severity === "error");
			if (errors.length > 0 || warnings.length > 0) {
				tooltipText += "\n\n";
				if (errors.length > 0) {
					tooltipText += `⛔ ${errors.length} error(s)\n`;
					errors.forEach((e) => {
						tooltipText += `  • ${e.field}: ${e.message}\n`;
					});
				}
				if (warnings.length > 0) {
					tooltipText += `⚠️ ${warnings.length} warning(s)\n`;
					warnings.forEach((w) => {
						tooltipText += `  • ${w.field}: ${w.message}\n`;
					});
				}
			}
		}
		this.tooltip = tooltipText;
		this.description = this.data ? `${this.data.version}${needsUpdate ? ` (latest: ${latestVersion})` : ""}` : "";
		this.contextValue = this.data ? contextValue : "quartoExtensionItemDetails";

		if (icon) {
			this.iconPath = new vscode.ThemeIcon(icon);
		}

		// Format version for installation commands
		this.latestVersion = latestVersion !== "unknown" ? `@${latestVersion}` : "";
		this.workspaceFolder = workspacePath;
		this.validationResult = validationResult;

		// Set resource URI for the extension directory to enable "Reveal in Explorer" functionality
		if (this.data) {
			const extensionPath = path.join(workspacePath, "_extensions", this.label);
			this.resourceUri = vscode.Uri.file(extensionPath);
		}
	}
}

/**
 * Provides data for the Quarto extensions tree view.
 */
class QuartoExtensionTreeDataProvider implements vscode.TreeDataProvider<WorkspaceFolderTreeItem | ExtensionTreeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<WorkspaceFolderTreeItem | ExtensionTreeItem | undefined | void> =
		new vscode.EventEmitter<WorkspaceFolderTreeItem | ExtensionTreeItem | undefined | void>();
	readonly onDidChangeTreeData: vscode.Event<WorkspaceFolderTreeItem | ExtensionTreeItem | undefined | void> =
		this._onDidChangeTreeData.event;

	// Cache extension data and version information per workspace folder to avoid repeated file reads
	private extensionsDataByFolder: Record<string, Record<string, ExtensionData>> = {};
	private latestVersionsByFolder: Record<string, Record<string, string>> = {};
	private validationResultsByFolder: Record<string, Record<string, ValidationResult>> = {};

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
				const folderData = this.extensionsDataByFolder[folder.uri.fsPath] || {};
				return Object.keys(folderData).length > 0;
			})
			.map((folder) => new WorkspaceFolderTreeItem(folder.name, folder.uri.fsPath));
	}

	private getExtensionItems(workspacePath: string): ExtensionTreeItem[] {
		const folderData = this.extensionsDataByFolder[workspacePath] || {};
		if (Object.keys(folderData).length === 0) {
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

		return Object.keys(folderData).map(
			(ext) =>
				new ExtensionTreeItem(
					ext,
					vscode.TreeItemCollapsibleState.Collapsed,
					workspacePath,
					folderData[ext],
					"package",
					this.latestVersionsByFolder[workspacePath]?.[ext],
					this.validationResultsByFolder[workspacePath]?.[ext],
				),
		);
	}

	/**
	 * Validates an extension manifest and returns the validation result.
	 * @param workspacePath - The workspace folder path.
	 * @param extensionName - The extension name (e.g., "owner/name").
	 * @returns ValidationResult or null if manifest cannot be read.
	 */
	validateExtension(workspacePath: string, extensionName: string): ValidationResult | null {
		const extensionPath = path.join(workspacePath, "_extensions", extensionName);
		let manifestPath = path.join(extensionPath, "_extension.yml");
		if (!fs.existsSync(manifestPath)) {
			manifestPath = path.join(extensionPath, "_extension.yaml");
		}
		if (!fs.existsSync(manifestPath)) {
			return null;
		}

		try {
			const manifest = parseManifestFile(manifestPath);
			return validateManifest(manifest, { requireContributions: true });
		} catch (error) {
			logMessage(`Failed to validate ${extensionName}: ${error}`, "error");
			return null;
		}
	}

	private getExtensionDetailItems(element: ExtensionTreeItem): ExtensionTreeItem[] {
		const data = element.data;
		if (!data) {
			return [];
		}
		return [
			new ExtensionTreeItem(`Title: ${data.title}`, vscode.TreeItemCollapsibleState.None, element.workspaceFolder),
			new ExtensionTreeItem(`Author: ${data.author}`, vscode.TreeItemCollapsibleState.None, element.workspaceFolder),
			new ExtensionTreeItem(`Version: ${data.version}`, vscode.TreeItemCollapsibleState.None, element.workspaceFolder),
			new ExtensionTreeItem(
				`Contributes: ${data.contributes}`,
				vscode.TreeItemCollapsibleState.None,
				element.workspaceFolder,
			),
			new ExtensionTreeItem(
				`Repository: ${data.repository}`,
				vscode.TreeItemCollapsibleState.None,
				element.workspaceFolder,
			),
			new ExtensionTreeItem(`Source: ${data.source}`, vscode.TreeItemCollapsibleState.None, element.workspaceFolder),
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
		this.checkUpdate(context, view);
		this.forceRefresh();
	}

	private refreshAllExtensionsData(): void {
		this.extensionsDataByFolder = {};
		this.validationResultsByFolder = {};

		for (const folder of this.workspaceFolders) {
			const workspaceFolder = folder.uri.fsPath;
			let extensionsList: string[] = [];

			if (fs.existsSync(path.join(workspaceFolder, "_extensions"))) {
				extensionsList = findQuartoExtensions(path.join(workspaceFolder, "_extensions"));
			}

			this.extensionsDataByFolder[workspaceFolder] = readExtensions(workspaceFolder, extensionsList);

			// Validate each extension and cache results
			this.validationResultsByFolder[workspaceFolder] = {};
			for (const ext of extensionsList) {
				const result = this.validateExtension(workspaceFolder, ext);
				if (result) {
					this.validationResultsByFolder[workspaceFolder][ext] = result;
				}
			}
		}
	}

	/**
	 * Gets all outdated extensions across all workspace folders.
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
			const folderData = this.extensionsDataByFolder[workspacePath] || {};
			const latestVersions = this.latestVersionsByFolder[workspacePath] || {};

			for (const ext of Object.keys(latestVersions)) {
				const version = latestVersions[ext];
				if (version && version !== "unknown") {
					outdated.push({
						extensionId: ext,
						workspaceFolder: workspacePath,
						repository: folderData[ext]?.repository,
						latestVersion: version,
					});
				}
			}
		}

		return outdated;
	}

	/**
	 * Gets all installed extensions in a workspace folder.
	 * @param workspaceFolder - The workspace folder path.
	 * @returns Array of extension IDs.
	 */
	getInstalledExtensions(workspaceFolder: string): string[] {
		const folderData = this.extensionsDataByFolder[workspaceFolder] || {};
		return Object.keys(folderData);
	}

	/**
	 * Checks for updates to the installed extensions.
	 * @param {vscode.ExtensionContext} context - The extension context.
	 * @param {vscode.TreeView<ExtensionTreeItem>} [view] - The tree view.
	 * @param {boolean} [silent=true] - Whether to show update messages.
	 * @returns {Promise<number>} - The number of updates available.
	 */
	async checkUpdate(
		context: vscode.ExtensionContext,
		view?: vscode.TreeView<WorkspaceFolderTreeItem | ExtensionTreeItem>,
		silent = true,
	): Promise<number> {
		const extensionsDetails = await getExtensionsDetails(context);
		const updatesAvailable: string[] = [];
		this.latestVersionsByFolder = {};
		let totalUpdates = 0;

		for (const folder of this.workspaceFolders) {
			const workspacePath = folder.uri.fsPath;
			const folderData = this.extensionsDataByFolder[workspacePath] || {};
			this.latestVersionsByFolder[workspacePath] = {};

			for (const ext of Object.keys(folderData)) {
				const extensionData = folderData[ext];
				const matchingDetail = extensionsDetails.find((detail) => detail.id === extensionData.repository);

				if (!extensionData.version || extensionData.version === "none") {
					continue;
				}

				if (matchingDetail?.version === "none") {
					this.latestVersionsByFolder[workspacePath][ext] = "unknown";
					continue;
				}

				if (matchingDetail && semver.lt(extensionData.version, matchingDetail.version)) {
					updatesAvailable.push(`${folder.name}/${ext}`);
					this.latestVersionsByFolder[workspacePath][ext] = matchingDetail.tag;
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
	 * @param {vscode.ExtensionContext} context - The extension context.
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
		// view.onDidChangeSelection((e) => {
		// 	if (e.selection) {
		// 		this.treeDataProvider.checkUpdate(context, view);
		// 		this.treeDataProvider.refresh();
		// 	}
		// });

		context.subscriptions.push(view);
		context.subscriptions.push(
			vscode.commands.registerCommand("quartoWizard.extensionsInstalled.refresh", () => {
				this.treeDataProvider.refreshAfterAction(context, view);
			}),
		);

		context.subscriptions.push(
			vscode.commands.registerCommand("quartoWizard.extensionsInstalled.openSource", (item: ExtensionTreeItem) => {
				if (item.data?.repository) {
					const url = `https://github.com/${item.data?.repository}`;
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
					`Updating "${item.data?.repository ?? item.label}" to ${latestSemver} ...`,
					async () => {
						return installQuartoExtension(
							`${item.data?.repository ?? item.label}${item.latestVersion}`,
							item.workspaceFolder,
							auth,
						);
					},
				);
				if (success) {
					vscode.window.showInformationMessage(`Extension "${item.label}" updated successfully.`);
					this.treeDataProvider.refreshAfterAction(context, view);
				} else {
					if (!item.data?.repository) {
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
						logMessage(`Cannot reveal "${item.label}": resource URI not available.`, "warning");
						vscode.window.showWarningMessage(`Cannot reveal extension "${item.label}" in Explorer.`);
						return;
					}

					// Check if extension directory exists
					if (!fs.existsSync(item.resourceUri.fsPath)) {
						logMessage(`Extension directory not found: ${item.resourceUri.fsPath}`, "warning");
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
						const source = ext.repository ? `${ext.repository}@${ext.latestVersion}` : `${ext.extensionId}@${ext.latestVersion}`;
						const success = await installQuartoExtension(source, ext.workspaceFolder, auth);
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

		/**
		 * Validates an extension and shows the validation results.
		 */
		context.subscriptions.push(
			vscode.commands.registerCommand(
				"quartoWizard.extensionsInstalled.validate",
				async (item: ExtensionTreeItem) => {
					const result = this.treeDataProvider.validateExtension(item.workspaceFolder, item.label);

					if (!result) {
						vscode.window.showErrorMessage(
							`Could not validate extension "${item.label}". Manifest file not found.`,
						);
						return;
					}

					if (result.issues.length === 0) {
						vscode.window.showInformationMessage(`Extension "${item.label}" passed validation with no issues.`);
						return;
					}

					// Format and show validation results
					const formattedResult = formatValidationIssues(result);
					logMessage(`Validation results for ${item.label}:\n${formattedResult}`, "info");

					const errors = result.issues.filter((i) => i.severity === "error");
					const warnings = result.issues.filter((i) => i.severity === "warning");

					if (errors.length > 0) {
						vscode.window.showErrorMessage(
							`Extension "${item.label}" has ${errors.length} error(s) and ${warnings.length} warning(s). ${showLogsCommand()}.`,
						);
					} else {
						vscode.window.showWarningMessage(
							`Extension "${item.label}" has ${warnings.length} warning(s). ${showLogsCommand()}.`,
						);
					}
				},
			),
		);
	}

	constructor(context: vscode.ExtensionContext) {
		this.initialise(context);
	}
}
