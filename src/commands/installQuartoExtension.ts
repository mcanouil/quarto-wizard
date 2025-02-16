import * as vscode from "vscode";
import { QW_LOG, QW_RECENTLY_INSTALLED } from "../constants";
import { showLogsCommand } from "../utils/log";
import { checkInternetConnection } from "../utils/network";
import { getQuartoPath, checkQuartoPath, installQuartoExtension, installQuartoExtensionSource } from "../utils/quarto";
import { askTrustAuthors, askConfirmInstall } from "../utils/ask";
import { getExtensionsDetails } from "../utils/extensionDetails";
import { ExtensionQuickPickItem, showExtensionQuickPick } from "../ui/extensionsQuickPick";

async function installQuartoExtensions(selectedExtensions: readonly ExtensionQuickPickItem[]) {
	if (vscode.workspace.workspaceFolders === undefined) {
		return;
	}
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
	const mutableSelectedExtensions: ExtensionQuickPickItem[] = [...selectedExtensions];

	if ((await askTrustAuthors()) !== 0) return;
	if ((await askConfirmInstall()) !== 0) return;

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `Installing selected extension(s) (${showLogsCommand()}).`,
			cancellable: true,
		},
		async (progress, token) => {
			token.onCancellationRequested(() => {
				const message = "Operation cancelled by the user.";
				QW_LOG.appendLine(message);
				vscode.window.showInformationMessage(`${message} ${showLogsCommand()}.`);
			});

			const installedExtensions: string[] = [];
			const failedExtensions: string[] = [];
			const totalExtensions = mutableSelectedExtensions.length;
			let installedCount = 0;

			for (const selectedExtension of mutableSelectedExtensions) {
				if (selectedExtension.id === undefined) {
					continue;
				}
				progress.report({
					message: `(${installedCount} / ${totalExtensions}) ${selectedExtension.label} ...`,
					increment: (1 / (totalExtensions + 1)) * 100,
				});

				const success = await installQuartoExtensionSource(selectedExtension.id, workspaceFolder);
				// Once source is supported in _extension.yml, the above line can be replaced with the following line
				// const success = await installQuartoExtension(extension);
				if (success) {
					installedExtensions.push(selectedExtension.id);
				} else {
					failedExtensions.push(selectedExtension.id);
				}

				installedCount++;
			}
			progress.report({
				message: `(${totalExtensions} / ${totalExtensions}) extensions processed.`,
				increment: (1 / (totalExtensions + 1)) * 100,
			});

			if (installedExtensions.length > 0) {
				QW_LOG.appendLine(`\n\nSuccessfully installed extension${installedExtensions.length > 1 ? "s" : ""}:`);
				installedExtensions.forEach((ext) => {
					QW_LOG.appendLine(` - ${ext}`);
				});
			}

			if (failedExtensions.length > 0) {
				QW_LOG.appendLine(`\n\nFailed to install extension${failedExtensions.length > 1 ? "s" : ""}:`);
				failedExtensions.forEach((ext) => {
					QW_LOG.appendLine(` - ${ext}`);
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
				QW_LOG.appendLine(message);
				vscode.window.showInformationMessage(`${message} ${showLogsCommand()}.`);
			}
		}
	);
}

export async function installQuartoExtensionCommand(context: vscode.ExtensionContext) {
	if (!vscode.workspace.workspaceFolders) {
		const message = `Please open a workspace/folder to install Quarto extensions.`;
		QW_LOG.appendLine(message);
		vscode.window.showErrorMessage(`${message} ${showLogsCommand()}.`);
		return;
	}

	const isConnected = await checkInternetConnection("https://github.com/");
	if (!isConnected) {
		return;
	}
	await checkQuartoPath(getQuartoPath());

	let recentlyInstalled: string[] = context.globalState.get(QW_RECENTLY_INSTALLED, []);
	const extensionsList = await getExtensionsDetails(context);
	const selectedExtensions = await showExtensionQuickPick(extensionsList, recentlyInstalled);

	if (selectedExtensions.length > 0) {
		await installQuartoExtensions(selectedExtensions);
		const selectedIDs = selectedExtensions.map((ext) => ext.id);
		let updatedRecentlyInstalled = [...selectedIDs, ...recentlyInstalled.filter((ext) => !selectedIDs.includes(ext))];
		console.log(selectedIDs);
		await context.globalState.update(QW_RECENTLY_INSTALLED, updatedRecentlyInstalled.slice(0, 5));
	}
}
