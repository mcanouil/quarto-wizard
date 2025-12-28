import * as vscode from "vscode";
import {
	install,
	remove,
	use,
	parseInstallSource,
	parseExtensionId,
	type UseResult,
	type FileSelectionCallback,
} from "@quarto-wizard/core";
import { logMessage } from "./log";

/**
 * Installs a Quarto extension using the core library.
 *
 * @param {string} extension - The name of the extension to install (e.g., "owner/repo" or "owner/repo@version").
 * @param {string} workspaceFolder - The workspace folder path.
 * @returns {Promise<boolean>} - A promise that resolves to true if the extension is installed successfully, otherwise false.
 */
export async function installQuartoExtension(
	extension: string,
	workspaceFolder: string
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
		return false;
	}
}

/**
 * Installs a Quarto extension and ensures source is recorded.
 * With the core library, source is automatically recorded in the manifest.
 *
 * @param {string} extension - The name of the extension to install.
 * @param {string} workspaceFolder - The workspace folder path.
 * @returns {Promise<boolean>} - A promise that resolves to true if the extension is installed successfully, otherwise false.
 */
export async function installQuartoExtensionSource(
	extension: string,
	workspaceFolder: string
): Promise<boolean> {
	// The core library automatically records the source in the manifest
	const success = await installQuartoExtension(extension, workspaceFolder);
	vscode.commands.executeCommand("quartoWizard.extensionsInstalled.refresh");
	return success;
}

/**
 * Removes a Quarto extension using the core library.
 *
 * @param {string} extension - The name of the extension to remove (e.g., "owner/name").
 * @param {string} workspaceFolder - The workspace folder path.
 * @returns {Promise<boolean>} - A promise that resolves to true if the extension is removed successfully, otherwise false.
 */
export async function removeQuartoExtension(
	extension: string,
	workspaceFolder: string
): Promise<boolean> {
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
 * Uses a Quarto template extension: installs it and copies template files to the project.
 *
 * @param {string} extension - The name of the extension to use (e.g., "owner/repo" or "owner/repo@version").
 * @param {string} workspaceFolder - The workspace folder path.
 * @param {FileSelectionCallback} selectFiles - Callback for interactive file selection.
 * @returns {Promise<UseResult | null>} - A promise that resolves to the use result, or null on failure.
 */
export async function useQuartoExtension(
	extension: string,
	workspaceFolder: string,
	selectFiles?: FileSelectionCallback
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
		return null;
	}
}
