import * as vscode from "vscode";
import { QW_LOG } from "../constants";

/**
 * Prompts the user to install a specified extension if it is not already installed.
 * The user's choice is stored in the global state to avoid prompting repeatedly.
 *
 * @param extensionId - The ID of the extension to be installed.
 * @param context - The extension context which provides access to the global state.
 * @returns A promise that resolves when the prompt handling is complete.
 *
 * The function performs the following actions based on the user's choice:
 * - "Install Now": Initiates the installation of the extension.
 * - "Maybe Later": Logs the user's choice and sets a flag to prompt again later.
 * - "Don't Ask Again": Logs the user's choice and sets a flag to avoid future prompts.
 */
async function promptInstallExtension(extensionId: string, context: vscode.ExtensionContext): Promise<void> {
	const kPromptInstallExtension = "PromptInstallExtension";
	const prompt = context.globalState.get<boolean>(`${kPromptInstallExtension}.${extensionId}`);
	if (prompt === false) {
		return;
	}
	const choice = await vscode.window.showInformationMessage(
		`Extension '${extensionId}' is not installed. Would you like to install it?`,
		"Install Now",
		"Maybe Later",
		"Don't Ask Again"
	);
	switch (choice) {
		case "Install Now":
			await vscode.commands.executeCommand("workbench.extensions.installExtension", extensionId);
			QW_LOG.appendLine(`${extensionId} installation initiated.`);
			break;
		case "Maybe Later":
			QW_LOG.appendLine(`User chose to install ${extensionId} later.`);
			context.globalState.update(`${kPromptInstallExtension}.${extensionId}`, true);
			break;
		case "Don't Ask Again":
			QW_LOG.appendLine(`User chose not to be asked again about ${extensionId}.`);
			context.globalState.update(`${kPromptInstallExtension}.${extensionId}`, false);
			break;
	}
}

/**
 * Activates a list of VS Code extensions.
 *
 * @param extensions - An array of extension IDs to activate.
 * @param context - The VS Code extension context.
 * @returns A promise that resolves when all extensions have been processed.
 */
export async function activateExtensions(extensions: string[], context: vscode.ExtensionContext): Promise<void> {
	extensions.forEach(async (extensionId) => {
		const extension = await vscode.extensions.getExtension(extensionId);
		if (extension) {
			if (!extension.isActive) {
				console.log(`Activating ${extensionId}...`);
				await extension.activate();
			}
			QW_LOG.appendLine(`${extensionId} activated.`);
		} else {
			QW_LOG.appendLine(`Failed to activate ${extensionId}.`);
			await promptInstallExtension(extensionId, context);
		}
	});
}
