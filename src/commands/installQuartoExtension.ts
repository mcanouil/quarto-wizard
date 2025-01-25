import * as vscode from "vscode";
import { checkInternetConnection } from "../utils/network";
import { getQuartoPath, checkQuartoPath, installQuartoExtension, installQuartoExtensionSource } from "../utils/quarto";
import { fetchCSVFromURL } from "../utils/extensions";
import { showLogsCommand } from "../utils/log";
import { askTrustAuthors, askConfirmInstall } from "../utils/ask";
import { ExtensionQuickPickItem, showExtensionQuickPick } from "../ui/extensionsQuickPick";

async function installQuartoExtensions(
	selectedExtensions: readonly ExtensionQuickPickItem[],
	log: vscode.OutputChannel
) {
	if (vscode.workspace.workspaceFolders === undefined) {
		return;
	}
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
	const mutableSelectedExtensions: ExtensionQuickPickItem[] = [...selectedExtensions];

	if ((await askTrustAuthors(log)) !== 0) return;
	if ((await askConfirmInstall(log)) !== 0) return;

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `Installing selected extension(s) (${showLogsCommand()})`,
			cancellable: true,
		},
		async (progress, token) => {
			token.onCancellationRequested(() => {
				const message = `Operation cancelled by the user (${showLogsCommand()}).`;
				log.appendLine(message);
				vscode.window.showInformationMessage(message);
			});

			const installedExtensions: string[] = [];
			const failedExtensions: string[] = [];
			const totalExtensions = mutableSelectedExtensions.length;
			let installedCount = 0;

			for (const selectedExtension of mutableSelectedExtensions) {
				if (selectedExtension.description === undefined) {
					continue;
				}
				progress.report({
					message: `(${installedCount} / ${totalExtensions}) ${selectedExtension.label} ...`,
					increment: (1 / (totalExtensions + 1)) * 100,
				});

				const success = await installQuartoExtensionSource(selectedExtension.description, log, workspaceFolder);
				// Once source is supported in _extension.yml, the above line can be replaced with the following line
				// const success = await installQuartoExtension(extension, log);
				if (success) {
					installedExtensions.push(selectedExtension.description);
				} else {
					failedExtensions.push(selectedExtension.description);
				}

				installedCount++;
			}
			progress.report({
				message: `(${totalExtensions} / ${totalExtensions}) extensions processed.`,
				increment: (1 / (totalExtensions + 1)) * 100,
			});

			if (installedExtensions.length > 0) {
				log.appendLine(`\n\nSuccessfully installed extension${installedExtensions.length > 1 ? "s" : ""}:`);
				installedExtensions.forEach((ext) => {
					log.appendLine(` - ${ext}`);
				});
			}

			if (failedExtensions.length > 0) {
				log.appendLine(`\n\nFailed to install extension${failedExtensions.length > 1 ? "s" : ""}:`);
				failedExtensions.forEach((ext) => {
					log.appendLine(` - ${ext}`);
				});
				const message = [
					"The following extension",
					failedExtensions.length > 1 ? "s were" : " was",
					" not installed, try installing ",
					failedExtensions.length > 1 ? "them" : "it",
					" manually with `quarto add <extension>`:",
				].join("");
				vscode.window.showErrorMessage(`${message} ${failedExtensions.join(", ")}. ${showLogsCommand()}.`);
			} else {
				const message = [installedCount, " extension", installedCount > 1 ? "s" : "", " installed successfully."].join(
					""
				);
				log.appendLine(message);
				vscode.window.showInformationMessage(`${message} ${showLogsCommand()}.`);
			}
		}
	);
}

export async function installQuartoExtensionCommand(
	context: vscode.ExtensionContext,
	log: vscode.OutputChannel,
	recentlyInstalledExtensions: string
) {
	const extensionsListCsv =
		"https://raw.githubusercontent.com/mcanouil/quarto-extensions/main/extensions/quarto-extensions.csv";
	if (!vscode.workspace.workspaceFolders) {
		const message = `Please open a workspace/folder to install Quarto extensions. ${showLogsCommand()}.`;
		log.appendLine(message);
		vscode.window.showErrorMessage(message);
		return;
	}

	const isConnected = await checkInternetConnection("https://github.com/", log);
	if (!isConnected) {
		return;
	}
	await checkQuartoPath(getQuartoPath());

	let extensionsList: string[] = [];
	let recentlyInstalled: string[] = context.globalState.get(recentlyInstalledExtensions, []);

	try {
		const data = await fetchCSVFromURL(extensionsListCsv);
		extensionsList = data.split("\n").filter((line) => line.trim() !== "");
	} catch (error) {
		const message = `Error fetching list of extensions from ${extensionsListCsv}. ${showLogsCommand()}/`;
		log.appendLine(message);
		vscode.window.showErrorMessage(message);
		return;
	}

	const selectedExtensions = await showExtensionQuickPick(extensionsList, recentlyInstalled);

	if (selectedExtensions.length > 0) {
		await installQuartoExtensions(selectedExtensions, log);
		const selectedDescriptions = selectedExtensions.map((ext) => ext.description);
		let updatedRecentlyInstalled = [
			...selectedDescriptions,
			...recentlyInstalled.filter((ext) => !selectedDescriptions.includes(ext)),
		];
		await context.globalState.update(recentlyInstalledExtensions, updatedRecentlyInstalled.slice(0, 5));
	}
}
