import { exec } from "child_process";
import * as vscode from "vscode";

function getQuartoPath(): string {
	const config = vscode.workspace.getConfiguration("quartoWizard.quarto");
	let quartoPath = config.get<string>("path");
	if (!quartoPath) {
		const fallbackConfig = vscode.workspace.getConfiguration("quarto");
		quartoPath = fallbackConfig.get<string>("path");
	}
	return quartoPath || "quarto";
}
export async function checkQuartoVersion(): Promise<boolean> {
	return new Promise((resolve) => {
		const quartoPath = getQuartoPath();
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
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
		const quartoPath = getQuartoPath();
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
			resolve(true);
		});
	});
}
