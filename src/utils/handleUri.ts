import * as vscode from "vscode";
import { installQuartoExtensionSource } from "./quarto";

/**
 * Handle the URI passed to the extension.
 *
 * @param uri - The URI passed to the extension.
 *
 * vscode://mcanouil.quarto-wizard/install?repo=<owner>/<repository>
 */
export function handleUri(uri: vscode.Uri) {
	if (uri.path === "/install") {
		const repo = new URLSearchParams(uri.query).get("repo");
		if (!repo || !vscode.workspace.workspaceFolders) {
			return;
		}
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
		installQuartoExtensionSource(repo, workspaceFolder);
	}
}
