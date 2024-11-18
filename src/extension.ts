import * as vscode from "vscode";
import { installQuartoExtensionCommand } from "./commands/installQuartoExtension";

const RECENTLY_INSTALLED_QUARTO_EXTENSIONS = "recentlyInstalledExtensions";
const QUARTO_WIZARD_LOG = vscode.window.createOutputChannel("Quarto Wizard");

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand("quartoExtensions.showOutput",
			() => QUARTO_WIZARD_LOG.show()
		)
	);
	// context.globalState.update(RECENTLY_INSTALLED_QUARTO_EXTENSIONS, []);
	let disposable = vscode.commands.registerCommand(
		"quartoExtensions.installExtension",
		() => installQuartoExtensionCommand(context, QUARTO_WIZARD_LOG, RECENTLY_INSTALLED_QUARTO_EXTENSIONS)
	);

	context.subscriptions.push(disposable);
}

export function deactivate() {}
