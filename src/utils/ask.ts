import * as vscode from "vscode";
import { QUARTO_WIZARD_LOG } from "../constants";
import { showLogsCommand } from "../utils/log";

export async function askTrustAuthors(): Promise<number> {
	const config = vscode.workspace.getConfiguration("quartoWizard.ask", null);
	let configTrustAuthors = config.get<string>("trustAuthors");

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
			QUARTO_WIZARD_LOG.appendLine(message);
			vscode.window.showInformationMessage(`${message} ${showLogsCommand()}.`);
			return 1;
		}
	}
	return 0;
}

export async function askConfirmInstall(): Promise<number> {
	const config = vscode.workspace.getConfiguration("quartoWizard.ask", null);
	let configConfirmInstall = config.get<string>("confirmInstall");

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
			QUARTO_WIZARD_LOG.appendLine(message);
			vscode.window.showInformationMessage(`${message} ${showLogsCommand()}.`);
			return 1;
		}
	}
	return 0;
}

export async function askConfirmRemove(): Promise<number> {
	const config = vscode.workspace.getConfiguration("quartoWizard.ask");
	let configConfirmRemove = config.get<string>("confirmRemove");

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
			QUARTO_WIZARD_LOG.appendLine(message);
			vscode.window.showInformationMessage(`${message} ${showLogsCommand()}.`);
			return 1;
		}
	}
	return 0;
}
