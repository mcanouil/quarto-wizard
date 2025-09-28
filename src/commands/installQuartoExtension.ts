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

				// Install extension and automatically add source information to _extension.yml
				// This enables future updates through the extension's tree view
				const success = await installQuartoExtensionSource(extensionSource, workspaceFolder);
				// TODO: Once Quarto CLI natively supports source records, replace with:
				// const success = await installQuartoExtension(extensionSource, workspaceFolder);

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
				logMessage(`Successfully installed extension${installedExtensions.length > 1 ? "s" : ""}:`, "info");
				installedExtensions.map((ext) => logMessage(` - ${ext}`, "info"));
			}

			if (failedExtensions.length > 0) {
				logMessage(`Failed to install extension${failedExtensions.length > 1 ? "s" : ""}:`, "error");
				failedExtensions.map((ext) => logMessage(` - ${ext}`, "error"));
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
 * Opens a Quarto template in the editor.
 *
 * @param id - The ID of the extension containing the template
 * @param templateContent - The base64-encoded template content
 * @returns A Promise that resolves to a boolean indicating success or failure
 */
export async function openTemplate(id: string, templateContent: string): Promise<boolean> {
	try {
		const decodedContent = Buffer.from(templateContent, "base64").toString("utf-8");
		await vscode.workspace.openTextDocument({ content: decodedContent, language: "quarto" }).then((document) => {
			vscode.window.showTextDocument(document);
		});
		const message = `Template from "${id}" opened successfully.`;
		logMessage(message, "info");
		return true;
	} catch (error) {
		const message =
			error instanceof Error
				? `Failed to open the template from "${id}": ${error.message}.`
				: `An unknown error occurred retrieving the template content from "${id}".`;
		logMessage(message, "error");
		vscode.window.showErrorMessage(`${message} ${showLogsCommand()}.`);
		return false;
	}
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

	const extensionId = selectedExtension[0].id;
	const extensionTemplate = selectedExtension[0].templateContent;
	if (!extensionId || !extensionTemplate) {
		const message = "Invalid extension ID or template content.";
		logMessage(message, "error");
		vscode.window.showErrorMessage(`${message} ${showLogsCommand()}.`);
		return;
	}
	await openTemplate(extensionId, extensionTemplate);
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
