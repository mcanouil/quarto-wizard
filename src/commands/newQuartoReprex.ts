import * as vscode from "vscode";
import { QUARTO_WIZARD_LOG } from "../constants";
import { newQuartoReprex } from "../utils/reprex";
import { showLogsCommand } from "../utils/log";

export async function newQuartoReprexCommand(context: vscode.ExtensionContext) {
	const languages = ["R", "Python", "Julia"];
	const selectedLanguage = await vscode.window.showQuickPick(languages, {
		placeHolder: "Select the computing language",
	});

	if (selectedLanguage) {
		newQuartoReprex(selectedLanguage, context);
	} else {
		const message = `No computing language selected. Aborting. ${showLogsCommand()}.`;
		QUARTO_WIZARD_LOG.appendLine(message);
		vscode.window.showErrorMessage(message);
	}
}
