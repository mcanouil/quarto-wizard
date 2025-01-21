import * as vscode from "vscode";
import { newQuartoReprex } from "../utils/reprex";
import { showLogsCommand } from "../utils/log";

export async function newQuartoReprexCommand(context: vscode.ExtensionContext, log: vscode.OutputChannel) {
	const languages = ["R", "Python", "Julia"];
	const selectedLanguage = await vscode.window.showQuickPick(languages, {
		placeHolder: "Select the computing language",
	});

	if (selectedLanguage) {
		newQuartoReprex(selectedLanguage, context, log);
	} else {
		const message = `No computing language selected. Aborting. ${showLogsCommand()}.`;
		log.appendLine(message);
		vscode.window.showErrorMessage(message);
	}
}
