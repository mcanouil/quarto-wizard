import * as vscode from "vscode";
import { installQuartoExtensionSource } from "./quarto";
import { showLogsCommand, logMessage } from "../utils/log";
import { selectWorkspaceFolder } from "../utils/workspace";
import { ExtensionDetails, getExtensionsDetails } from "../utils/extensionDetails";
import { openTemplate } from "../commands/installQuartoExtension";
import { withProgressNotification } from "../utils/withProgressNotification";

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
 * @returns A Promise that resolves when the installation is complete or canceled.
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
 * @returns A Promise that resolves when the installation and template opening is complete or canceled.
 * The function installs the specified extension and then opens its template for immediate use.
 */
export async function handleUriUse(uri: vscode.Uri, context: vscode.ExtensionContext) {
	await handleUriInstall(uri);
	const extensionsList = await getExtensionsDetails(context);
	const repoSource = new URLSearchParams(uri.query).get("repo");
	const repo = repoSource?.replace(/@.*$/, "");
	const matchingExtension = extensionsList.find((ext: ExtensionDetails) => ext.id === repo);
	if (!matchingExtension) {
		const message = `Extension "${repo}" not found.`;
		logMessage(message, "error");
		vscode.window.showErrorMessage(`${message} ${showLogsCommand()}.`);
		return;
	}
	const extensionId = matchingExtension.id;
	const extensionTemplate = matchingExtension.templateContent;
	if (!extensionId || !extensionTemplate) {
		const message = "Invalid extension ID or template content.";
		logMessage(message, "error");
		vscode.window.showErrorMessage(`${message} ${showLogsCommand()}.`);
		return;
	}

	return await withProgressNotification(`Opening Quarto template from ${repo} ...`, async () => {
		return openTemplate(matchingExtension.id, matchingExtension.templateContent);
	});
}
