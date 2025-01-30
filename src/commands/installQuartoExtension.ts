import * as vscode from "vscode";
import { QUARTO_WIZARD_EXTENSIONS, QUARTO_WIZARD_LOG } from "../constants";
import { checkInternetConnection } from "../utils/network";
import { getQuartoPath, checkQuartoPath, installQuartoExtension, installQuartoExtensionSource } from "../utils/quarto";
import { fetchExtensions } from "../utils/extensions";
import { showLogsCommand } from "../utils/log";
import { askTrustAuthors, askConfirmInstall } from "../utils/ask";
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
			title: `Installing selected extension(s) (${showLogsCommand()})`,
			cancellable: true,
		},
		async (progress, token) => {
			token.onCancellationRequested(() => {
				const message = `Operation cancelled by the user (${showLogsCommand()}).`;
				QUARTO_WIZARD_LOG.appendLine(message);
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

				const success = await installQuartoExtensionSource(selectedExtension.description, workspaceFolder);
				// Once source is supported in _extension.yml, the above line can be replaced with the following line
				// const success = await installQuartoExtension(extension);
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
				QUARTO_WIZARD_LOG.appendLine(
					`\n\nSuccessfully installed extension${installedExtensions.length > 1 ? "s" : ""}:`
				);
				installedExtensions.forEach((ext) => {
					QUARTO_WIZARD_LOG.appendLine(` - ${ext}`);
				});
			}

			if (failedExtensions.length > 0) {
				QUARTO_WIZARD_LOG.appendLine(`\n\nFailed to install extension${failedExtensions.length > 1 ? "s" : ""}:`);
				failedExtensions.forEach((ext) => {
					QUARTO_WIZARD_LOG.appendLine(` - ${ext}`);
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
				QUARTO_WIZARD_LOG.appendLine(message);
				vscode.window.showInformationMessage(`${message} ${showLogsCommand()}.`);
			}
		}
	);
}

export async function installQuartoExtensionCommand(
	context: vscode.ExtensionContext,
	recentlyInstalledExtensions: string
) {
	if (!vscode.workspace.workspaceFolders) {
		const message = `Please open a workspace/folder to install Quarto extensions. ${showLogsCommand()}.`;
		QUARTO_WIZARD_LOG.appendLine(message);
		vscode.window.showErrorMessage(message);
		return;
	}

	const isConnected = await checkInternetConnection("https://github.com/");
	if (!isConnected) {
		return;
	}
	await checkQuartoPath(getQuartoPath());

	let recentlyInstalled: string[] = context.globalState.get(recentlyInstalledExtensions, []);
	const extensionsList = await fetchExtensions(QUARTO_WIZARD_EXTENSIONS);
	const selectedExtensions = await showExtensionQuickPick(extensionsList, recentlyInstalled);

	if (selectedExtensions.length > 0) {
		await installQuartoExtensions(selectedExtensions);
		const selectedDescriptions = selectedExtensions.map((ext) => ext.description);
		let updatedRecentlyInstalled = [
			...selectedDescriptions,
			...recentlyInstalled.filter((ext) => !selectedDescriptions.includes(ext)),
		];
		await context.globalState.update(recentlyInstalledExtensions, updatedRecentlyInstalled.slice(0, 5));
	}
}
