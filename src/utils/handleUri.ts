import * as vscode from "vscode";
import { showLogsCommand, logMessage } from "../utils/log";
import { installQuartoExtensionSource } from "./quarto";

/**
 * Handle the URI passed to the extension.
 *
 * @param uri - The URI passed to the extension.
 *
 * vscode://mcanouil.quarto-wizard/install?repo=<owner>/<repository>
 */
export async function handleUri(uri: vscode.Uri) {
	if (uri.path === "/install") {
		const repo = new URLSearchParams(uri.query).get("repo");
		if (!repo || !vscode.workspace.workspaceFolders) {
			return;
		}
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
		const installWorkspace = await vscode.window.showInformationMessage(
			`Do you confirm the installation of "${repo}" extension?`,
			{ modal: true },
			"Yes",
			"No"
		);

		if (installWorkspace === "No") {
			const message = "Operation cancelled by the user.";
			logMessage(message, "info");
			vscode.window.showInformationMessage(`${message} ${showLogsCommand()}.`);
			return;
		}
		installQuartoExtensionSource(repo, workspaceFolder);
	}
}
