import * as vscode from "vscode";
import { QUARTO_WIZARD_LOG, QUARTO_WIZARD_RECENTLY_INSTALLED } from "./constants";
import { showLogsCommand } from "./utils/log";
import { installQuartoExtensionCommand } from "./commands/installQuartoExtension";
import { newQuartoReprexCommand } from "./commands/newQuartoReprex";
import { ExtensionsInstalled } from "./ui/extensionsInstalled";

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.showOutput", () => QUARTO_WIZARD_LOG.show())
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.clearRecentlyInstalled", () => {
			context.globalState.update(QUARTO_WIZARD_RECENTLY_INSTALLED, []);
			const message = "Recently installed Quarto extensions have been cleared.";
			QUARTO_WIZARD_LOG.appendLine(message);
			vscode.window.showInformationMessage(`${message} ${showLogsCommand()}.`);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.installExtension", () =>
			installQuartoExtensionCommand(context, QUARTO_WIZARD_RECENTLY_INSTALLED)
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.newQuartoReprex", () => newQuartoReprexCommand(context))
	);

	new ExtensionsInstalled(context);
}

export function deactivate() {}
