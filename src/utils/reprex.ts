import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export async function newQuartoReprex(language: string, context: vscode.ExtensionContext, log: vscode.OutputChannel) {
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
			const message = `Unsupported language: ${language}`;
			log.appendLine(message);
			vscode.window.showErrorMessage(message);
			return;
	}

	const filePath = path.join(context.extensionPath, "assets", "templates", templateFile);
	fs.readFile(filePath, "utf8", (err, data) => {
		if (err) {
			const message = `Failed to read the template file: ${err.message}`;
			log.appendLine(message);
			vscode.window.showErrorMessage(message);
			return;
		}

		const newFile = vscode.Uri.parse("untitled:" + path.join(vscode.workspace.rootPath || "", "Untitled.qmd"));
		vscode.workspace.openTextDocument(newFile).then((document) => {
			const edit = new vscode.WorkspaceEdit();
			edit.insert(newFile, new vscode.Position(0, 0), data);
			return vscode.workspace.applyEdit(edit).then((success) => {
				if (success) {
					vscode.window.showTextDocument(document);
				} else {
					const message = "Failed to open the new file!";
					log.appendLine(message);
					vscode.window.showErrorMessage(message);
				}
			});
		});
	});
}
