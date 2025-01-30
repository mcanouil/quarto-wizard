import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { QUARTO_WIZARD_LOG } from "../constants";
import { showLogsCommand } from "./log";

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
		default:
			const message = `Unsupported language: ${language}.`;
			QUARTO_WIZARD_LOG.appendLine(message);
			vscode.window.showErrorMessage(`${message} ${showLogsCommand()}.`);
			return;
	}

	const filePath = path.join(context.extensionPath, "assets", "templates", templateFile);
	fs.readFile(filePath, "utf8", (err, data) => {
		if (err) {
			const message = `Failed to read the template file: ${err.message}.`;
			QUARTO_WIZARD_LOG.appendLine(message);
			vscode.window.showErrorMessage(`${message} ${showLogsCommand()}.`);
			return;
		}

		vscode.workspace.openTextDocument({ content: data, language: "quarto" }).then((document) => {
			vscode.window.showTextDocument(document);
		});
	});
}
