import * as vscode from "vscode";
import * as https from "https";
import { IncomingMessage } from "http";
import { checkQuartoVersion, installQuartoExtension } from "./quarto";
import * as crypto from "crypto";

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
	const mutableSelectedExtensions: ExtensionQuickPickItem[] = [...selectedExtensions];

	const isQuartoAvailable = await checkQuartoVersion();
	if (!isQuartoAvailable) {
		const message =
			"Quarto is not installed or not available in PATH. Please install Quarto and make sure it is available in PATH.";
		log.appendLine(message);
		vscode.window.showErrorMessage(message);
		return;
	}

	const trustAuthors = await vscode.window.showQuickPick(["Yes", "No"], {
		placeHolder: "Do you trust the authors of the selected extension(s)?",
	});
	if (trustAuthors !== "Yes") {
		const message = "Operation cancelled because the authors are not trusted.";
		log.appendLine(message);
		vscode.window.showInformationMessage(message);
		return;
	}

	const installWorkspace = await vscode.window.showQuickPick(["Yes", "No"], {
		placeHolder: "Do you want to install the selected extension(s)?",
	});
	if (installWorkspace !== "Yes") {
		const message = "Operation cancelled by the user.";
		log.appendLine(message);
		vscode.window.showInformationMessage(message);
		return;
	}

	vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: "Installing selected extension(s) ([details](command:quartoExtensions.showOutput))",
			cancellable: true,
		},
		async (progress, token) => {
			token.onCancellationRequested(() => {
				const message = "Operation cancelled by the user ([details](command:quartoExtensions.showOutput)).";
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
					increment: (1 / totalExtensions) * 100,
				});
				const success = await installQuartoExtension(selectedExtension.description, log);
				if (success) {
					installedExtensions.push(selectedExtension.description);
				} else {
					failedExtensions.push(selectedExtension.description);
				}

				installedCount++;
			}

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
					`${message} ${failedExtensions.join(", ")}. See [details](command:quartoExtensions.showOutput).`
				);
			} else {
				const message = [installedCount, " extension", installedCount > 1 ? "s" : "", " installed successfully."].join(
					""
				);
				log.appendLine(message);
				vscode.window.showInformationMessage(`${message} See [details](command:quartoExtensions.showOutput).`);
			}
		}
	);
}
