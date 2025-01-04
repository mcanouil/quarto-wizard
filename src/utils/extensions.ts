import * as vscode from "vscode";
import * as https from "https";
import { IncomingMessage } from "http";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { installQuartoExtension } from "./quarto";

interface ExtensionQuickPickItem extends vscode.QuickPickItem {
	url?: string;
}

function generateHashKey(url: string): string {
	return crypto.createHash("md5").update(url).digest("hex");
}

function getGitHubLink(extension: string): string {
	const [owner, repo] = extension.split("/").slice(0, 2);
	return `https://github.com/${owner}/${repo}`;
}

function formatExtensionLabel(ext: string): string {
	const parts = ext.split("/");
	const repo = parts[1];
	let formattedRepo = repo.replace(/[-_]/g, " ");
	formattedRepo = formattedRepo.replace(/quarto/gi, "").trim();
	formattedRepo = formattedRepo
		.split(" ")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join(" ");
	return formattedRepo;
}

export async function fetchCSVFromURL(url: string): Promise<string> {
	const cacheKey = `${"quarto_wizard_extensions_csv_"}${generateHashKey(url)}`;
	const cachedData = vscode.workspace.getConfiguration().get<{ data: string; timestamp: number }>(cacheKey);

	if (cachedData && Date.now() - cachedData.timestamp < 12 * 60 * 60 * 1000) {
		return cachedData.data;
	}

	return new Promise((resolve, reject) => {
		https
			.get(url, (res: IncomingMessage) => {
				let data = "";
				res.on("data", (chunk) => {
					data += chunk;
				});
				res.on("end", () => {
					vscode.workspace
						.getConfiguration()
						.update(cacheKey, { data, timestamp: Date.now() }, vscode.ConfigurationTarget.Global);
					resolve(data);
				});
			})
			.on("error", (err) => {
				reject(err);
			});
	});
}

export function createExtensionItems(extensions: string[]): ExtensionQuickPickItem[] {
	return extensions.map((ext) => ({
		label: formatExtensionLabel(ext),
		description: ext,
		buttons: [
			{
				iconPath: new vscode.ThemeIcon("github"),
				tooltip: "Open GitHub Repository",
			},
		],
		url: getGitHubLink(ext),
	}));
}

export async function installQuartoExtensions(
	selectedExtensions: readonly ExtensionQuickPickItem[],
	log: vscode.OutputChannel
) {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath || "";
	const mutableSelectedExtensions: ExtensionQuickPickItem[] = [...selectedExtensions];

	const config = vscode.workspace.getConfiguration("quartoWizard.ask");
	let configTrustAuthors = config.get<string>("trustAuthors");
	let configConfirmInstall = config.get<string>("confirmInstall");

	if (configTrustAuthors === "always") {
		const trustAuthors = await vscode.window.showQuickPick(
			[
				{ label: "Yes", description: "Trust authors." },
				{ label: "No", description: "Do not trust authors." },
				{ label: "Never ask again", description: "Change setting to never ask again." },
			],
			{
				placeHolder: "Do you trust the authors of the selected extension(s)?",
			}
		);
		if (trustAuthors?.label === "Never ask again") {
			await config.update("trustAuthors", "never", vscode.ConfigurationTarget.Global);
		} else if (trustAuthors?.label !== "Yes") {
			const message = "Operation cancelled because the authors are not trusted.";
			log.appendLine(message);
			vscode.window.showInformationMessage(message);
			return;
		}
	}

	if (configConfirmInstall === "always") {
		const installWorkspace = await vscode.window.showQuickPick(
			[
				{ label: "Yes", description: "Install extensions." },
				{ label: "No", description: "Do not install extensions." },
				{ label: "Never ask again", description: "Change setting to never ask again." },
			],
			{
				placeHolder: "Do you want to install the selected extension(s)?",
			}
		);
		if (installWorkspace?.label === "Never ask again") {
			await config.update("confirmInstall", "never", vscode.ConfigurationTarget.Global);
		} else if (installWorkspace?.label !== "Yes") {
			const message = "Operation cancelled by the user.";
			log.appendLine(message);
			vscode.window.showInformationMessage(message);
			return;
		}
	}

	vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: "Installing selected extension(s) ([show logs](command:quartoWizard.showOutput))",
			cancellable: true,
		},
		async (progress, token) => {
			token.onCancellationRequested(() => {
				const message = "Operation cancelled by the user ([show logs](command:quartoWizard.showOutput)).";
				log.appendLine(message);
				vscode.window.showInformationMessage(message);
			});

			const installedExtensions: string[] = [];
			const failedExtensions: string[] = [];
			const totalExtensions = mutableSelectedExtensions.length;
			let installedCount = 0;

			for (const selectedExtension of mutableSelectedExtensions) {
				if (selectedExtension.description === undefined) {
					continue;
				}
				progress.report({
					message: `(${installedCount} / ${totalExtensions}) ${selectedExtension.label} ...`,
					increment: (1 / (totalExtensions + 1)) * 100,
				});

				const extensionsDirectory = path.join(workspaceFolder, "_extensions");
				const existingExtensions = getMtimeExtensions(extensionsDirectory);

				const success = await installQuartoExtension(selectedExtension.description, log);
				if (success) {
					installedExtensions.push(selectedExtension.description);
				} else {
					failedExtensions.push(selectedExtension.description);
				}

				// Update _extension.yml file with source, i.e., GitHub username/repo
				// This is needed for the extension to be updated in the future
				// To be removed when Quarto supports source records in the _extension.yml file or elsewhere
				// See https://github.com/quarto-dev/quarto-cli/issues/11468
				const newExtension = findModifiedExtensions(existingExtensions, extensionsDirectory);
				const fileNames = ["_extension.yml", "_extension.yaml"];
				const filePath = fileNames
					.map((name) => path.join(extensionsDirectory, ...newExtension, name))
					.find((fullPath) => fs.existsSync(fullPath));
				if (filePath) {
					const fileContent = fs.readFileSync(filePath, "utf-8");
					const updatedContent = fileContent.includes("source: ")
						? fileContent.replace(/source: .*/, `source: ${selectedExtension.description}`)
						: `${fileContent.trim()}\nsource: ${selectedExtension.description}`;
					fs.writeFileSync(filePath, updatedContent);
				}

				installedCount++;
			}
			progress.report({
				message: `(${totalExtensions} / ${totalExtensions}) extensions processed.`,
				increment: (1 / (totalExtensions + 1)) * 100,
			});

			if (installedExtensions.length > 0) {
				log.appendLine(`\n\nSuccessfully installed extension${installedExtensions.length > 1 ? "s" : ""}:`);
				installedExtensions.forEach((ext) => {
					log.appendLine(` - ${ext}`);
				});
			}

			if (failedExtensions.length > 0) {
				log.appendLine(`\n\nFailed to install extension${failedExtensions.length > 1 ? "s" : ""}:`);
				failedExtensions.forEach((ext) => {
					log.appendLine(` - ${ext}`);
				});
				const message = [
					"The following extension",
					failedExtensions.length > 1 ? "s were" : " was",
					" not installed, try installing ",
					failedExtensions.length > 1 ? "them" : "it",
					" manually with `quarto add <extension>`:",
				].join("");
				vscode.window.showErrorMessage(
					`${message} ${failedExtensions.join(", ")}. [Show logs](command:quartoWizard.showOutput).`
				);
			} else {
				const message = [installedCount, " extension", installedCount > 1 ? "s" : "", " installed successfully."].join(
					""
				);
				log.appendLine(message);
				vscode.window.showInformationMessage(`${message} [Show logs](command:quartoWizard.showOutput).`);
			}
		}
	);
}

function findQuartoExtensionsRecurse(dir: string): string[] {
	let results: string[] = [];
	const list = fs.readdirSync(dir);
	list.forEach((file) => {
		const filePath = path.join(dir, file);
		const stat = fs.statSync(filePath);
		if (stat && stat.isDirectory() && path.basename(filePath) !== "_extensions") {
			results = results.concat(findQuartoExtensionsRecurse(filePath));
		} else if (file.endsWith("_extension.yml") || file.endsWith("_extension.yaml")) {
			results.push(filePath);
		}
	});
	return results;
}

export function findQuartoExtensions(dir: string): string[] {
	return findQuartoExtensionsRecurse(dir).map((filePath) =>
		path.relative(dir, path.dirname(filePath))
	);
}

function getMtimeExtensions(dir: string): { [key: string]: Date } {
	if (!fs.existsSync(dir)) {
		return {};
	}
	const extensions = findQuartoExtensions(dir);
	const extensionsMtimeDict: { [key: string]: Date } = {};
	extensions.forEach(extension => {
		extensionsMtimeDict[extension] = fs.statSync(path.join(dir, extension)).mtime;
	});
	return extensionsMtimeDict;
}

function findModifiedExtensions(extensions: { [key: string]: Date }, dir: string): string[] {
	if (!fs.existsSync(dir)) {
		return [];
	}
	const modifiedExtensions: string[] = [];
	const currentExtensions = findQuartoExtensions(dir);
	currentExtensions.forEach(extension => {
		const extensionPath = path.join(dir, extension);
		const extensionMtime = fs.statSync(extensionPath).mtime;
		if (!extensions[extension] || extensions[extension] < extensionMtime) {
			modifiedExtensions.push(extension);
		}
	});
	return modifiedExtensions;
}
