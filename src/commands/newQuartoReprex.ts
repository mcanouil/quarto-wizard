import * as vscode from "vscode";
import { newQuartoReprex } from "../utils/reprex";

export async function newQuartoReprexCommand(context: vscode.ExtensionContext, log: vscode.OutputChannel) {
	const languages = ["R", "Python", "Julia"];
	const selectedLanguage = await vscode.window.showQuickPick(languages, {
		placeHolder: "Select the computing language",
	});

	if (selectedLanguage) {
		newQuartoReprex(selectedLanguage, context, log);
	} else {
		const message = "No computing language selected. Aborting.";
		log.appendLine(message);
		vscode.window.showErrorMessage(message);
	}
}
