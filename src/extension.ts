import * as vscode from "vscode";
import { installQuartoExtensionCommand } from "./commands/installQuartoExtension";
import { newQuartoReprexCommand } from "./commands/newQuartoReprex";
import { listQuartoExtensionCommand } from "./commands/listQuartoExtension";

const RECENTLY_INSTALLED_QUARTO_EXTENSIONS = "recentlyInstalledExtensions";
const QUARTO_WIZARD_LOG = vscode.window.createOutputChannel("Quarto Wizard");

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.showOutput", () => QUARTO_WIZARD_LOG.show())
	);

	let clearRecentlyInstalledDisposable = vscode.commands.registerCommand("quartoWizard.clearRecentlyInstalled", () => {
		context.globalState.update(RECENTLY_INSTALLED_QUARTO_EXTENSIONS, []);
		vscode.window.showInformationMessage("Recently installed Quarto extensions have been cleared.");
	});
	context.subscriptions.push(clearRecentlyInstalledDisposable);

	let installExtensionDisposable = vscode.commands.registerCommand("quartoWizard.installExtension", () =>
		installQuartoExtensionCommand(context, QUARTO_WIZARD_LOG, RECENTLY_INSTALLED_QUARTO_EXTENSIONS)
	);
	context.subscriptions.push(installExtensionDisposable);

	let newQuartoReprexDisposable = vscode.commands.registerCommand("quartoWizard.newQuartoReprex", () =>
		newQuartoReprexCommand(context, QUARTO_WIZARD_LOG)
	);
	context.subscriptions.push(newQuartoReprexDisposable);

	let listQuartoExtensionDisposable = vscode.commands.registerCommand("quartoWizard.listQuartoExtension", () =>
		listQuartoExtensionCommand(QUARTO_WIZARD_LOG)
  );
	context.subscriptions.push(listQuartoExtensionDisposable);
}

export function deactivate() {}
