import * as vscode from "vscode";
import {
	install,
	remove,
	removeMultiple,
	use,
	parseInstallSource,
	parseExtensionId,
	type UseResult,
	type FileSelectionCallback,
	type AuthConfig,
	type DiscoveredExtension,
	type ExtensionManifest,
} from "@quarto-wizard/core";
import { logMessage } from "./log";
import { getQuartoVersionInfo } from "../services/quartoVersion";
import { validateQuartoRequirement } from "./versionValidation";
import { showExtensionSelectionQuickPick } from "../ui/extensionSelectionQuickPick";

/**
 * Creates a callback for confirming extension overwrite.
 *
 * @param prefix - Log prefix for messages
 * @param skipPrompt - If true, return true without prompting
 * @returns Callback function
 */
function createConfirmOverwriteCallback(
	prefix: string,
	skipPrompt: boolean,
): (extension: DiscoveredExtension) => Promise<boolean> {
	return async (extension: DiscoveredExtension): Promise<boolean> => {
		if (skipPrompt) {
			return true;
		}
		const extId = extension.id.owner ? `${extension.id.owner}/${extension.id.name}` : extension.id.name;
		const action = await vscode.window.showWarningMessage(
			`Extension "${extId}" already exists. Overwrite?`,
			{ modal: true },
			"Overwrite",
		);
		if (action !== "Overwrite") {
			logMessage(`${prefix} Installation cancelled - extension already exists.`, "info");
			return false;
		}
		return true;
	};
}

/**
 * Creates a callback for validating Quarto version requirements.
 *
 * @param prefix - Log prefix for messages
 * @returns Callback function
 */
function createValidateQuartoVersionCallback(
	prefix: string,
): (required: string, manifest: ExtensionManifest) => Promise<boolean> {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	return async (required: string, _manifest: ExtensionManifest): Promise<boolean> => {
		const quartoInfo = await getQuartoVersionInfo();
		const validation = validateQuartoRequirement(required, quartoInfo.version);

		if (!validation.valid) {
			logMessage(`${prefix} Version requirement not met: ${validation.message}`, "warn");

			const action = await vscode.window.showWarningMessage(
				`${validation.message}`,
				{ modal: true, detail: "The extension may not work correctly with your current Quarto version." },
				"Install Anyway",
			);

			if (action !== "Install Anyway") {
				logMessage(`${prefix} Installation cancelled by user due to version mismatch.`, "info");
				return false;
			}

			logMessage(`${prefix} User chose to install despite version mismatch.`, "info");
		}
		return true;
	};
}

/**
 * Installs a Quarto extension using the core library.
 * Uses single-pass installation with interactive callbacks for overwrite and version validation.
 *
 * @param extension - The name of the extension to install (e.g., "owner/repo" or "owner/repo@version").
 * @param workspaceFolder - The workspace folder path.
 * @param auth - Optional authentication configuration for private repositories.
 * @param sourceDisplay - Optional display source to record in manifest (for relative paths that were resolved).
 * @param skipOverwritePrompt - If true, skip the overwrite confirmation prompt (used by update commands).
 * @returns A promise that resolves to true if the extension is installed successfully, otherwise false.
 */
export async function installQuartoExtension(
	extension: string,
	workspaceFolder: string,
	auth?: AuthConfig,
	sourceDisplay?: string,
	skipOverwritePrompt?: boolean,
): Promise<boolean> {
	const prefix = `[${sourceDisplay ?? extension}]`;
	logMessage(`${prefix} Installing ...`, "info");

	if (!workspaceFolder) {
		logMessage(`${prefix} No workspace folder specified.`, "error");
		return false;
	}

	try {
		const source = parseInstallSource(extension);

		// Single-pass installation with interactive callbacks
		const result = await install(source, {
			projectDir: workspaceFolder,
			force: true,
			auth,
			sourceDisplay,
			selectExtension: showExtensionSelectionQuickPick,
			confirmOverwrite: createConfirmOverwriteCallback(prefix, skipOverwritePrompt ?? false),
			validateQuartoVersion: createValidateQuartoVersionCallback(prefix),
			onProgress: (progress) => {
				logMessage(`${prefix} [${progress.phase}] ${progress.message}`, "debug");
			},
		});

		if (result.cancelled) {
			// User cancelled via callback (overwrite or version mismatch)
			return false;
		}

		if (result.success) {
			logMessage(`${prefix} Successfully installed.`, "info");
			// Refresh the extensions tree view to show the newly installed extension
			vscode.commands.executeCommand("quartoWizard.extensionsInstalled.refresh");
			return true;
		} else {
			logMessage(`${prefix} Failed to install.`, "error");
			return false;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logMessage(`${prefix} Error: ${message}`, "error");

		// Check for authentication errors and offer to sign in
		if (message.includes("401") || message.includes("authentication") || message.includes("Unauthorized")) {
			const action = await vscode.window.showErrorMessage(
				"Authentication may be required. Sign in to GitHub to access private repositories.",
				"Sign In",
				"Set Token",
			);
			if (action === "Sign In") {
				// Trigger native GitHub sign-in (will be handled by caller on retry)
				logMessage("User requested GitHub sign-in.", "info");
			} else if (action === "Set Token") {
				await vscode.commands.executeCommand("quartoWizard.setGitHubToken");
			}
		}

		return false;
	}
}

/**
 * Removes a Quarto extension using the core library.
 *
 * @param {string} extension - The name of the extension to remove (e.g., "owner/name").
 * @param {string} workspaceFolder - The workspace folder path.
 * @returns {Promise<boolean>} - A promise that resolves to true if the extension is removed successfully, otherwise false.
 */
export async function removeQuartoExtension(extension: string, workspaceFolder: string): Promise<boolean> {
	const prefix = `[${extension}]`;
	logMessage(`${prefix} Removing ...`, "info");

	if (!workspaceFolder) {
		logMessage(`${prefix} No workspace folder specified.`, "error");
		return false;
	}

	try {
		const extensionId = parseExtensionId(extension);

		const result = await remove(extensionId, {
			projectDir: workspaceFolder,
			cleanupEmpty: true,
		});

		if (result.success) {
			logMessage(`${prefix} Successfully removed.`, "info");
			vscode.commands.executeCommand("quartoWizard.extensionsInstalled.refresh");
			return true;
		} else {
			logMessage(`${prefix} Failed to remove.`, "error");
			return false;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logMessage(`${prefix} Error: ${message}`, "error");
		return false;
	}
}

/**
 * Batch removal result for tracking success/failure.
 */
export interface BatchRemoveResult {
	successCount: number;
	failedExtensions: string[];
}

/**
 * Removes multiple Quarto extensions using the core library.
 *
 * @param extensions - Array of extension names to remove (e.g., "owner/name").
 * @param workspaceFolder - The workspace folder path.
 * @returns A promise that resolves to the batch remove result.
 */
export async function removeQuartoExtensions(
	extensions: string[],
	workspaceFolder: string,
): Promise<BatchRemoveResult> {
	const prefix = `[batch-remove]`;
	logMessage(`${prefix} Removing ${extensions.length} extension(s): ${extensions.join(", ")}`, "info");

	if (!workspaceFolder) {
		logMessage(`${prefix} No workspace folder specified.`, "error");
		return { successCount: 0, failedExtensions: extensions };
	}

	try {
		const extensionIds = extensions.map((ext) => parseExtensionId(ext));

		const results = await removeMultiple(extensionIds, {
			projectDir: workspaceFolder,
			cleanupEmpty: true,
		});

		const successCount = results.filter((r) => "success" in r && r.success).length;
		const failedExtensions = results
			.filter((r) => "error" in r)
			.map((r) => {
				const failed = r as { extensionId: { owner: string | null; name: string }; error: string };
				return failed.extensionId.owner
					? `${failed.extensionId.owner}/${failed.extensionId.name}`
					: failed.extensionId.name;
			});

		if (successCount > 0) {
			logMessage(`${prefix} Successfully removed ${successCount} extension(s).`, "info");
		}
		if (failedExtensions.length > 0) {
			logMessage(`${prefix} Failed to remove: ${failedExtensions.join(", ")}`, "error");
		}

		vscode.commands.executeCommand("quartoWizard.extensionsInstalled.refresh");

		return { successCount, failedExtensions };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logMessage(`${prefix} Error: ${message}`, "error");
		return { successCount: 0, failedExtensions: extensions };
	}
}

/**
 * Callback to confirm overwriting existing extensions.
 * Shows a VS Code dialog for each extension that already exists.
 *
 * @param extensions - Extensions that already exist in the project.
 * @returns Extensions to overwrite, or null to cancel.
 */
async function showExtensionOverwriteConfirmation(
	extensions: DiscoveredExtension[],
): Promise<DiscoveredExtension[] | null> {
	if (extensions.length === 0) {
		return [];
	}

	const extNames = extensions.map((ext) => (ext.id.owner ? `${ext.id.owner}/${ext.id.name}` : ext.id.name)).join(", ");

	const message =
		extensions.length === 1
			? `Extension "${extNames}" already exists. Overwrite?`
			: `${extensions.length} extensions already exist: ${extNames}. Overwrite all?`;

	const action = await vscode.window.showWarningMessage(message, { modal: true }, "Overwrite", "Skip");

	if (action === "Overwrite") {
		return extensions;
	} else if (action === "Skip") {
		return [];
	}
	// User cancelled (dismissed the dialog)
	return null;
}

/**
 * Uses a Quarto template extension: installs it and copies template files to the project.
 *
 * The flow is:
 * 1. File selection dialog (which files to copy from template).
 * 2. Extension selection dialog (if source contains multiple extensions).
 * 3. Overwrite confirmation (for extensions that already exist).
 * 4. Install selected extensions and copy selected files.
 *
 * @param extension - The name of the extension to use (e.g., "owner/repo" or "owner/repo@version").
 * @param workspaceFolder - The workspace folder path.
 * @param selectFiles - Callback for interactive file selection.
 * @param auth - Optional authentication configuration for private repositories.
 * @param sourceDisplay - Optional display source to record in manifest (for relative paths that were resolved).
 * @returns A promise that resolves to the use result, or null on failure.
 */
export async function useQuartoExtension(
	extension: string,
	workspaceFolder: string,
	selectFiles?: FileSelectionCallback,
	auth?: AuthConfig,
	sourceDisplay?: string,
): Promise<UseResult | null> {
	const prefix = `[${sourceDisplay ?? extension}]`;
	logMessage(`${prefix} Using template ...`, "info");

	if (!workspaceFolder) {
		logMessage(`${prefix} No workspace folder specified.`, "error");
		return null;
	}

	try {
		const source = parseInstallSource(extension);

		const result = await use(source, {
			projectDir: workspaceFolder,
			selectFiles,
			selectFilesFirst: true,
			selectExtension: showExtensionSelectionQuickPick,
			confirmExtensionOverwrite: showExtensionOverwriteConfirmation,
			auth,
			sourceDisplay,
			onProgress: (progress) => {
				if (progress.file) {
					logMessage(`${prefix} [${progress.phase}] ${progress.message} (${progress.file})`, "debug");
				} else {
					logMessage(`${prefix} [${progress.phase}] ${progress.message}`, "debug");
				}
			},
		});

		// Check if user cancelled file selection or extension selection
		if (result.cancelled) {
			logMessage(`${prefix} Template usage cancelled by user.`, "info");
			return null;
		}

		if (result.install.success) {
			logMessage(`${prefix} Successfully installed template.`, "info");

			if (result.templateFiles.length > 0) {
				logMessage(`${prefix} Copied ${result.templateFiles.length} template file(s):`, "info");
				result.templateFiles.forEach((file) => logMessage(`${prefix}   - ${file}`, "info"));
			}

			if (result.skippedFiles.length > 0) {
				logMessage(`${prefix} Skipped ${result.skippedFiles.length} existing file(s):`, "info");
				result.skippedFiles.forEach((file) => logMessage(`${prefix}   - ${file}`, "info"));
			}

			vscode.commands.executeCommand("quartoWizard.extensionsInstalled.refresh");
			return result;
		} else {
			logMessage(`${prefix} Failed to use template.`, "error");
			return null;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logMessage(`${prefix} Error: ${message}`, "error");

		// Check for authentication errors and offer to sign in
		if (message.includes("401") || message.includes("authentication") || message.includes("Unauthorized")) {
			const action = await vscode.window.showErrorMessage(
				"Authentication may be required. Sign in to GitHub to access private repositories.",
				"Sign In",
				"Set Token",
			);
			if (action === "Sign In") {
				logMessage(`${prefix} User requested GitHub sign-in.`, "info");
			} else if (action === "Set Token") {
				await vscode.commands.executeCommand("quartoWizard.setGitHubToken");
			}
		}

		return null;
	}
}
