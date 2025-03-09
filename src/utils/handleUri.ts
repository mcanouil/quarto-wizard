import * as vscode from "vscode";
import { installQuartoExtensionSource } from "./quarto";
import { showLogsCommand, logMessage } from "../utils/log";
import { selectWorkspaceFolder } from "../utils/workspace";

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
		const workspaceFolder = await selectWorkspaceFolder();
		if (!repo || !workspaceFolder) {
			return;
		}
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
