import * as vscode from "vscode";
import type { AuthConfig } from "@quarto-wizard/core";
import { installQuartoExtension, useQuartoExtension } from "./quarto";
import { showLogsCommand, logMessage } from "../utils/log";
import { selectWorkspaceFolder } from "../utils/workspace";
import { withProgressNotification } from "../utils/withProgressNotification";
import { createFileSelectionCallback, createTargetSubdirCallback } from "../utils/ask";
import { getAuthConfig } from "../utils/auth";

/**
 * Configuration for a URI action handler.
 */
interface UriActionConfig {
	/** Function to generate the confirmation message from the repo name. */
	confirmMessage: (repo: string) => string;
	/** Function to generate the progress message from the repo name. */
	progressMessage: (repo: string) => string;
	/** The executor function that performs the action. Returns true (success), false (failure), or null (cancelled). */
	executor: (
		repo: string,
		workspaceFolder: string,
		auth: AuthConfig,
		token: vscode.CancellationToken,
	) => Promise<boolean | null>;
}

/**
 * Common handler for URI-based actions.
 * Extracts repo from URI, prompts for workspace folder, confirms action, and executes.
 *
 * @param uri - The VS Code URI containing query parameters.
 * @param context - The extension context for authentication.
 * @param config - Configuration for the action.
 * @returns A Promise that resolves to true (success), false (failure), null (cancelled), or undefined (aborted early).
 */
async function handleUriAction(
	uri: vscode.Uri,
	context: vscode.ExtensionContext,
	config: UriActionConfig,
): Promise<boolean | null | undefined> {
	const repo = new URLSearchParams(uri.query).get("repo");
	const workspaceFolder = await selectWorkspaceFolder();
	if (!repo || !workspaceFolder) {
		return;
	}

	const confirmed = await vscode.window.showInformationMessage(
		config.confirmMessage(repo),
		{ modal: true },
		"Yes",
		"No",
	);

	if (confirmed === "No") {
		const message = "Operation cancelled by the user.";
		logMessage(message, "info");
		vscode.window.showInformationMessage(`${message} ${showLogsCommand()}.`);
		return;
	}

	// Get authentication configuration (prompts sign-in if needed for private repos)
	const auth = await getAuthConfig(context, { createIfNone: true });

	// Log source and extension
	logMessage("Source: URI handler (GitHub).", "info");
	logMessage(`Extension: ${repo}.`, "info");
	if (!auth?.githubToken && (auth?.httpHeaders?.length ?? 0) === 0) {
		logMessage("Authentication: none (public access).", "info");
	}

	return await withProgressNotification(config.progressMessage(repo), async (token) => {
		// Check if already cancelled before starting
		if (token.isCancellationRequested) {
			return null;
		}
		return config.executor(repo, workspaceFolder, auth, token);
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
			handleUriInstall(uri, context);
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
 * @param context - The extension context for authentication.
 *
 * @returns A Promise that resolves when the installation is complete or cancelled.
 * The function doesn't return any value but may show information messages to the user
 * and perform the extension installation if confirmed.
 */
export async function handleUriInstall(uri: vscode.Uri, context: vscode.ExtensionContext) {
	return handleUriAction(uri, context, {
		confirmMessage: (repo) => `Do you confirm the installation of "${repo}" extension?`,
		progressMessage: (repo) => `Installing Quarto extension from ${repo} ...`,
		executor: (repo, workspaceFolder, auth, token) =>
			installQuartoExtension(
				repo,
				workspaceFolder,
				auth,
				undefined, // sourceDisplay
				undefined, // skipOverwritePrompt
				token, // cancellationToken
			),
	});
}

/**
 * Handles the installation and immediate use of a Quarto extension from a repository URI.
 *
 * @param uri - The VS Code URI containing query parameters, expected to have a "repo" parameter
 * specifying the repository to install and use.
 * @param context - The extension context for authentication.
 *
 * @returns A Promise that resolves when the installation and template copying is complete or cancelled.
 * The function installs the specified extension and copies template files to the workspace.
 */
export async function handleUriUse(uri: vscode.Uri, context: vscode.ExtensionContext) {
	return handleUriAction(uri, context, {
		confirmMessage: (repo) =>
			`Do you confirm using the "${repo}" template extension? This will install the extension and copy template files to your project.`,
		progressMessage: (repo) => `Using Quarto template from ${repo} ...`,
		executor: async (repo, workspaceFolder, auth, token) => {
			const selectFiles = createFileSelectionCallback();
			const selectTargetSubdir = createTargetSubdirCallback();
			const result = await useQuartoExtension(
				repo,
				workspaceFolder,
				selectFiles,
				selectTargetSubdir,
				auth,
				undefined, // sourceDisplay
				token, // cancellationToken
			);
			// useQuartoExtension returns UseResult | null
			// null means either failure or cancellation
			return result !== null ? true : null;
		},
	});
}
