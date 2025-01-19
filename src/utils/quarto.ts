import * as vscode from "vscode";
import { exec } from "child_process";

let cachedQuartoPath: string | undefined;

export function getQuartoPath(): string {
	if (cachedQuartoPath) {
		return cachedQuartoPath;
	}
	const config = vscode.workspace.getConfiguration("quartoWizard.quarto");
	let quartoPath = config.get<string>("path");
	if (!quartoPath && quartoPath !== "") {
		const fallbackConfig = vscode.workspace.getConfiguration("quarto");
		quartoPath = fallbackConfig.get<string>("path");
	}
	if (!quartoPath && quartoPath !== "") {
		quartoPath = "quarto";
	}
	cachedQuartoPath = quartoPath || "quarto";
	return cachedQuartoPath;
}

vscode.workspace.onDidChangeConfiguration(async (e) => {
	if (e.affectsConfiguration("quartoWizard.quarto.path") || e.affectsConfiguration("quarto.path")) {
		cachedQuartoPath = undefined;
		await checkQuartoPath(getQuartoPath());
	}
});

export async function checkQuartoPath(quartoPath: string | undefined): Promise<boolean> {
	return new Promise((resolve) => {
		if (!quartoPath) {
			vscode.window.showErrorMessage("Quarto path is not set.");
			resolve(false);
		} else if (!checkQuartoVersion(quartoPath)) {
			vscode.window.showErrorMessage(`Quarto path '${quartoPath}' does not exist.`);
			resolve(false);
		} else {
			resolve(true);
		}
	});
}

export async function checkQuartoVersion(quartoPath: string | undefined): Promise<boolean> {
	return new Promise((resolve) => {
		exec(`${quartoPath} --version`, (error, stdout, stderr) => {
			if (error || stderr) {
				resolve(false);
			} else {
				resolve(stdout.trim().length > 0);
			}
		});
	});
}

export async function installQuartoExtension(extension: string, log: vscode.OutputChannel): Promise<boolean> {
	log.appendLine(`\n\nInstalling ${extension} ...`);
	return new Promise((resolve) => {
		if (vscode.workspace.workspaceFolders === undefined) {
			return;
		}
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
		const quartoPath = getQuartoPath();
		checkQuartoPath(quartoPath);
		const command = `${quartoPath} add ${extension} --no-prompt`;

		exec(command, { cwd: workspaceFolder }, (error, stdout, stderr) => {
			if (stderr) {
				log.appendLine(`${stderr}`);
				const isInstalled = stderr.includes("Extension installation complete");
				if (isInstalled) {
					resolve(true);
				} else {
					resolve(false);
					return;
				}
			}
			vscode.commands.executeCommand("quartoWizard.extensionsInstalled.refresh");
			resolve(true);
		});
	});
}

export async function removeQuartoExtension(extension: string, log: vscode.OutputChannel): Promise<boolean> {
	log.appendLine(`\n\nRemoving ${extension} ...`);

	return new Promise((resolve) => {
		if (vscode.workspace.workspaceFolders === undefined) {
			return;
		}
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
		const quartoPath = getQuartoPath();
		checkQuartoPath(quartoPath);
		const command = `${quartoPath} remove ${extension} --no-prompt`;

		exec(command, { cwd: workspaceFolder }, (error, stdout, stderr) => {
			if (stderr) {
				log.appendLine(`${stderr}`);
				const isRemoved = stderr.includes("Extension removed");
				if (isRemoved) {
					resolve(true);
				} else {
					resolve(false);
					return;
				}
			}
			vscode.commands.executeCommand("quartoWizard.extensionsInstalled.refresh");
			resolve(true);
		});
	});
}
