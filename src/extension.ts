import * as vscode from "vscode";
import { QW_LOG, QW_RECENTLY_INSTALLED, QW_RECENTLY_USED } from "./constants";
import { showLogsCommand, logMessage } from "./utils/log";
import { installQuartoExtensionCommand, useQuartoTemplateCommand } from "./commands/installQuartoExtension";
import { newQuartoReprexCommand } from "./commands/newQuartoReprex";
import { ExtensionsInstalled } from "./ui/extensionsInstalled";
import { getExtensionsDetails } from "./utils/extensionDetails";
import { lint } from "./utils/lint";
import { handleUri } from "./utils/handleUri";

/**
 * This method is called when the extension is activated.
 * It registers various commands and initialises the ExtensionsInstalled class that defines the installed extensions view.
 * It also registers a URI handler for extension protocol links.
 *
 * @param context - The context in which the extension is running.
 */
export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.commands.registerCommand("quartoWizard.showOutput", () => QW_LOG.show()));
	QW_LOG.appendLine("Quarto Wizard, your magical assistant, is now active!");

	lint(context);

	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.clearRecent", () => {
			context.globalState.update(QW_RECENTLY_INSTALLED, []);
			context.globalState.update(QW_RECENTLY_USED, []);
			const message = "Recently installed Quarto extensions have been cleared.";
			logMessage(message, "info");
			vscode.window.showInformationMessage(`${message} ${showLogsCommand()}.`);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.installExtension", async () => installQuartoExtensionCommand(context))
	);
	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.useTemplate", async () => useQuartoTemplateCommand(context))
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.newQuartoReprex", () => newQuartoReprexCommand(context))
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.getExtensionsDetails", () => getExtensionsDetails(context))
	);

	new ExtensionsInstalled(context);

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
