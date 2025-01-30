import * as vscode from "vscode";
import { QUARTO_WIZARD_LOG } from "../constants";
import { showLogsCommand } from "../utils/log";
import { newQuartoReprex } from "../utils/reprex";

export async function newQuartoReprexCommand(context: vscode.ExtensionContext) {
	const languages = ["R", "Python", "Julia"];
	const selectedLanguage = await vscode.window.showQuickPick(languages, {
		placeHolder: "Select the computing language",
	});

	if (selectedLanguage) {
		newQuartoReprex(selectedLanguage, context);
	} else {
		const message = `No computing language selected. Aborting.`;
		QUARTO_WIZARD_LOG.appendLine(message);
		vscode.window.showErrorMessage(`${message} ${showLogsCommand()}.`);
	}
}
