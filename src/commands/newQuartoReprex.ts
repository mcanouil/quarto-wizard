import * as vscode from "vscode";
import { showLogsCommand, logMessage } from "../utils/log";
import { newQuartoReprex } from "../utils/reprex";

/**
 * Command to create a new Quarto REPRoducible EXample (reprex).
 * Prompts the user to select a computing language and then creates a reprex for the selected language.
 *
 * @param context - The extension context.
 */
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
