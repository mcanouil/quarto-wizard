import * as vscode from "vscode";
import { installQuartoExtensionSource, useQuartoExtension } from "./quarto";
import { showLogsCommand, logMessage } from "../utils/log";
import { selectWorkspaceFolder } from "../utils/workspace";
import { withProgressNotification } from "../utils/withProgressNotification";
import { createFileSelectionCallback } from "../utils/ask";

/**
 * Handle the URI passed to the extension.
 *
 * @param uri - The URI passed to the extension.
 * @param context - The extension context used for accessing extension resources and state.
 *
 * Supported URI formats:
 * vscode://mcanouil.quarto-wizard/install?repo=<owner>/<repository>
 * vscode://mcanouil.quarto-wizard/use?repo=<owner>/<repository>
 */
export async function handleUri(uri: vscode.Uri, context: vscode.ExtensionContext) {
	switch (uri.path) {
		case "/install":
			handleUriInstall(uri);
			break;
		case "/use":
			handleUriUse(uri, context);
			break;
		default:
			logMessage(`Unsupported path: ${uri.path}`, "warn");
			break;
	}
}

/**
 * Handles the installation of a Quarto extension from a repository URI.
 *
 * @param uri - The VS Code URI containing query parameters, expected to have a "repo" parameter
 * specifying the repository to install.
 *
 * @returns A Promise that resolves when the installation is complete or cancelled.
 * The function doesn't return any value but may show information messages to the user
 * and perform the extension installation if confirmed.
 */
export async function handleUriInstall(uri: vscode.Uri) {
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
	return await withProgressNotification(`Installing Quarto extension from ${repo} ...`, async () => {
		return installQuartoExtensionSource(repo, workspaceFolder);
	});
}

/**
 * Handles the installation and immediate use of a Quarto extension from a repository URI.
 *
 * @param uri - The VS Code URI containing query parameters, expected to have a "repo" parameter
 * specifying the repository to install and use.
 * @param context - The extension context used to access extension resources and state.
 *
 * @returns A Promise that resolves when the installation and template copying is complete or cancelled.
 * The function installs the specified extension and copies template files to the workspace.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function handleUriUse(uri: vscode.Uri, _context: vscode.ExtensionContext) {
	const repo = new URLSearchParams(uri.query).get("repo");
	const workspaceFolder = await selectWorkspaceFolder();
	if (!repo || !workspaceFolder) {
		return;
	}

	const useTemplate = await vscode.window.showInformationMessage(
		`Do you confirm using the "${repo}" template extension? This will install the extension and copy template files to your project.`,
		{ modal: true },
		"Yes",
		"No"
	);

	if (useTemplate === "No") {
		const message = "Operation cancelled by the user.";
		logMessage(message, "info");
		vscode.window.showInformationMessage(`${message} ${showLogsCommand()}.`);
		return;
	}

	return await withProgressNotification(`Using Quarto template from ${repo} ...`, async () => {
		const selectFiles = createFileSelectionCallback();
		const result = await useQuartoExtension(repo, workspaceFolder, selectFiles);
		return result !== null;
	});
}
