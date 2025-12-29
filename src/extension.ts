import * as vscode from "vscode";
import { QW_LOG, QW_RECENTLY_INSTALLED, QW_RECENTLY_USED } from "./constants";
import { showLogsCommand, logMessage } from "./utils/log";
import { installQuartoExtensionCommand, useQuartoTemplateCommand } from "./commands/installQuartoExtension";
import { newQuartoReprexCommand } from "./commands/newQuartoReprex";
import { ExtensionsInstalled } from "./ui/extensionsInstalled";
import { getExtensionsDetails, clearExtensionsCache } from "./utils/extensionDetails";
import { handleUri } from "./utils/handleUri";

/**
 * This method is called when the extension is activated.
 * It registers various commands and initialises the ExtensionsInstalled class that defines the installed extensions view.
 * It also registers a URI handler for extension protocol links.
 *
 * @param context - The context in which the extension is running.
 */
export function activate(context: vscode.ExtensionContext) {
	// Register command to show the extension's output log
	context.subscriptions.push(vscode.commands.registerCommand("quartoWizard.showOutput", () => QW_LOG.show()));
	QW_LOG.appendLine("Quarto Wizard, your magical assistant, is now active!");

	// Register command to clear the recently installed/used extensions cache
	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.clearRecent", () => {
			context.globalState.update(QW_RECENTLY_INSTALLED, []);
			context.globalState.update(QW_RECENTLY_USED, []);
			const message = "Recently installed Quarto extensions have been cleared.";
			logMessage(message, "info");
			vscode.window.showInformationMessage(`${message} ${showLogsCommand()}.`);
		})
	);

	// Register command to clear all cached extension data (registry + recent lists)
	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.clearCache", () => clearExtensionsCache(context))
	);

	// Register main extension installation command
	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.installExtension", async () => installQuartoExtensionCommand(context))
	);

	// Register template installation command
	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.useTemplate", async () => useQuartoTemplateCommand(context))
	);

	// Register reproducible document creation command
	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.newQuartoReprex", () => newQuartoReprexCommand(context))
	);

	// Register command to fetch and display extension details from GitHub
	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.getExtensionsDetails", () => getExtensionsDetails(context))
	);

	// Initialise the Extensions Installed tree view provider
	new ExtensionsInstalled(context);

	// Register URI handler for browser-based extension installation (e.g., vscode://mcanouil.quarto-wizard/install?repo=owner/repo)
	vscode.window.registerUriHandler({
		handleUri: (uri: vscode.Uri) => handleUri(uri, context),
	});
}

/**
 * This method is called when the extension is deactivated.
 * Currently, it does not perform any specific action.
 */
export function deactivate() {
	// No cleanup necessary
}
