import * as vscode from "vscode";
import { getErrorMessage } from "@quarto-wizard/core";
import { logMessage, showMessageWithLogs } from "./log";

/**
 * Creates a new Quarto reprex (REPRoducible EXample) file based on the specified language.
 *
 * @param {string} language - The programming language for the reprex (e.g., "R", "Julia", "Python").
 * @param {vscode.ExtensionContext} context - The extension context.
 */
export async function newQuartoReprex(language: string, context: vscode.ExtensionContext) {
	let templateFile = "";

	switch (language) {
		case "R":
			templateFile = "r.qmd";
			break;
		case "Julia":
			templateFile = "julia.qmd";
			break;
		case "Python":
			templateFile = "python.qmd";
			break;
		default: {
			const message = `Unsupported language: ${language}.`;
			logMessage(message, "error");
			showMessageWithLogs(message, "error");
			return;
		}
	}

	const fileUri = vscode.Uri.joinPath(context.extensionUri, "assets", "templates", templateFile);
	try {
		const fileData = await vscode.workspace.fs.readFile(fileUri);
		const data = new TextDecoder().decode(fileData);
		const document = await vscode.workspace.openTextDocument({ content: data, language: "quarto" });
		await vscode.window.showTextDocument(document);
	} catch (error) {
		const message = `Failed to read the template file: ${getErrorMessage(error)}.`;
		logMessage(message, "error");
		showMessageWithLogs(message, "error");
	}
}
