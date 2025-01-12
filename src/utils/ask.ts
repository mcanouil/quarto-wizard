import * as vscode from "vscode";

export async function askTrustAuthors(log: vscode.OutputChannel): Promise<number> {
	const config = vscode.workspace.getConfiguration("quartoWizard.ask");
	let configTrustAuthors = config.get<string>("trustAuthors");

	if (configTrustAuthors === "always") {
		const trustAuthors = await vscode.window.showQuickPick(
			[
				{ label: "Yes", description: "Trust authors." },
				{ label: "No", description: "Do not trust authors." },
				{ label: "Yes, never ask again", description: "Change setting to never ask again." },
			],
			{
				placeHolder: "Do you trust the authors of the selected extension(s)?",
			}
		);
		if (trustAuthors?.label === "Yes, never ask again") {
			await config.update("trustAuthors", "never", vscode.ConfigurationTarget.Global);
			return 0;
		} else if (trustAuthors?.label !== "Yes") {
			const message = "Operation cancelled because the authors are not trusted.";
			log.appendLine(message);
			vscode.window.showInformationMessage(message);
			return 1;
		}
	}
	return 0;
}

export async function askConfirmInstall(log: vscode.OutputChannel): Promise<number> {
	const config = vscode.workspace.getConfiguration("quartoWizard.ask");
	let configConfirmInstall = config.get<string>("confirmInstall");

	if (configConfirmInstall === "always") {
		const installWorkspace = await vscode.window.showQuickPick(
			[
				{ label: "Yes", description: "Install extensions." },
				{ label: "No", description: "Do not install extensions." },
				{ label: "Yes, never ask again", description: "Change setting to never ask again." },
			],
			{
				placeHolder: "Do you want to install the selected extension(s)?",
			}
		);
		if (installWorkspace?.label === "Yes, never ask again") {
			await config.update("confirmInstall", "never", vscode.ConfigurationTarget.Global);
			return 0;
		} else if (installWorkspace?.label !== "Yes") {
			const message = "Operation cancelled by the user.";
			log.appendLine(message);
			vscode.window.showInformationMessage(message);
			return 1;
		}
	}
	return 0;
}

export async function askConfirmRemove(log: vscode.OutputChannel): Promise<number> {
	const config = vscode.workspace.getConfiguration("quartoWizard.ask");
	let configConfirmRemove = config.get<string>("confirmRemove");

	if (configConfirmRemove === "always") {
		const removeWorkspace = await vscode.window.showQuickPick(
			[
				{ label: "Yes", description: "Remove extensions." },
				{ label: "No", description: "Do not remove extensions." },
				{ label: "Yes, never ask again", description: "Change setting to never ask again." },
			],
			{
				placeHolder: "Do you want to remove the selected extension(s)?",
			}
		);
		if (removeWorkspace?.label === "Yes, never ask again") {
			await config.update("confirmRemove", "never", vscode.ConfigurationTarget.Global);
			return 0;
		} else if (removeWorkspace?.label !== "Yes") {
			const message = "Operation cancelled by the user.";
			log.appendLine(message);
			vscode.window.showInformationMessage(message);
			return 1;
		}
	}
	return 0;
}
