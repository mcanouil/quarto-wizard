import * as vscode from "vscode";
import { QW_RECENTLY_INSTALLED, QW_RECENTLY_USED } from "../constants";
import { showLogsCommand, logMessage } from "../utils/log";
import { checkInternetConnection } from "../utils/network";
import { getQuartoPath, checkQuartoPath, installQuartoExtensionSource } from "../utils/quarto";
import { askTrustAuthors, askConfirmInstall } from "../utils/ask";
import { getExtensionsDetails } from "../utils/extensionDetails";
import { ExtensionQuickPickItem, showExtensionQuickPick } from "../ui/extensionsQuickPick";
import { selectWorkspaceFolder } from "../utils/workspace";

/**
 * Installs the selected Quarto extensions.
 *
 * @param selectedExtensions - The extensions selected by the user for installation.
 * @param workspaceFolder - The workspace folder where the extensions will be installed.
 */
async function installQuartoExtensions(selectedExtensions: readonly ExtensionQuickPickItem[], workspaceFolder: string) {
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
				if (!selectedExtension.id) {
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
export async function installQuartoExtensionFolderCommand(
	context: vscode.ExtensionContext,
	workspaceFolder: string,
	template = false
) {
	const isConnected = await checkInternetConnection("https://github.com/");
	if (!isConnected) {
		return;
	}
	await checkQuartoPath(getQuartoPath());

	let extensionsList = await getExtensionsDetails(context);
	if (template) {
		extensionsList = extensionsList.filter((ext) => ext.template);
	}
	const recentKey = template ? QW_RECENTLY_USED : QW_RECENTLY_INSTALLED;
	const recentExtensions: string[] = context.globalState.get(recentKey, []);
	const selectedExtensions = await showExtensionQuickPick(extensionsList, recentExtensions, template);

	if (selectedExtensions.length > 0) {
		await installQuartoExtensions(selectedExtensions, workspaceFolder);
		if (template) {
			await useQuartoTemplate(selectedExtensions);
		}
		const selectedIDs = selectedExtensions.map((ext) => ext.id);
		const updatedRecentExtensions = [...selectedIDs, ...recentExtensions.filter((ext) => !selectedIDs.includes(ext))];
		await context.globalState.update(recentKey, updatedRecentExtensions.slice(0, 5));
	}
}

export async function installQuartoExtensionCommand(context: vscode.ExtensionContext) {
	const workspaceFolder = await selectWorkspaceFolder();
	if (!workspaceFolder) {
		return;
	}
	installQuartoExtensionFolderCommand(context, workspaceFolder, false);
}

/**
 * Use the selected Quarto extension template.
 *
 * @param selectedExtension - The extension template selected by the user for use.
 */
async function useQuartoTemplate(selectedExtension: readonly ExtensionQuickPickItem[]) {
	if (selectedExtension.length === 0 || !selectedExtension[0].templateContent) {
		const message = "No template content found for the selected extension.";
		logMessage(message, "error");
		vscode.window.showErrorMessage(`${message} ${showLogsCommand()}.`);
		return;
	}

	try {
		const decodedContent = Buffer.from(selectedExtension[0].templateContent, "base64").toString("utf-8");
		await vscode.workspace.openTextDocument({ content: decodedContent, language: "quarto" }).then((document) => {
			vscode.window.showTextDocument(document);
		});
		const message = `Template from ${selectedExtension[0].id} opened successfully.`;
		logMessage(message, "info");
	} catch (error) {
		const message =
			error instanceof Error
				? `Failed to open the template from ${selectedExtension[0].id}: ${error.message}.`
				: `An unknown error occurred retrieving the template content from ${selectedExtension[0].id}.`;
		logMessage(message, "error");
		vscode.window.showErrorMessage(`${message} ${showLogsCommand()}.`);
	}
}

export async function useQuartoTemplateCommand(context: vscode.ExtensionContext) {
	const workspaceFolder = await selectWorkspaceFolder();
	if (!workspaceFolder) {
		return;
	}
	installQuartoExtensionFolderCommand(context, workspaceFolder, true);
}
