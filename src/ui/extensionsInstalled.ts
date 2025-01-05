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
	}
}

class QuartoExtensionTreeDataProvider implements vscode.TreeDataProvider<QuartoExtensionTreeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<QuartoExtensionTreeItem | undefined | void> =
		new vscode.EventEmitter<QuartoExtensionTreeItem | undefined | void>();
	readonly onDidChangeTreeData: vscode.Event<QuartoExtensionTreeItem | undefined | void> =
		this._onDidChangeTreeData.event;

	constructor(private extensionsData: Record<string, QuartoExtensionData>) {}

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
		this._onDidChangeTreeData.fire();
	}
}

export class QuartoExtensionsInstalled {
	private treeDataProvider: QuartoExtensionTreeDataProvider;

	constructor(context: vscode.ExtensionContext) {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath || "";
		const extensionsList = findQuartoExtensions(path.join(workspaceFolder, "_extensions"));
		const extensionsData = readExtensions(workspaceFolder, extensionsList);

		this.treeDataProvider = new QuartoExtensionTreeDataProvider(extensionsData);
		const view = vscode.window.createTreeView("quartoWizard.extensionsInstalled", {
			treeDataProvider: this.treeDataProvider,
			showCollapseAll: true,
		});
		context.subscriptions.push(view);
		context.subscriptions.push(
			vscode.commands.registerCommand("quartoWizard.extensionsInstalled.refresh", () => this.treeDataProvider.refresh())
		);
	}
}
