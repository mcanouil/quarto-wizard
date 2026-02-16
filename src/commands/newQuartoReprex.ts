import * as vscode from "vscode";
import { logMessage, showMessageWithLogs } from "../utils/log";
import { newQuartoReprex } from "../utils/reprex";

/**
 * Command to create a new Quarto REPRoducible EXample (reprex).
 * Prompts the user to select a computing language (R, Python, or Julia) and then creates a reprex for the selected language.
 * If no language is selected, displays an error message and aborts the operation.
 *
 * @param context - The extension context.
 */
export async function newQuartoReprexCommand(context: vscode.ExtensionContext) {
	const languages = ["R", "Python", "Julia"];
	const selectedLanguage = await vscode.window.showQuickPick(languages, {
		placeHolder: "Select the computing language",
	});

	if (selectedLanguage) {
		await newQuartoReprex(selectedLanguage, context);
	} else {
		const message = `No computing language selected. Aborting.`;
		logMessage(message, "error");
		showMessageWithLogs(message, "error");
	}
}
