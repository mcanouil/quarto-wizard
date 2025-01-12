import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { findQuartoExtensions } from "../utils/extensions";
import { ExtensionData, readExtensions } from "../utils/extensions";
import { installQuartoExtension, removeQuartoExtension } from "../utils/quarto";
import { askTrustAuthors, askConfirmInstall } from "../utils/ask";

class ExtensionTreeItem extends vscode.TreeItem {
	constructor(
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly data?: ExtensionData
	) {
		super(label, collapsibleState);
		this.tooltip = `${this.label}`;
		this.description = this.data ? `${this.data.version}` : "";
		this.contextValue = data ? "quartoExtensionItem" : "quartoExtensionItemDetails";
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
					new ExtensionTreeItem("No extensions installed.", vscode.TreeItemCollapsibleState.None),
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
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
		if (workspaceFolder === undefined) {
			return;
		}
		this.treeDataProvider = new QuartoExtensionTreeDataProvider(workspaceFolder);
		const view = vscode.window.createTreeView("quartoWizard.extensionsInstalled", {
			treeDataProvider: this.treeDataProvider,
			showCollapseAll: true,
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
			vscode.commands.registerCommand("quartoWizard.extensionsInstalled.update", (item: ExtensionTreeItem) => {
				if (item.data?.source) {
					installQuartoExtension(item.data?.source, log);
				} else {
					installQuartoExtension(item.label, log);
				}
			})
		);
		context.subscriptions.push(
			vscode.commands.registerCommand("quartoWizard.extensionsInstalled.remove", (item: ExtensionTreeItem) => {
				removeQuartoExtension(item.label, log);
			})
		);
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
	}
}
