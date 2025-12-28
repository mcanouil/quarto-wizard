import * as vscode from "vscode";
import { QW_RECENTLY_INSTALLED, QW_RECENTLY_USED } from "../constants";
import { showLogsCommand, logMessage } from "../utils/log";
import { checkInternetConnection } from "../utils/network";
import { installQuartoExtensionSource, useQuartoExtension } from "../utils/quarto";
import { askTrustAuthors, askConfirmInstall, createConfirmOverwriteBatch } from "../utils/ask";
import { getExtensionsDetails } from "../utils/extensionDetails";
import { ExtensionQuickPickItem, showExtensionQuickPick } from "../ui/extensionsQuickPick";
import { selectWorkspaceFolder } from "../utils/workspace";

/**
 * Installs or uses the selected Quarto extensions.
 *
 * @param selectedExtensions - The extensions selected by the user for installation.
 * @param workspaceFolder - The workspace folder where the extensions will be installed.
 * @param template - Whether to use the template functionality (copy template files).
 */
async function installQuartoExtensions(
	selectedExtensions: readonly ExtensionQuickPickItem[],
	workspaceFolder: string,
	template = false
) {
	const mutableSelectedExtensions: ExtensionQuickPickItem[] = [...selectedExtensions];

	if ((await askTrustAuthors()) !== 0) return;
	if ((await askConfirmInstall()) !== 0) return;

	const actionWord = template ? "Using" : "Installing";
	const actionPast = template ? "used" : "installed";

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `${actionWord} selected extension(s) (${showLogsCommand()})`,
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

			// Create a batch confirm overwrite callback
			const confirmOverwriteBatch = createConfirmOverwriteBatch();

			for (const selectedExtension of mutableSelectedExtensions) {
				if (!selectedExtension.id) {
					continue;
				}

				// Update progress indicator with current extension being processed
				progress.report({
					message: `(${installedCount} / ${totalExtensions}) ${selectedExtension.label} ...`,
					increment: (1 / (totalExtensions + 1)) * 100,
				});

				// Build extension source with optional version tag
				let extensionSource = selectedExtension.id;
				if (selectedExtension.tag && selectedExtension.tag !== "none") {
					extensionSource = `${selectedExtension.id}@${selectedExtension.tag}`;
				}

				let success: boolean;
				if (template) {
					// Use template: install extension and copy template files
					const result = await useQuartoExtension(extensionSource, workspaceFolder, confirmOverwriteBatch);
					success = result !== null;
				} else {
					// Regular install: just install the extension
					success = await installQuartoExtensionSource(extensionSource, workspaceFolder);
				}

				// Track installation results for user feedback
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
				logMessage(`Successfully ${actionPast} extension${installedExtensions.length > 1 ? "s" : ""}:`, "info");
				installedExtensions.map((ext) => logMessage(` - ${ext}`, "info"));
			}

			if (failedExtensions.length > 0) {
				logMessage(`Failed to ${template ? "use" : "install"} extension${failedExtensions.length > 1 ? "s" : ""}:`, "error");
				failedExtensions.map((ext) => logMessage(` - ${ext}`, "error"));
				const message = [
					"The following extension",
					failedExtensions.length > 1 ? "s were" : " was",
					` not ${actionPast}, try ${template ? "using" : "installing"} `,
					failedExtensions.length > 1 ? "them" : "it",
					` manually with \`quarto ${template ? "use" : "add"} <extension>\`:`,
				].join("");
				vscode.window.showErrorMessage(`${message} ${failedExtensions.join(", ")}. ${showLogsCommand()}.`);
			} else {
				const message = [installedCount, " extension", installedCount > 1 ? "s" : "", ` ${actionPast} successfully.`].join(
					""
				);
				logMessage(message, "info");
				vscode.window.showInformationMessage(`${message} ${showLogsCommand()}.`);
			}
		}
	);
}

/**
 * Command to install Quarto extensions in a specified workspace folder.
 * Prompts the user to select extensions, installs them, and optionally handles templates.
 *
 * @param context - The extension context.
 * @param workspaceFolder - The target workspace folder for extension installation.
 * @param template - Whether to filter for and handle template extensions.
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

	let extensionsList = await getExtensionsDetails(context);
	if (template) {
		extensionsList = extensionsList.filter((ext) => ext.template);
	}
	const recentKey = template ? QW_RECENTLY_USED : QW_RECENTLY_INSTALLED;
	const recentExtensions: string[] = context.globalState.get(recentKey, []);
	const selectedExtensions = await showExtensionQuickPick(extensionsList, recentExtensions, template);

	if (selectedExtensions.length > 0) {
		await installQuartoExtensions(selectedExtensions, workspaceFolder, template);
		const selectedIDs = selectedExtensions.map((ext) => ext.id);
		const updatedRecentExtensions = [...selectedIDs, ...recentExtensions.filter((ext) => !selectedIDs.includes(ext))];
		await context.globalState.update(recentKey, updatedRecentExtensions.slice(0, 5));
	}
}

/**
 * Command handler for installing Quarto extensions.
 * Prompts the user to select a workspace folder and then calls installQuartoExtensionFolderCommand.
 *
 * @param context - The extension context.
 */
export async function installQuartoExtensionCommand(context: vscode.ExtensionContext) {
	const workspaceFolder = await selectWorkspaceFolder();
	if (!workspaceFolder) {
		return;
	}
	installQuartoExtensionFolderCommand(context, workspaceFolder, false);
}

/**
 * Executes the command to use a Quarto template.
 * This function prompts the user to select a workspace folder, then installs a Quarto extension configured as a template.
 *
 * @param context - The VS Code extension context
 * @returns A Promise that resolves when the operation is complete, or void if the user cancels folder selection
 */
export async function useQuartoTemplateCommand(context: vscode.ExtensionContext) {
	const workspaceFolder = await selectWorkspaceFolder();
	if (!workspaceFolder) {
		return;
	}
	installQuartoExtensionFolderCommand(context, workspaceFolder, true);
}
