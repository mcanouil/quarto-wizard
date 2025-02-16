import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises"; // Use the promise-based fs module
import * as semver from "semver";
import { logMessage, showLogsCommand } from "../utils/log";
import { ExtensionData, findQuartoExtensions, readExtensions } from "../utils/extensions";
import { removeQuartoExtension, installQuartoExtensionSource } from "../utils/quarto";
import { getExtensionsDetails } from "../utils/extensionDetails";
import { debounce } from "lodash"; // Import debounce from lodash

class ExtensionTreeItem extends vscode.TreeItem {
	constructor(
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly data?: ExtensionData,
		icon?: string,
		newVersion?: string
	) {
		super(label, collapsibleState);
		this.tooltip = `${this.label}`;
		this.description = this.data ? `${this.data.version}${newVersion ? ` > ${newVersion}` : ""}` : "";
		this.contextValue = data ? "quartoExtensionItem" : "quartoExtensionItemDetails";
		if (icon) {
			this.iconPath = new vscode.ThemeIcon(icon);
		}
	}
}

class QuartoExtensionTreeDataProvider implements vscode.TreeDataProvider<ExtensionTreeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<ExtensionTreeItem | undefined | void> = new vscode.EventEmitter<
		ExtensionTreeItem | undefined | void
	>();
	readonly onDidChangeTreeData: vscode.Event<ExtensionTreeItem | undefined | void> = this._onDidChangeTreeData.event;

	private workspaceFolder: string;

	constructor(workspaceFolder: string) {
		this.workspaceFolder = workspaceFolder;
		this.refreshExtensionsData();
	}

	private extensionsData: Record<string, ExtensionData> = {};
	private newVersions: Record<string, string> = {};

	getTreeItem(element: ExtensionTreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: ExtensionTreeItem): Thenable<ExtensionTreeItem[]> {
		if (!element) {
			if (Object.keys(this.extensionsData).length === 0) {
				return Promise.resolve([
					new ExtensionTreeItem("No extensions installed", vscode.TreeItemCollapsibleState.None, undefined),
				]);
			}
			return Promise.resolve(this.getExtensionItems());
		}
		return Promise.resolve(this.getExtensionDetailItems(element));
	}

	private getExtensionItems(): ExtensionTreeItem[] {
		return Object.keys(this.extensionsData).map(
			(ext) =>
				new ExtensionTreeItem(
					ext,
					vscode.TreeItemCollapsibleState.Collapsed,
					this.extensionsData[ext],
					"package",
					this.newVersions?.[ext]
				)
		);
	}

	private getExtensionDetailItems(element: ExtensionTreeItem): ExtensionTreeItem[] {
		const data = element.data;
		if (!data) {
			return [];
		}
		return [
			new ExtensionTreeItem(`Title: ${data.title}`, vscode.TreeItemCollapsibleState.None),
			new ExtensionTreeItem(`Author: ${data.author}`, vscode.TreeItemCollapsibleState.None),
			new ExtensionTreeItem(`Version: ${data.version}`, vscode.TreeItemCollapsibleState.None),
			new ExtensionTreeItem(`Source: ${data.source}`, vscode.TreeItemCollapsibleState.None),
			new ExtensionTreeItem(`Contributes: ${data.contributes}`, vscode.TreeItemCollapsibleState.None),
		];
	}

	refresh = debounce((): void => {
		this.refreshExtensionsData();
		this._onDidChangeTreeData.fire();
	}, 300); // Debounce refresh calls with a 300ms delay

	forceRefresh(): void {
		this.refresh();
		this.refresh.flush();
	}

	private async refreshExtensionsData(): Promise<void> {
		let extensionsList: string[] = [];
		const extensionsPath = path.join(this.workspaceFolder, "_extensions");
		try {
			await fs.access(extensionsPath);
			extensionsList = findQuartoExtensions(extensionsPath);
			this.extensionsData = readExtensions(this.workspaceFolder, extensionsList);
		} catch (error) {
			const message = "Error refreshing installed extensions data:";
			logMessage(`${message} ${error}`);
			vscode.window.showErrorMessage(`${message}. ${showLogsCommand()}`);
		}
	}

	async checkUpdate(
		context: vscode.ExtensionContext,
		view?: vscode.TreeView<ExtensionTreeItem>,
		silent: boolean = true
	): Promise<number> {
		const extensionsDetails = await getExtensionsDetails(context);
		const updatesAvailable: string[] = [];
		const newVersions: Record<string, string> = {};

		for (const ext of Object.keys(this.extensionsData)) {
			const extensionData = this.extensionsData[ext];
			const matchingDetail = extensionsDetails.find((detail) => detail.id === extensionData.source);
			if (!extensionData.version || extensionData.version === "none") {
				continue;
			}
			if (!matchingDetail?.version || matchingDetail.version === "none") {
				continue;
			}
			if (matchingDetail && semver.lt(extensionData.version, matchingDetail.version)) {
				updatesAvailable.push(ext);
				newVersions[ext] = matchingDetail.version;
			}
		}

		if (updatesAvailable.length > 0 && !silent) {
			const message = `Updates available for the following extensions: ${updatesAvailable.join(", ")}.`;
			logMessage(message);
			vscode.window.showInformationMessage(`${message} ${showLogsCommand()}.`);
		}

		if (view) {
			view.badge = {
				value: updatesAvailable.length,
				tooltip: `${updatesAvailable.length} update${updatesAvailable.length === 1 ? "" : "s"} available`,
			};
		}

		this.newVersions = newVersions;
		return updatesAvailable.length;
	}
}

export class ExtensionsInstalled {
	private treeDataProvider!: QuartoExtensionTreeDataProvider;

	private async initialise(context: vscode.ExtensionContext) {
		if (vscode.workspace.workspaceFolders === undefined) {
			return;
		}

		const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
		this.treeDataProvider = new QuartoExtensionTreeDataProvider(workspaceFolder);
		const view = vscode.window.createTreeView("quartoWizard.extensionsInstalled", {
			treeDataProvider: this.treeDataProvider,
			showCollapseAll: true,
		});

		await this.treeDataProvider.checkUpdate(context, view, false);
		await this.treeDataProvider.refresh();

		view.onDidChangeVisibility((e) => {
			if (e.visible) {
				this.treeDataProvider.checkUpdate(context, view);
				this.treeDataProvider.refresh();
			}
		});
		view.onDidChangeSelection((e) => {
			if (e.selection) {
				this.treeDataProvider.checkUpdate(context, view);
				this.treeDataProvider.refresh();
			}
		});
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
			vscode.commands.registerCommand("quartoWizard.extensionsInstalled.update", async (item: ExtensionTreeItem) => {
				const success = await installQuartoExtensionSource(item.data?.source ?? item.label, workspaceFolder);
				// Once source is supported in _extension.yml, the above line can be replaced with the following line
				// const success = await installQuartoExtension(item.data?.source ?? item.label);
				if (success) {
					vscode.window.showInformationMessage(`Extension "${item.label}" updated successfully.`);
				} else {
					if (item.data?.source === undefined) {
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
				const success = await removeQuartoExtension(item.label);
				if (success) {
					vscode.window.showInformationMessage(`Extension "${item.label}" removed successfully.`);
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
