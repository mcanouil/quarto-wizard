import * as vscode from "vscode";
import { QW_LOG, QW_RECENTLY_INSTALLED } from "./constants";
import { showLogsCommand, logMessage } from "./utils/log";
import { installQuartoExtensionCommand } from "./commands/installQuartoExtension";
import { newQuartoReprexCommand } from "./commands/newQuartoReprex";
import { ExtensionsInstalled } from "./ui/extensionsInstalled";
import { getExtensionsDetails } from "./utils/extensionDetails";

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.commands.registerCommand("quartoWizard.showOutput", () => QW_LOG.show()));

	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.clearRecentlyInstalled", () => {
			context.globalState.update(QW_RECENTLY_INSTALLED, []);
			const message = "Recently installed Quarto extensions have been cleared.";
			logMessage(message);
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
}

export function deactivate() {}
