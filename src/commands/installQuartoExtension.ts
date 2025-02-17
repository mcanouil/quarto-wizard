import * as vscode from "vscode";
import { QW_RECENTLY_INSTALLED } from "../constants";
import { showLogsCommand, logMessage } from "../utils/log";
import { checkInternetConnection } from "../utils/network";
import { getQuartoPath, checkQuartoPath, installQuartoExtension, installQuartoExtensionSource } from "../utils/quarto";
import { askTrustAuthors, askConfirmInstall } from "../utils/ask";
import { getExtensionsDetails } from "../utils/extensionDetails";
import { ExtensionQuickPickItem, showExtensionQuickPick } from "../ui/extensionsQuickPick";

/**
 * Installs the selected Quarto extensions.
 *
 * @param selectedExtensions - The extensions selected by the user for installation.
 */
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
			title: `Installing selected extension(s) (${showLogsCommand()})`,
			cancellable: true,
		},
		async (progress, token) => {
			token.onCancellationRequested(() => {
				const message = "Operation cancelled by the user.";
				logMessage(message, "info");
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
				logMessage(`Successfully installed extension${installedExtensions.length > 1 ? "s" : ""}:`, "info");
				installedExtensions.forEach((ext) => {
					logMessage(` - ${ext}`, "info");
				});
			}

			if (failedExtensions.length > 0) {
				logMessage(`Failed to install extension${failedExtensions.length > 1 ? "s" : ""}:`, "error");
				failedExtensions.forEach((ext) => {
					logMessage(` - ${ext}`, "error");
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
				logMessage(message, "info");
				vscode.window.showInformationMessage(`${message} ${showLogsCommand()}.`);
			}
		}
	);
}

/**
 * Command to install Quarto extensions.
 * Prompts the user to select extensions and installs them.
 *
 * @param context - The extension context.
 */
export async function installQuartoExtensionCommand(context: vscode.ExtensionContext) {
	if (!vscode.workspace.workspaceFolders) {
		const message = `Please open a workspace/folder to install Quarto extensions.`;
		logMessage(message, "error");
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
