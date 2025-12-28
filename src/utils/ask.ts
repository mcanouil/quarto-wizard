import * as vscode from "vscode";
import { showLogsCommand, logMessage } from "../utils/log";

/**
 * Prompts the user to trust the authors of the selected extensions when the trustAuthors setting is set to "ask".
 * @returns {Promise<number>} - Returns 0 if the authors are trusted or if the setting is updated to "never", otherwise returns 1.
 */
export async function askTrustAuthors(): Promise<number> {
	const config = vscode.workspace.getConfiguration("quartoWizard.ask", null);
	const configTrustAuthors = config.get<string>("trustAuthors");

	if (configTrustAuthors === "ask") {
		const trustAuthors = await vscode.window.showQuickPick(
			[
				{ label: "Yes", description: "Trust authors." },
				{ label: "No", description: "Do not trust authors." },
				{ label: "Yes, always trust", description: "Change setting to always trust." },
			],
			{
				placeHolder: "Do you trust the authors of the selected extension(s)?",
			}
		);
		if (trustAuthors?.label === "Yes, always trust") {
			await config.update("trustAuthors", "never", vscode.ConfigurationTarget.Global);
			return 0;
		} else if (trustAuthors?.label !== "Yes") {
			const message = "Operation cancelled because the authors are not trusted.";
			logMessage(message, "info");
			vscode.window.showInformationMessage(`${message} ${showLogsCommand()}.`);
			return 1;
		}
	}
	return 0;
}

/**
 * Prompts the user to confirm the installation of the selected extensions when the confirmInstall setting is set to "ask".
 * @returns {Promise<number>} - Returns 0 if the installation is confirmed or if the setting is updated to "never", otherwise returns 1.
 */
export async function askConfirmInstall(): Promise<number> {
	const config = vscode.workspace.getConfiguration("quartoWizard.ask", null);
	const configConfirmInstall = config.get<string>("confirmInstall");

	if (configConfirmInstall === "ask") {
		const installWorkspace = await vscode.window.showQuickPick(
			[
				{ label: "Yes", description: "Install extensions." },
				{ label: "No", description: "Do not install extensions." },
				{ label: "Yes, always trust", description: "Change setting to always trust." },
			],
			{
				placeHolder: "Do you want to install the selected extension(s)?",
			}
		);
		if (installWorkspace?.label === "Yes, always trust") {
			await config.update("confirmInstall", "never", vscode.ConfigurationTarget.Global);
			return 0;
		} else if (installWorkspace?.label !== "Yes") {
			const message = "Operation cancelled by the user.";
			logMessage(message, "info");
			vscode.window.showInformationMessage(`${message} ${showLogsCommand()}.`);
			return 1;
		}
	}
	return 0;
}

/**
 * Prompts the user to confirm the removal of the selected extensions when the confirmRemove setting is set to "always".
 * @returns {Promise<number>} - Returns 0 if the removal is confirmed or if the setting is updated to "never", otherwise returns 1.
 */
export async function askConfirmRemove(): Promise<number> {
	const config = vscode.workspace.getConfiguration("quartoWizard.ask");
	const configConfirmRemove = config.get<string>("confirmRemove");

	if (configConfirmRemove === "always") {
		const removeWorkspace = await vscode.window.showQuickPick(
			[
				{ label: "Yes", description: "Remove extensions." },
				{ label: "No", description: "Do not remove extensions." },
				{ label: "Yes, always trust", description: "Change setting to always trust." },
			],
			{
				placeHolder: "Do you want to remove the selected extension(s)?",
			}
		);
		if (removeWorkspace?.label === "Yes, always trust") {
			await config.update("confirmRemove", "never", vscode.ConfigurationTarget.Global);
			return 0;
		} else if (removeWorkspace?.label !== "Yes") {
			const message = "Operation cancelled by the user.";
			logMessage(message, "info");
			vscode.window.showInformationMessage(`${message} ${showLogsCommand()}.`);
			return 1;
		}
	}
	return 0;
}

/**
 * Result type for batch overwrite confirmation.
 */
export type OverwriteBatchResult = "all" | "none" | string[];

/**
 * Creates a callback for batch file overwrite confirmation.
 * Shows all conflicting files upfront and lets the user choose how to handle them.
 *
 * @returns A function that receives all conflicting files and returns which ones to overwrite.
 */
export function createConfirmOverwriteBatch(): (files: string[]) => Promise<OverwriteBatchResult> {
	return async (files: string[]): Promise<OverwriteBatchResult> => {
		if (files.length === 0) {
			return "all";
		}

		if (files.length === 1) {
			// For a single file, show simple dialog
			const result = await vscode.window.showWarningMessage(
				`File "${files[0]}" already exists. Overwrite?`,
				{ modal: true },
				"Yes",
				"No"
			);
			return result === "Yes" ? "all" : "none";
		}

		// For multiple files, show options
		const fileList = files.map((f) => `  • ${f}`).join("\n");
		const result = await vscode.window.showWarningMessage(
			`The following ${files.length} file(s) already exist:\n${fileList}\n\nHow would you like to proceed?`,
			{ modal: true },
			"Overwrite All",
			"Choose Individually",
			"Skip All"
		);

		if (result === "Overwrite All") {
			return "all";
		}

		if (result === "Skip All" || result === undefined) {
			return "none";
		}

		// "Choose Individually" - show QuickPick for file selection
		const items = files.map((file) => ({
			label: file,
			picked: false,
		}));

		const selected = await vscode.window.showQuickPick(items, {
			canPickMany: true,
			placeHolder: "Select files to overwrite (press Enter to confirm)",
			title: "Choose Files to Overwrite",
		});

		if (!selected || selected.length === 0) {
			return "none";
		}

		return selected.map((item) => item.label);
	};
}
