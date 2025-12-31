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
} from "@quarto-wizard/core";
import { logMessage } from "./log";

/**
 * Installs a Quarto extension using the core library.
 *
 * @param extension - The name of the extension to install (e.g., "owner/repo" or "owner/repo@version").
 * @param workspaceFolder - The workspace folder path.
 * @param auth - Optional authentication configuration for private repositories.
 * @returns A promise that resolves to true if the extension is installed successfully, otherwise false.
 */
export async function installQuartoExtension(
	extension: string,
	workspaceFolder: string,
	auth?: AuthConfig,
): Promise<boolean> {
	logMessage(`Installing ${extension} ...`, "info");

	if (!workspaceFolder) {
		logMessage("No workspace folder specified.", "error");
		return false;
	}

	try {
		const source = parseInstallSource(extension);

		const result = await install(source, {
			projectDir: workspaceFolder,
			force: true,
			auth,
			onProgress: (progress) => {
				logMessage(`[${progress.phase}] ${progress.message}`, "debug");
			},
		});

		if (result.success) {
			logMessage(`Successfully installed ${extension}`, "info");
			// Refresh the extensions tree view to show the newly installed extension
			vscode.commands.executeCommand("quartoWizard.extensionsInstalled.refresh");
			return true;
		} else {
			logMessage(`Failed to install ${extension}`, "error");
			return false;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logMessage(`Error installing extension: ${message}`, "error");

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
	logMessage(`Removing ${extension} ...`, "info");

	if (!workspaceFolder) {
		logMessage("No workspace folder specified.", "error");
		return false;
	}

	try {
		const extensionId = parseExtensionId(extension);

		const result = await remove(extensionId, {
			projectDir: workspaceFolder,
			cleanupEmpty: true,
		});

		if (result.success) {
			logMessage(`Successfully removed ${extension}`, "info");
			vscode.commands.executeCommand("quartoWizard.extensionsInstalled.refresh");
			return true;
		} else {
			logMessage(`Failed to remove ${extension}`, "error");
			return false;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logMessage(`Error removing extension: ${message}`, "error");
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
	logMessage(`Removing ${extensions.length} extension(s) ...`, "info");

	if (!workspaceFolder) {
		logMessage("No workspace folder specified.", "error");
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
				return failed.extensionId.owner ? `${failed.extensionId.owner}/${failed.extensionId.name}` : failed.extensionId.name;
			});

		if (successCount > 0) {
			logMessage(`Successfully removed ${successCount} extension(s)`, "info");
		}
		if (failedExtensions.length > 0) {
			logMessage(`Failed to remove: ${failedExtensions.join(", ")}`, "error");
		}

		vscode.commands.executeCommand("quartoWizard.extensionsInstalled.refresh");

		return { successCount, failedExtensions };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logMessage(`Error removing extensions: ${message}`, "error");
		return { successCount: 0, failedExtensions: extensions };
	}
}

/**
 * Uses a Quarto template extension: installs it and copies template files to the project.
 *
 * @param extension - The name of the extension to use (e.g., "owner/repo" or "owner/repo@version").
 * @param workspaceFolder - The workspace folder path.
 * @param selectFiles - Callback for interactive file selection.
 * @param auth - Optional authentication configuration for private repositories.
 * @returns A promise that resolves to the use result, or null on failure.
 */
export async function useQuartoExtension(
	extension: string,
	workspaceFolder: string,
	selectFiles?: FileSelectionCallback,
	auth?: AuthConfig,
): Promise<UseResult | null> {
	logMessage(`Using template ${extension} ...`, "info");

	if (!workspaceFolder) {
		logMessage("No workspace folder specified.", "error");
		return null;
	}

	try {
		const source = parseInstallSource(extension);

		const result = await use(source, {
			projectDir: workspaceFolder,
			selectFiles,
			auth,
			onProgress: (progress) => {
				if (progress.file) {
					logMessage(`[${progress.phase}] ${progress.message} (${progress.file})`, "debug");
				} else {
					logMessage(`[${progress.phase}] ${progress.message}`, "debug");
				}
			},
		});

		if (result.install.success) {
			logMessage(`Successfully installed template extension ${extension}`, "info");

			if (result.templateFiles.length > 0) {
				logMessage(`Copied ${result.templateFiles.length} template file(s):`, "info");
				result.templateFiles.forEach((file) => logMessage(`  - ${file}`, "info"));
			}

			if (result.skippedFiles.length > 0) {
				logMessage(`Skipped ${result.skippedFiles.length} existing file(s):`, "info");
				result.skippedFiles.forEach((file) => logMessage(`  - ${file}`, "info"));
			}

			vscode.commands.executeCommand("quartoWizard.extensionsInstalled.refresh");
			return result;
		} else {
			logMessage(`Failed to use template ${extension}`, "error");
			return null;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logMessage(`Error using template extension: ${message}`, "error");

		// Check for authentication errors and offer to sign in
		if (message.includes("401") || message.includes("authentication") || message.includes("Unauthorized")) {
			const action = await vscode.window.showErrorMessage(
				"Authentication may be required. Sign in to GitHub to access private repositories.",
				"Sign In",
				"Set Token",
			);
			if (action === "Sign In") {
				logMessage("User requested GitHub sign-in.", "info");
			} else if (action === "Set Token") {
				await vscode.commands.executeCommand("quartoWizard.setGitHubToken");
			}
		}

		return null;
	}
}
