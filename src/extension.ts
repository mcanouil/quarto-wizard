import * as vscode from "vscode";
import { QW_LOG, QW_RECENTLY_INSTALLED } from "./constants";
import { showLogsCommand, logMessage } from "./utils/log";
import { installQuartoExtensionCommand } from "./commands/installQuartoExtension";
import { newQuartoReprexCommand } from "./commands/newQuartoReprex";
import { ExtensionsInstalled } from "./ui/extensionsInstalled";
import { getExtensionsDetails } from "./utils/extensionDetails";
import { activateExtensions } from "./utils/activate";
import { lintOnEvent } from "./commands/lint";

/**
 * This method is called when the extension is activated.
 * It registers various commands and initialises the ExtensionsInstalled class that defines the installed extensions view.
 *
 * @param context - The context in which the extension is running.
 */
export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.commands.registerCommand("quartoWizard.showOutput", () => QW_LOG.show()));
	QW_LOG.appendLine("Quarto Wizard, your magical assistant, is now active!");

	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.clearRecentlyInstalled", () => {
			context.globalState.update(QW_RECENTLY_INSTALLED, []);
			const message = "Recently installed Quarto extensions have been cleared.";
			logMessage(message, "info");
			vscode.window.showInformationMessage(`${message} ${showLogsCommand()}.`);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.installExtension", () => installQuartoExtensionCommand(context))
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.newQuartoReprex", () => newQuartoReprexCommand(context))
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.getExtensionsDetails", () => getExtensionsDetails(context))
	);

	new ExtensionsInstalled(context);

	if (vscode.window.activeTextEditor?.document.languageId === "quarto") {
		activateExtensions(["DavidAnson.vscode-markdownlint"], context);
		lintOnEvent();
	}
}

/**
 * This method is called when the extension is deactivated.
 * Currently, it does not perform any specific action.
 */
export function deactivate() {
	// No cleanup necessary
}
