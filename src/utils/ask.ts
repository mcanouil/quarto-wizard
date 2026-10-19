import * as vscode from "vscode";
import { logMessage, showMessageWithLogs } from "../utils/log";
import { getErrorMessage } from "@quarto-wizard/core";

/**
 * Configuration for a confirmation dialog.
 */
interface ConfirmationDialogConfig {
	/** The configuration key to check (e.g., "trustAuthors"). */
	configKey: string;
	/** The value that triggers the prompt (e.g., "ask" or "always"). */
	triggerValue: string;
	/** The placeholder text for the quick pick. */
	placeholder: string;
	/** Description for the "Yes" option. */
	yesDescription: string;
	/** Description for the "No" option. */
	noDescription: string;
	/** Label for the "always" option (e.g., "Yes, always trust"). */
	alwaysLabel: string;
	/** Description for the "always" option. */
	alwaysDescription: string;
	/** Message to show when the user cancels. */
	cancelMessage: string;
}

/**
 * Creates a confirmation dialog function based on the provided configuration.
 *
 * @param config - The configuration for the confirmation dialog.
 * @returns A function that prompts the user and returns true if confirmed, false if cancelled.
 */
function createConfirmationDialog(config: ConfirmationDialogConfig): () => Promise<boolean> {
	return async (): Promise<boolean> => {
		try {
			const vsConfig = vscode.workspace.getConfiguration("quartoWizard.ask", null);
			const configValue = vsConfig.get<string>(config.configKey);

			if (configValue === config.triggerValue) {
				const result = await vscode.window.showQuickPick(
					[
						{ label: "Yes", description: config.yesDescription },
						{ label: "No", description: config.noDescription },
						{ label: config.alwaysLabel, description: config.alwaysDescription },
					],
					{
						placeHolder: config.placeholder,
					},
				);
				if (result?.label === config.alwaysLabel) {
					await vsConfig.update(config.configKey, "never", vscode.ConfigurationTarget.Global);
					return true;
				} else if (result?.label !== "Yes") {
					logMessage(config.cancelMessage, "info");
					showMessageWithLogs(config.cancelMessage, "info");
					return false;
				}
			}
			return true;
		} catch (error) {
			logMessage(`Error showing confirmation dialog: ${getErrorMessage(error)}.`, "error");
			return false;
		}
	};
}

/**
 * Prompts the user to trust the authors of the selected extensions when the trustAuthors setting is set to "ask".
 * @returns {Promise<boolean>} - Returns true if confirmed, false if cancelled.
 */
export const confirmTrustAuthors = createConfirmationDialog({
	configKey: "trustAuthors",
	triggerValue: "ask",
	placeholder: "Do you trust the authors of the selected extension(s)?",
	yesDescription: "Trust authors.",
	noDescription: "Do not trust authors.",
	alwaysLabel: "Yes, always trust",
	alwaysDescription: "Change setting to always trust.",
	cancelMessage: "Operation cancelled because the authors are not trusted.",
});

/**
 * Prompts the user to confirm the installation of the selected extensions when the confirmInstall setting is set to "ask".
 * @returns {Promise<boolean>} - Returns true if confirmed, false if cancelled.
 */
export const confirmInstall = createConfirmationDialog({
	configKey: "confirmInstall",
	triggerValue: "ask",
	placeholder: "Do you want to install the selected extension(s)?",
	yesDescription: "Install extensions.",
	noDescription: "Do not install extensions.",
	alwaysLabel: "Yes, always install",
	alwaysDescription: "Change setting to always install.",
	cancelMessage: "Operation cancelled by the user.",
});

/**
 * Creates a callback for selecting target subdirectory.
 * Shows an input box where users can specify a subdirectory for template files.
 *
 * @returns A function that prompts for subdirectory and returns:
 *   - undefined: user cancelled (pressed Escape)
 *   - null: user selected project root (empty string)
 *   - string: user entered a subdirectory path
 */
export function createTargetSubdirCallback(): () => Promise<string | null | undefined> {
	return async (): Promise<string | null | undefined> => {
		const result = await vscode.window.showInputBox({
			title: "Target Subdirectory",
			prompt: "Enter subdirectory for template files (leave empty for project root)",
			placeHolder: "e.g., templates/starter",
			validateInput: (value) => {
				if (value && (value.startsWith("/") || value.startsWith("\\"))) {
					return "Path must be relative (no leading slash)";
				}
				if (value && value.includes("..")) {
					return "Path cannot contain '..'";
				}
				return null;
			},
		});

		// undefined means cancelled (Escape) - stop the operation
		if (result === undefined) {
			return undefined;
		}
		// empty string means project root
		return result || null;
	};
}
