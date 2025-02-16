import * as vscode from "vscode";
import { showLogsCommand, logMessage } from "../utils/log";
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
		logMessage(message, "error");
		vscode.window.showErrorMessage(`${message} ${showLogsCommand()}.`);
	}
}
