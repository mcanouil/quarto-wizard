import * as vscode from 'vscode';
import * as path from 'path';
import { findQuartoExtensions } from '../utils/extensions';

export class ExtensionsInstalled {
	constructor(context: vscode.ExtensionContext) {
		const view = vscode.window.createTreeView('quartoWizard.extensionsInstalled', { treeDataProvider: quartoExtensionsTreeDataProvider(), showCollapseAll: true });
		context.subscriptions.push(view);
		vscode.commands.registerCommand('quartoWizard.extensionsInstalled.reveal', async () => {
			const key = await vscode.window.showInputBox({ placeHolder: 'Type the label of the item to reveal' });
			if (key) {
				await view.reveal({ key }, { focus: true, select: false, expand: true });
			}
		});
	}
}

const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
const extensionsPath = path.join(workspaceFolder, "_extensions");
const extensionsList = findQuartoExtensions(extensionsPath);

const extensionsTree: any = {};
extensionsList.forEach(extension => {
    extensionsTree[extension] = {
        version: "unknown", // Placeholder for actual version
        author: "unknown"   // Placeholder for actual author
    };
});
const nodes: any = {};
console.log("Extensions Tree:", extensionsTree);

function quartoExtensionsTreeDataProvider(): vscode.TreeDataProvider<{ key: string }> {
	return {
		getChildren: (element: { key: string }): { key: string }[] => {
			return getChildren(element ? element.key : undefined).map(key => getNode(key));
		},
		getTreeItem: (element: { key: string }): vscode.TreeItem => {
			const treeItem = getTreeItem(element.key);
			treeItem.id = element.key;
			return treeItem;
		},
		getParent: ({ key }: { key: string }): { key: string } | undefined => {
			const parentKey = key.substring(0, key.length - 1);
			return parentKey ? new Key(parentKey) : undefined;
		}
	};
}

function getChildren(key: string | undefined): string[] {
	if (!key) {
		return Object.keys(extensionsTree);
	}
	const treeElement = getTreeElement(key);
	if (treeElement) {
		return Object.keys(treeElement);
	}
	return [];
}

function getTreeItem(key: string): vscode.TreeItem {
	const treeElement = getTreeElement(key);
	const tooltip = new vscode.MarkdownString(`$(zap) Tooltip for ${key}`, true);
	return {
		label: /**vscode.TreeItemLabel**/{ label: key as any },
		tooltip,
		collapsibleState: treeElement && Object.keys(treeElement).length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
	};
}

function getTreeElement(element: string): any {
	let parent = extensionsTree;
	for (let i = 0; i < element.length; i++) {
		parent = parent[element.substring(0, i + 1)];
		if (!parent) {
			return null;
		}
	}
	return parent;
}

function getNode(key: string): { key: string } {
	if (!nodes[key]) {
		nodes[key] = new Key(key);
	}
	return nodes[key];
}

class Key {
	constructor(readonly key: string) { }
}
