import * as vscode from "vscode";
import { checkInternetConnection } from "../utils/network";
import { getQuartoPath, checkQuartoPath } from "../utils/quarto";
import { fetchCSVFromURL, createExtensionItems, installQuartoExtensions } from "../utils/extensions";

interface ExtensionQuickPickItem extends vscode.QuickPickItem {
	url?: string;
}

export async function installQuartoExtensionCommand(
	context: vscode.ExtensionContext,
	log: vscode.OutputChannel,
	recentlyInstalledExtensions: string
) {
	const extensionsListCsv =
		"https://raw.githubusercontent.com/mcanouil/quarto-extensions/main/extensions/quarto-extensions.csv";
	if (!vscode.workspace.workspaceFolders) {
		const message = "Please open a workspace/folder to install Quarto extensions.";
		log.appendLine(message);
		vscode.window.showErrorMessage(message);
		return;
	}

	const isConnected = await checkInternetConnection();
	if (!isConnected) {
		const message = "No internet connection. Please check your network settings.";
		log.appendLine(message);
		vscode.window.showErrorMessage(message);
		return;
	}
	await checkQuartoPath(getQuartoPath());

	let extensionsList: string[] = [];
	let recentlyInstalled: string[] = context.globalState.get(recentlyInstalledExtensions, []);

	try {
		const data = await fetchCSVFromURL(extensionsListCsv);
		extensionsList = data.split("\n").filter((line) => line.trim() !== "");
	} catch (error) {
		const message = `Error fetching list of extensions from ${extensionsListCsv}`;
		log.appendLine(message);
		vscode.window.showErrorMessage(message);
		return;
	}

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

	quickPick.onDidAccept(async () => {
		const selectedExtensions = quickPick.selectedItems;
		if (selectedExtensions.length > 0) {
			await installQuartoExtensions(selectedExtensions, log);
			const selectedDescriptions = selectedExtensions.map((ext) => ext.description);
			let updatedRecentlyInstalled = [
				...selectedDescriptions,
				...recentlyInstalled.filter((ext) => !selectedDescriptions.includes(ext)),
			];
			await context.globalState.update(recentlyInstalledExtensions, updatedRecentlyInstalled.slice(0, 5));
		}
		quickPick.hide();
	});

	quickPick.show();
}
