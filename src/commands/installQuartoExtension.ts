import * as vscode from "vscode";
import { QW_RECENTLY_INSTALLED, QW_RECENTLY_USED } from "../constants";
import { showLogsCommand, logMessage } from "../utils/log";
import { checkInternetConnection } from "../utils/network";
import { installQuartoExtension, useQuartoExtension } from "../utils/quarto";
import { askTrustAuthors, askConfirmInstall, createFileSelectionCallback } from "../utils/ask";
import { getExtensionsDetails } from "../utils/extensionDetails";
import { ExtensionQuickPickItem, showExtensionQuickPick, showTypeFilterQuickPick } from "../ui/extensionsQuickPick";
import { selectWorkspaceFolder } from "../utils/workspace";
import { getAuthConfig } from "../utils/auth";

/**
 * Installs or uses the selected Quarto extensions.
 *
 * @param context - The extension context for accessing authentication.
 * @param selectedExtensions - The extensions selected by the user for installation.
 * @param workspaceFolder - The workspace folder where the extensions will be installed.
 * @param template - Whether to use the template functionality (copy template files).
 */
async function installQuartoExtensions(
	context: vscode.ExtensionContext,
	selectedExtensions: readonly ExtensionQuickPickItem[],
	workspaceFolder: string,
	template = false,
) {
	const mutableSelectedExtensions: ExtensionQuickPickItem[] = [...selectedExtensions];

	if ((await askTrustAuthors()) !== 0) return;
	if ((await askConfirmInstall()) !== 0) return;

	// Get authentication configuration (prompts sign-in if needed for private repos)
	const auth = await getAuthConfig(context, { createIfNone: true });

	const actionWord = template ? "Using" : "Installing";
	const actionPast = template ? "used" : "installed";

	// Log source and extensions
	logMessage("Source: registry.", "info");
	logMessage(`Extension(s) to ${template ? "use" : "install"}: ${mutableSelectedExtensions.map((ext) => ext.id).join(", ")}.`, "info");
	if (!auth?.githubToken && (auth?.httpHeaders?.length ?? 0) === 0) {
		logMessage("Authentication: none (public access).", "info");
	}

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `${actionWord} selected extension(s) (${showLogsCommand()})`,
			cancellable: true,
		},
		async (progress, token) => {
			token.onCancellationRequested(() => {
				const message = "Operation cancelled by the user.";
				logMessage(message, "info");
				vscode.window.showInformationMessage(`${message} ${showLogsCommand()}.`);
			});

			const installedExtensions: string[] = [];
			const failedExtensions: string[] = [];
			const totalExtensions = mutableSelectedExtensions.length;
			let installedCount = 0;

			for (const selectedExtension of mutableSelectedExtensions) {
				if (!selectedExtension.id) {
					continue;
				}

				// Update progress indicator with current extension being processed
				progress.report({
					message: `(${installedCount} / ${totalExtensions}) ${selectedExtension.label} ...`,
					increment: (1 / (totalExtensions + 1)) * 100,
				});

				// Build extension source with optional version tag
				let extensionSource = selectedExtension.id;
				if (selectedExtension.tag && selectedExtension.tag !== "none") {
					extensionSource = `${selectedExtension.id}@${selectedExtension.tag}`;
				}

				let success: boolean;
				if (template) {
					// Use template: install extension and copy template files
					const selectFiles = createFileSelectionCallback();
					const result = await useQuartoExtension(extensionSource, workspaceFolder, selectFiles, auth);
					success = result !== null;
				} else {
					// Regular install: just install the extension
					success = await installQuartoExtension(extensionSource, workspaceFolder, auth);
				}

				// Track installation results for user feedback
				if (success) {
					installedExtensions.push(selectedExtension.id);
				} else {
					failedExtensions.push(selectedExtension.id);
				}

				installedCount++;
			}
			progress.report({
				message: `(${totalExtensions} / ${totalExtensions}) extensions processed.`,
				increment: (1 / (totalExtensions + 1)) * 100,
			});

			if (installedExtensions.length > 0) {
				logMessage(`Successfully ${actionPast} extension${installedExtensions.length > 1 ? "s" : ""}:`, "info");
				installedExtensions.map((ext) => logMessage(` - ${ext}`, "info"));
			}

			if (failedExtensions.length > 0) {
				logMessage(
					`Failed to ${template ? "use" : "install"} extension${failedExtensions.length > 1 ? "s" : ""}:`,
					"error",
				);
				failedExtensions.map((ext) => logMessage(` - ${ext}`, "error"));
				const message = [
					"The following extension",
					failedExtensions.length > 1 ? "s were" : " was",
					` not ${actionPast}, try ${template ? "using" : "installing"} `,
					failedExtensions.length > 1 ? "them" : "it",
					` manually with \`quarto ${template ? "use" : "add"} <extension>\`:`,
				].join("");
				vscode.window.showErrorMessage(`${message} ${failedExtensions.join(", ")}. ${showLogsCommand()}.`);
			} else {
				const message = [
					installedCount,
					" extension",
					installedCount > 1 ? "s" : "",
					` ${actionPast} successfully.`,
				].join("");
				logMessage(message, "info");
				vscode.window.showInformationMessage(`${message} ${showLogsCommand()}.`);
			}
		},
	);
}

/**
 * Command to install Quarto extensions in a specified workspace folder.
 * Prompts the user to select extensions, installs them, and optionally handles templates.
 *
 * @param context - The extension context.
 * @param workspaceFolder - The target workspace folder for extension installation.
 * @param template - Whether to filter for and handle template extensions.
 */
export async function installQuartoExtensionFolderCommand(
	context: vscode.ExtensionContext,
	workspaceFolder: string,
	template = false,
) {
	const isConnected = await checkInternetConnection("https://github.com/");
	if (!isConnected) {
		return;
	}

	let extensionsList = await getExtensionsDetails(context);
	if (template) {
		extensionsList = extensionsList.filter((ext) => ext.template);
	}

	// Show type filter picker (skip for template mode as it's already filtered)
	let typeFilter: string | null = null;
	if (!template) {
		const filterResult = await showTypeFilterQuickPick(extensionsList);

		if (filterResult.type === "cancelled") {
			return;
		}

		// If user selected an alternative source at the filter stage, install directly
		if (filterResult.type === "github" || filterResult.type === "url" || filterResult.type === "local") {
			await installFromSource(context, filterResult.source, workspaceFolder, template);
			return;
		}

		// User selected a filter
		typeFilter = filterResult.value;
	}

	const recentKey = template ? QW_RECENTLY_USED : QW_RECENTLY_INSTALLED;
	const recentExtensions: string[] = context.globalState.get(recentKey, []);
	const result = await showExtensionQuickPick(extensionsList, recentExtensions, template, typeFilter);

	if (result.type === "cancelled") {
		return;
	}

	if (result.type === "registry") {
		// Registry installation flow
		if (result.items.length > 0) {
			await installQuartoExtensions(context, result.items, workspaceFolder, template);
			const selectedIDs = result.items.map((ext) => ext.id).filter(Boolean) as string[];
			const updatedRecentExtensions = [
				...selectedIDs,
				...recentExtensions.filter((ext) => !selectedIDs.includes(ext)),
			];
			await context.globalState.update(recentKey, updatedRecentExtensions.slice(0, 5));
		}
	} else {
		// Alternative source installation (github, url, local)
		await installFromSource(context, result.source, workspaceFolder, template);
	}
}

/**
 * Detect the source type for logging purposes.
 */
function detectSourceTypeForLogging(source: string): string {
	if (source.startsWith("http://") || source.startsWith("https://")) {
		return "URL";
	}
	if (source.startsWith("/") || source.startsWith("~") || /^[a-zA-Z]:[/\\]/.test(source)) {
		return "local path";
	}
	return "GitHub";
}

/**
 * Install extension from an alternative source (GitHub, URL, or local path).
 *
 * @param context - The extension context for authentication.
 * @param source - The source string (GitHub repo, URL, or local path).
 * @param workspaceFolder - The workspace folder where the extension will be installed.
 * @param template - Whether to use the template functionality.
 */
async function installFromSource(
	context: vscode.ExtensionContext,
	source: string,
	workspaceFolder: string,
	template: boolean,
) {
	if ((await askTrustAuthors()) !== 0) return;
	if ((await askConfirmInstall()) !== 0) return;

	const auth = await getAuthConfig(context, { createIfNone: true });
	const actionWord = template ? "Using" : "Installing";
	const sourceType = detectSourceTypeForLogging(source);

	// Log source and extension
	logMessage(`Source: ${sourceType}.`, "info");
	logMessage(`Extension: ${source}.`, "info");
	if (!auth?.githubToken && (auth?.httpHeaders?.length ?? 0) === 0) {
		logMessage("Authentication: none (public access).", "info");
	}

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `${actionWord} extension from ${source} (${showLogsCommand()})`,
			cancellable: false,
		},
		async () => {
			let success: boolean;
			if (template) {
				const selectFiles = createFileSelectionCallback();
				const result = await useQuartoExtension(source, workspaceFolder, selectFiles, auth);
				success = result !== null;
			} else {
				success = await installQuartoExtension(source, workspaceFolder, auth);
			}

			if (success) {
				const message = template ? "Template used successfully." : "Extension installed successfully.";
				logMessage(message, "info");
				vscode.window.showInformationMessage(`${message} ${showLogsCommand()}.`);
			}
		},
	);
}

/**
 * Command handler for installing Quarto extensions.
 * Prompts the user to select a workspace folder and then calls installQuartoExtensionFolderCommand.
 *
 * @param context - The extension context.
 */
export async function installQuartoExtensionCommand(context: vscode.ExtensionContext) {
	const workspaceFolder = await selectWorkspaceFolder();
	if (!workspaceFolder) {
		return;
	}
	installQuartoExtensionFolderCommand(context, workspaceFolder, false);
}

/**
 * Executes the command to use a Quarto template.
 * This function prompts the user to select a workspace folder, then installs a Quarto extension configured as a template.
 *
 * @param context - The VS Code extension context
 * @returns A Promise that resolves when the operation is complete, or void if the user cancels folder selection
 */
export async function useQuartoTemplateCommand(context: vscode.ExtensionContext) {
	const workspaceFolder = await selectWorkspaceFolder();
	if (!workspaceFolder) {
		return;
	}
	installQuartoExtensionFolderCommand(context, workspaceFolder, true);
}
