import * as vscode from "vscode";
import { exec } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { logMessage } from "./log";
import { findModifiedExtensions, getMtimeExtensions } from "./extensions";

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

export async function installQuartoExtension(extension: string): Promise<boolean> {
	logMessage(`Installing ${extension} ...`, "info");
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
				logMessage(`${stderr}, "error"`);
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

// Update _extension.yml file with source, i.e., GitHub username/repo
// This is needed for the extension to be updated in the future
// To be removed when Quarto supports source records in the _extension.yml file or elsewhere
// See https://github.com/quarto-dev/quarto-cli/issues/11468
export async function installQuartoExtensionSource(extension: string, workspaceFolder: string): Promise<boolean> {
	const extensionsDirectory = path.join(workspaceFolder, "_extensions");
	const existingExtensions = getMtimeExtensions(extensionsDirectory);

	const success = await installQuartoExtension(extension);

	const newExtension = findModifiedExtensions(existingExtensions, extensionsDirectory);
	const fileNames = ["_extension.yml", "_extension.yaml"];
	const filePath = fileNames
		.map((name) => path.join(extensionsDirectory, ...newExtension, name))
		.find((fullPath) => fs.existsSync(fullPath));
	if (filePath) {
		const fileContent = fs.readFileSync(filePath, "utf-8");
		const updatedContent = fileContent.includes("source: ")
			? fileContent.replace(/source: .*/, `source: ${extension}`)
			: `${fileContent.trim()}\nsource: ${extension}`;
		fs.writeFileSync(filePath, updatedContent);
	}
	vscode.commands.executeCommand("quartoWizard.extensionsInstalled.refresh");
	return success;
}

export async function removeQuartoExtension(extension: string): Promise<boolean> {
	logMessage(`Removing ${extension} ...`, "info");

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
				logMessage(`${stderr}`, "error");
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
