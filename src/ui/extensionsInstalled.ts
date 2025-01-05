import * as vscode from "vscode";
import * as path from "path";
import { findQuartoExtensions } from "../utils/extensions";
import { QuartoExtensionData, readExtensions } from "../utils/extensions";

class QuartoExtensionTreeItem extends vscode.TreeItem {
	constructor(
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly data?: QuartoExtensionData
	) {
		super(label, collapsibleState);
		this.tooltip = `${this.label}`;
		this.description = this.data ? `${this.data.version}` : "";
		this.contextValue = data ? "quartoExtensionItem" : "quartoExtensionItemDetails";
	}
}

class QuartoExtensionTreeDataProvider implements vscode.TreeDataProvider<QuartoExtensionTreeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<QuartoExtensionTreeItem | undefined | void> =
		new vscode.EventEmitter<QuartoExtensionTreeItem | undefined | void>();
	readonly onDidChangeTreeData: vscode.Event<QuartoExtensionTreeItem | undefined | void> =
		this._onDidChangeTreeData.event;

	private workspaceFolder: string;

	constructor(workspaceFolder: string) {
		this.workspaceFolder = workspaceFolder;
		this.refreshExtensionsData();
	}

	private extensionsData: Record<string, QuartoExtensionData> = {};

	getTreeItem(element: QuartoExtensionTreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: QuartoExtensionTreeItem): Thenable<QuartoExtensionTreeItem[]> {
		if (!element) {
			return Promise.resolve(this.getExtensionItems());
		}
		return Promise.resolve(this.getExtensionDetailItems(element));
	}

	private getExtensionItems(): QuartoExtensionTreeItem[] {
		return Object.keys(this.extensionsData).map(
			(ext) => new QuartoExtensionTreeItem(ext, vscode.TreeItemCollapsibleState.Collapsed, this.extensionsData[ext])
		);
	}

	private getExtensionDetailItems(element: QuartoExtensionTreeItem): QuartoExtensionTreeItem[] {
		const data = element.data;
		if (!data) {
			return [];
		}
		return [
			new QuartoExtensionTreeItem(`Title: ${data.title}`, vscode.TreeItemCollapsibleState.None),
			new QuartoExtensionTreeItem(`Author: ${data.author}`, vscode.TreeItemCollapsibleState.None),
			new QuartoExtensionTreeItem(`Version: ${data.version}`, vscode.TreeItemCollapsibleState.None),
			new QuartoExtensionTreeItem(`Source: ${data.source}`, vscode.TreeItemCollapsibleState.None),
			new QuartoExtensionTreeItem(`Contributes: ${data.contributes}`, vscode.TreeItemCollapsibleState.None),
		];
	}

	refresh(): void {
		this.refreshExtensionsData();
		this._onDidChangeTreeData.fire();
	}

	private refreshExtensionsData(): void {
		const extensionsList = findQuartoExtensions(path.join(this.workspaceFolder, "_extensions"));
		this.extensionsData = readExtensions(this.workspaceFolder, extensionsList);
	}
}

export class QuartoExtensionsInstalled {
	private treeDataProvider: QuartoExtensionTreeDataProvider;

	constructor(context: vscode.ExtensionContext) {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath || "";
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
			vscode.commands.registerCommand(
				"quartoWizard.extensionsInstalled.openSource",
				(item: QuartoExtensionTreeItem) => {
					if (item.data?.source) {
						const url = `https://github.com/${item.data?.source}`;
						vscode.env.openExternal(vscode.Uri.parse(url));
					}
				}
			)
		);
	}
}
