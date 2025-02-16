import * as vscode from "vscode";
import { showLogsCommand, logMessage } from "../utils/log";

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
