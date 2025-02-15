import * as vscode from "vscode";
import { ExtensionInfo } from "../utils/extensionInfo";

export interface ExtensionQuickPickItem extends vscode.QuickPickItem {
	url?: string;
}

export function createExtensionItems(extensions: ExtensionInfo[]): ExtensionQuickPickItem[] {
	return extensions.map((ext) => ({
		label: ext.name,
		description: ext.description,
		buttons: [
			{
				iconPath: new vscode.ThemeIcon("github"),
				tooltip: "Open GitHub Repository",
			},
		],
		url: ext.html_url,
	}));
}

export async function showExtensionQuickPick(
	extensionsList: ExtensionInfo[],
	recentlyInstalled: ExtensionInfo[]
): Promise<readonly ExtensionQuickPickItem[]> {
	const groupedExtensions: ExtensionQuickPickItem[] = [
		{
			label: "Recently Installed",
			kind: vscode.QuickPickItemKind.Separator,
		},
		...createExtensionItems(recentlyInstalled),
		{
			label: "All Extensions",
			kind: vscode.QuickPickItemKind.Separator,
		},
		...createExtensionItems(extensionsList.filter((ext) => !recentlyInstalled.includes(ext))).sort((a, b) =>
			a.label.localeCompare(b.label)
		),
	];

	const quickPick = vscode.window.createQuickPick<ExtensionQuickPickItem>();
	quickPick.items = groupedExtensions;
	quickPick.placeholder = "Select Quarto extensions to install";
	quickPick.canSelectMany = true;
	quickPick.matchOnDescription = true;
	quickPick.onDidTriggerItemButton((e) => {
		const url = e.item.url;
		if (url) {
			vscode.env.openExternal(vscode.Uri.parse(url));
		}
	});

	return new Promise((resolve) => {
		quickPick.onDidAccept(() => {
			resolve(quickPick.selectedItems);
			quickPick.hide();
		});
		quickPick.show();
	});
}
