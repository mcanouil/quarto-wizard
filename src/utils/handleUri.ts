import * as vscode from "vscode";
import { installQuartoExtension, useQuartoExtension } from "./quarto";
import { showLogsCommand, logMessage } from "../utils/log";
import { selectWorkspaceFolder } from "../utils/workspace";
import { withProgressNotification } from "../utils/withProgressNotification";
import { createFileSelectionCallback } from "../utils/ask";

/**
 * Configuration for a URI action handler.
 */
interface UriActionConfig {
	/** Function to generate the confirmation message from the repo name. */
	confirmMessage: (repo: string) => string;
	/** Function to generate the progress message from the repo name. */
	progressMessage: (repo: string) => string;
	/** The executor function that performs the action. */
	executor: (repo: string, workspaceFolder: string) => Promise<boolean>;
}

/**
 * Common handler for URI-based actions.
 * Extracts repo from URI, prompts for workspace folder, confirms action, and executes.
 *
 * @param uri - The VS Code URI containing query parameters.
 * @param config - Configuration for the action.
 * @returns A Promise that resolves when the action is complete or cancelled.
 */
async function handleUriAction(uri: vscode.Uri, config: UriActionConfig): Promise<boolean | undefined> {
	const repo = new URLSearchParams(uri.query).get("repo");
	const workspaceFolder = await selectWorkspaceFolder();
	if (!repo || !workspaceFolder) {
		return;
	}

	const confirmed = await vscode.window.showInformationMessage(
		config.confirmMessage(repo),
		{ modal: true },
		"Yes",
		"No"
	);

	if (confirmed === "No") {
		const message = "Operation cancelled by the user.";
		logMessage(message, "info");
		vscode.window.showInformationMessage(`${message} ${showLogsCommand()}.`);
		return;
	}

	return await withProgressNotification(config.progressMessage(repo), async () => {
		return config.executor(repo, workspaceFolder);
	});
}

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
	return handleUriAction(uri, {
		confirmMessage: (repo) => `Do you confirm the installation of "${repo}" extension?`,
		progressMessage: (repo) => `Installing Quarto extension from ${repo} ...`,
		executor: installQuartoExtension,
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
	return handleUriAction(uri, {
		confirmMessage: (repo) =>
			`Do you confirm using the "${repo}" template extension? This will install the extension and copy template files to your project.`,
		progressMessage: (repo) => `Using Quarto template from ${repo} ...`,
		executor: async (repo, workspaceFolder) => {
			const selectFiles = createFileSelectionCallback();
			const result = await useQuartoExtension(repo, workspaceFolder, selectFiles);
			return result !== null;
		},
	});
}
