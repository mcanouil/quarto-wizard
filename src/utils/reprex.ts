import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { getShowLogsLink, logMessage } from "./log";

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
			vscode.window.showErrorMessage(`${message} ${getShowLogsLink()}.`);
			return;
		}
	}

	const filePath = path.join(context.extensionPath, "assets", "templates", templateFile);
	try {
		const data = await fs.readFile(filePath, "utf8");
		const document = await vscode.workspace.openTextDocument({ content: data, language: "quarto" });
		await vscode.window.showTextDocument(document);
	} catch (error) {
		const message = `Failed to read the template file: ${error instanceof Error ? error.message : String(error)}.`;
		logMessage(message, "error");
		vscode.window.showErrorMessage(`${message} ${getShowLogsLink()}.`);
	}
}
