import * as vscode from "vscode";
import { ExtensionDetails } from "../utils/extensionDetails";

/**
 * Interface representing a QuickPick item for an extension.
 */
export interface ExtensionQuickPickItem extends vscode.QuickPickItem {
	url?: string;
	id?: string;
	tag?: string;
	template?: boolean;
}

/**
 * Creates QuickPick items from extension details.
 * @param {ExtensionDetails[]} extensions - The list of extension details.
 * @returns {ExtensionQuickPickItem[]} - An array of QuickPick items.
 */
export function createExtensionItems(extensions: ExtensionDetails[]): ExtensionQuickPickItem[] {
	return extensions.map((ext) => ({
		label: ext.name,
		description: `$(tag) ${ext.version} $(star) ${ext.stars.toString()} $(repo) ${ext.full_name} $(law) ${ext.license}`,
		detail: `${ext.description}`,
		buttons: [
			{
				iconPath: new vscode.ThemeIcon("github"),
				tooltip: "Open GitHub Repository",
			},
		],
		url: ext.html_url,
		id: ext.id,
		tag: ext.tag,
		template: ext.template,
	}));
}

/**
 * Shows a QuickPick for selecting Quarto extensions.
 * @param {ExtensionDetails[]} extensionsList - The list of extension details.
 * @param {string[]} recentlyInstalled - The list of recently installed or used extensions.
 * @param {boolean} [template=false] - Whether this is for template selection. If true, only one template can be selected.
 * @returns {Promise<readonly ExtensionQuickPickItem[]>} - A promise that resolves to the selected QuickPick items.
 */
export async function showExtensionQuickPick(
	extensionsList: ExtensionDetails[],
	recentlyInstalled: string[],
	template = false
): Promise<readonly ExtensionQuickPickItem[]> {
	const groupedExtensions: ExtensionQuickPickItem[] = [
		{
			label: template ? "Recently Used" : "Recently Installed",
			kind: vscode.QuickPickItemKind.Separator,
		},
		...createExtensionItems(extensionsList.filter((ext) => recentlyInstalled.includes(ext.id))),
		{
			label: "All Extensions",
			kind: vscode.QuickPickItemKind.Separator,
		},
		...createExtensionItems(extensionsList.filter((ext) => !recentlyInstalled.includes(ext.id))).sort((a, b) =>
			a.label.localeCompare(b.label)
		),
	];

	const quickPick = vscode.window.createQuickPick<ExtensionQuickPickItem>();
	quickPick.items = groupedExtensions;
	quickPick.placeholder = template ? "Select Quarto extension template to use" : "Select Quarto extensions to install";
	quickPick.canSelectMany = !template;
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
