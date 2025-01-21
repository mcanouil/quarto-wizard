import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { findQuartoExtensions } from "../utils/extensions";
import { ExtensionData, readExtensions } from "../utils/extensions";
import { removeQuartoExtension, installQuartoExtensionSource } from "../utils/quarto";
import { showLogsCommand } from "../utils/log";

class ExtensionTreeItem extends vscode.TreeItem {
	constructor(
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly data?: ExtensionData,
		icon?: string
	) {
		super(label, collapsibleState);
		this.tooltip = `${this.label}`;
		this.description = this.data ? `${this.data.version}` : "";
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

	getTreeItem(element: ExtensionTreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: ExtensionTreeItem): Thenable<ExtensionTreeItem[]> {
		if (!element) {
			if (Object.keys(this.extensionsData).length === 0) {
				return Promise.resolve([
					new ExtensionTreeItem("No extensions installed", vscode.TreeItemCollapsibleState.None, undefined, "info"),
				]);
			}
			return Promise.resolve(this.getExtensionItems());
		}
		return Promise.resolve(this.getExtensionDetailItems(element));
	}

	private getExtensionItems(): ExtensionTreeItem[] {
		return Object.keys(this.extensionsData).map(
			(ext) => new ExtensionTreeItem(ext, vscode.TreeItemCollapsibleState.Collapsed, this.extensionsData[ext])
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

	refresh(): void {
		this.refreshExtensionsData();
		this._onDidChangeTreeData.fire();
	}

	private refreshExtensionsData(): void {
		let extensionsList: string[] = [];
		if (fs.existsSync(path.join(this.workspaceFolder, "_extensions"))) {
			extensionsList = findQuartoExtensions(path.join(this.workspaceFolder, "_extensions"));
		}
		this.extensionsData = readExtensions(this.workspaceFolder, extensionsList);
	}
}

export class ExtensionsInstalled {
	private treeDataProvider!: QuartoExtensionTreeDataProvider;

	constructor(context: vscode.ExtensionContext, log: vscode.OutputChannel) {
		if (vscode.workspace.workspaceFolders === undefined) {
			return;
		}
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
		this.treeDataProvider = new QuartoExtensionTreeDataProvider(workspaceFolder);
		const view = vscode.window.createTreeView("quartoWizard.extensionsInstalled", {
			treeDataProvider: this.treeDataProvider,
			showCollapseAll: true,
		});
		view.onDidChangeVisibility((e) => {
			if (e.visible) {
				this.treeDataProvider.refresh();
			}
		});
		view.onDidChangeSelection((e) => {
			if (e.selection) {
				this.treeDataProvider.refresh();
			}
		});
		context.subscriptions.push(view);
		context.subscriptions.push(
			vscode.commands.registerCommand("quartoWizard.extensionsInstalled.refresh", () => this.treeDataProvider.refresh())
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
				const success = await installQuartoExtensionSource(item.data?.source ?? item.label, log, workspaceFolder);
				// Once source is supported in _extension.yml, the above line can be replaced with the following line
				// const success = await installQuartoExtension(item.data?.source ?? item.label, log);
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
				const success = await removeQuartoExtension(item.label, log);
				if (success) {
					vscode.window.showInformationMessage(`Extension "${item.label}" removed successfully.`);
				} else {
					vscode.window.showErrorMessage(`Failed to remove extension "${item.label}". ${showLogsCommand()}.`);
				}
			})
		);
	}
}
