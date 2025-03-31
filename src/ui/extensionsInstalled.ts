import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as semver from "semver";
import { debounce } from "lodash";
import { logMessage, showLogsCommand } from "../utils/log";
import { ExtensionData, findQuartoExtensions, readExtensions } from "../utils/extensions";
import { removeQuartoExtension, installQuartoExtensionSource } from "../utils/quarto";
import { getExtensionsDetails } from "../utils/extensionDetails";
import { installQuartoExtensionFolderCommand } from "../commands/installQuartoExtension";

/**
 * Represents a tree item for a workspace folder.
 */
class WorkspaceFolderTreeItem extends vscode.TreeItem {
	public workspaceFolder: string;

	constructor(public readonly label: string, public readonly folderPath: string) {
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

	constructor(
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly workspacePath: string,
		public readonly data?: ExtensionData,
		icon?: string,
		latestVersion?: string
	) {
		super(label, collapsibleState);
		const needsUpdate = latestVersion !== undefined;
		const baseContextValue = "quartoExtensionItem";
		let contextValue = baseContextValue;
		if (needsUpdate) {
			contextValue = baseContextValue + "Outdated";
		} else if (data && !this.data?.source) {
			contextValue = baseContextValue + "NoSource";
		}
		this.tooltip = `${this.label}`;
		this.description = this.data ? `${this.data.version}${needsUpdate ? ` (latest: ${latestVersion})` : ""}` : "";
		this.contextValue = contextValue;
		if (icon) {
			this.iconPath = new vscode.ThemeIcon(icon);
		}
		this.latestVersion = latestVersion !== "unknown" ? `@${latestVersion}` : "";
		this.workspaceFolder = workspacePath;
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

	private extensionsDataByFolder: Record<string, Record<string, ExtensionData>> = {};
	private latestVersionsByFolder: Record<string, Record<string, string>> = {};

	constructor(private workspaceFolders: readonly vscode.WorkspaceFolder[]) {
		this.refreshAllExtensionsData();
	}

	getTreeItem(element: WorkspaceFolderTreeItem | ExtensionTreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(
		element?: WorkspaceFolderTreeItem | ExtensionTreeItem
	): Thenable<(WorkspaceFolderTreeItem | ExtensionTreeItem)[]> {
		if (!element) {
			if (this.workspaceFolders.length === 0) {
				return Promise.resolve([
					new ExtensionTreeItem(
						"No workspace folders open.",
						vscode.TreeItemCollapsibleState.None,
						"",
						undefined,
						"info"
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
					"info"
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
					this.latestVersionsByFolder[workspacePath]?.[ext]
				)
		);
	}

	private getExtensionDetailItems(element: ExtensionTreeItem): ExtensionTreeItem[] {
		const data = element.data;
		if (!data) {
			return [];
		}
		return [
			new ExtensionTreeItem(`Source: ${data.source}`, vscode.TreeItemCollapsibleState.None, element.workspaceFolder),
			new ExtensionTreeItem(`Title: ${data.title}`, vscode.TreeItemCollapsibleState.None, element.workspaceFolder),
			new ExtensionTreeItem(`Author: ${data.author}`, vscode.TreeItemCollapsibleState.None, element.workspaceFolder),
			new ExtensionTreeItem(`Version: ${data.version}`, vscode.TreeItemCollapsibleState.None, element.workspaceFolder),
			new ExtensionTreeItem(
				`Contributes: ${data.contributes}`,
				vscode.TreeItemCollapsibleState.None,
				element.workspaceFolder
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

	private refreshAllExtensionsData(): void {
		this.extensionsDataByFolder = {};

		for (const folder of this.workspaceFolders) {
			const workspaceFolder = folder.uri.fsPath;
			let extensionsList: string[] = [];

			if (fs.existsSync(path.join(workspaceFolder, "_extensions"))) {
				extensionsList = findQuartoExtensions(path.join(workspaceFolder, "_extensions"));
			}

			this.extensionsDataByFolder[workspaceFolder] = readExtensions(workspaceFolder, extensionsList);
		}
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
		silent = true
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
				const matchingDetail = extensionsDetails.find((detail) => detail.id === extensionData.source);

				if (!extensionData.version || extensionData.version === "none") {
					continue;
				}

				if (matchingDetail?.version === "none") {
					this.latestVersionsByFolder[workspacePath][ext] = "unknown";
					continue;
				}

				if (matchingDetail && semver.lt(extensionData.version, matchingDetail.version)) {
					updatesAvailable.push(`${folder.name}/${ext}`);
					this.latestVersionsByFolder[workspacePath][ext] = matchingDetail.version;
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

		this.treeDataProvider.checkUpdate(context, view, false);
		this.treeDataProvider.refresh();

		view.onDidChangeVisibility((e) => {
			if (e.visible) {
				this.treeDataProvider.checkUpdate(context, view);
				this.treeDataProvider.refresh();
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
				this.treeDataProvider.forceRefresh();
				this.treeDataProvider.checkUpdate(context, view);
				this.treeDataProvider.forceRefresh();
			})
		);

		context.subscriptions.push(
			vscode.commands.registerCommand("quartoWizard.extensionsInstalled.openSource", (item: ExtensionTreeItem) => {
				if (item.data?.source) {
					const url = `https://github.com/${item.data?.source}`;
					vscode.env.openExternal(vscode.Uri.parse(url));
				}
			})
		);

		context.subscriptions.push(
			vscode.commands.registerCommand("quartoWizard.extensionsInstalled.install", async (item: ExtensionTreeItem) => {
				installQuartoExtensionFolderCommand(context, item.workspaceFolder, false);
			})
		);

		context.subscriptions.push(
			vscode.commands.registerCommand(
				"quartoWizard.extensionsInstalled.useTemplate",
				async (item: ExtensionTreeItem) => {
					installQuartoExtensionFolderCommand(context, item.workspaceFolder, true);
				}
			)
		);

		context.subscriptions.push(
			vscode.commands.registerCommand("quartoWizard.extensionsInstalled.update", async (item: ExtensionTreeItem) => {
				const success = await installQuartoExtensionSource(
					`${item.data?.source ?? item.label}${item.latestVersion}`,
					item.workspaceFolder
				);
				// Once source is supported in _extension.yml, the above line can be replaced with the following line
				// const success = await installQuartoExtension(item.data?.source ?? item.label);
				if (success) {
					vscode.window.showInformationMessage(`Extension "${item.label}" updated successfully.`);
					this.treeDataProvider.forceRefresh();
				} else {
					if (!item.data?.source) {
						vscode.window.showErrorMessage(
							`Failed to update extension "${item.label}". ` +
								`Source not found in extension manifest. ` +
								`${showLogsCommand()}.`
						);
					} else {
						vscode.window.showErrorMessage(`Failed to update extension ${item.label}. ${showLogsCommand()}.`);
					}
				}
			})
		);

		context.subscriptions.push(
			vscode.commands.registerCommand("quartoWizard.extensionsInstalled.remove", async (item: ExtensionTreeItem) => {
				const success = await removeQuartoExtension(item.label, item.workspaceFolder);
				if (success) {
					vscode.window.showInformationMessage(`Extension "${item.label}" removed successfully.`);
					this.treeDataProvider.forceRefresh();
				} else {
					vscode.window.showErrorMessage(`Failed to remove extension "${item.label}". ${showLogsCommand()}.`);
				}
			})
		);
	}

	constructor(context: vscode.ExtensionContext) {
		this.initialise(context);
	}
}
