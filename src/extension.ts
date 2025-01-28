import * as vscode from "vscode";
import { QUARTO_WIZARD_LOG, QUARTO_WIZARD_RECENTLY_INSTALLED } from "./constants";
import { installQuartoExtensionCommand } from "./commands/installQuartoExtension";
import { newQuartoReprexCommand } from "./commands/newQuartoReprex";
import { ExtensionsInstalled } from "./ui/extensionsInstalled";

const RECENTLY_INSTALLED_QUARTO_EXTENSIONS = "recentlyInstalledExtensions";
const QUARTO_WIZARD_LOG = vscode.window.createOutputChannel("Quarto Wizard");

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.showOutput", () => QUARTO_WIZARD_LOG.show())
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.clearRecentlyInstalled", () => {
			context.globalState.update(QUARTO_WIZARD_RECENTLY_INSTALLED, []);
			vscode.window.showInformationMessage("Recently installed Quarto extensions have been cleared.");
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.installExtension", () =>
			installQuartoExtensionCommand(context, QUARTO_WIZARD_LOG, QUARTO_WIZARD_RECENTLY_INSTALLED)
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.newQuartoReprex", () =>
			newQuartoReprexCommand(context, QUARTO_WIZARD_LOG)
		)
	);

	new ExtensionsInstalled(context, QUARTO_WIZARD_LOG);
}

export function deactivate() {}
