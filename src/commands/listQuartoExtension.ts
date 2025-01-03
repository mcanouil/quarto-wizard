import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { findQuartoExtensions } from "../utils/extensions";

export async function listQuartoExtensionCommand(log: vscode.OutputChannel) {
	if (!vscode.workspace.workspaceFolders) {
		const message = "Please open a workspace/folder to install Quarto extensions.";
		log.appendLine(message);
		vscode.window.showErrorMessage(message);
		return;
	}
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
	if (!workspaceFolder) {
		return [];
	}
	const extensionsDir = path.join(workspaceFolder, "_extensions");
	let extensions: string[] = [];
	if (fs.existsSync(path.join(workspaceFolder, "_extensions"))) {
		extensions = findQuartoExtensions(extensionsDir);
	}
	if (extensions.length === 0) {
		log.appendLine("\n\nNo Quarto extensions are installed.");
		return;
	} 
	log.appendLine(`\n\nInstalled extensions: ${extensions.join(", ")}`);
}
