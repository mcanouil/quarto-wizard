import * as vscode from "vscode";
import * as https from "https";
import * as dns from "dns";
import { IncomingMessage } from "http";
import { exec } from "child_process";

const RECENTLY_INSTALLED_QUARTO_EXTENSIONS = "recentlyInstalledExtensions";

const quartoExtensionsLog = vscode.window.createOutputChannel("Quarto Extensions");

interface ExtensionQuickPickItem extends vscode.QuickPickItem {
	url?: string;
}

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand("quartoExtensions.showOutput", () => {
			quartoExtensionsLog.show();
		})
	);

	let disposable = vscode.commands.registerCommand("quartoExtensions.installExtension", async () => {
		const isConnected = await checkInternetConnection();
		if (!isConnected) {
			const message = "No internet connection. Please check your network settings.";
			quartoExtensionsLog.appendLine(message);
			vscode.window.showErrorMessage(message);
			return;
		}

		const isQuartoAvailable = await checkQuartoVersion();
		if (!isQuartoAvailable) {
			const message =
				"Quarto is not installed or not available in PATH. Please install Quarto and make sure it is available in PATH.";
			quartoExtensionsLog.appendLine(message);
			vscode.window.showErrorMessage(message);
			return;
		}

		const csvUrl = "https://raw.githubusercontent.com/mcanouil/quarto-extensions/main/extensions/quarto-extensions.csv";
		let extensionsList: string[] = [];
		// context.globalState.update(RECENTLY_INSTALLED_QUARTO_EXTENSIONS, []);
		let recentlyInstalled: string[] = context.globalState.get(RECENTLY_INSTALLED_QUARTO_EXTENSIONS, []);

		try {
			const data = await fetchCSVFromURL(csvUrl);
			extensionsList = data.split("\n").filter((line) => line.trim() !== "");
		} catch (error) {
			const message = `Error fetching "quarto-extensions.csv" from ${csvUrl}`;
			quartoExtensionsLog.appendLine(message);
			vscode.window.showErrorMessage(message);
			return;
		}

		const groupedExtensions: ExtensionQuickPickItem[] = [
			{
				label: "Recently Installed",
				kind: vscode.QuickPickItemKind.Separator,
			},
			...createExtensionItems(recentlyInstalled),
			{
				label: "All Extensions",
				kind: vscode.QuickPickItemKind.Separator,
			},
			...createExtensionItems(extensionsList).sort((a, b) => a.label.localeCompare(b.label)),
		];

		const quickPick = vscode.window.createQuickPick<ExtensionQuickPickItem>();
		quickPick.items = groupedExtensions;
		quickPick.placeholder = "Select Quarto extensions to install";
		quickPick.canSelectMany = true;
		quickPick.matchOnDescription = true;
		quickPick.onDidTriggerItemButton((e) => {
			const url = e.item.url;
			if (url) {
				vscode.env.openExternal(vscode.Uri.parse(url));
			}
		});

		quickPick.onDidAccept(async () => {
			const selectedExtensions = quickPick.selectedItems;
			if (selectedExtensions.length > 0) {
				await installExtensions(selectedExtensions);

				const selectedDescriptions = selectedExtensions.map((ext) => ext.description);
				let updatedRecentlyInstalled = [
					...selectedDescriptions,
					...recentlyInstalled.filter((ext) => !selectedDescriptions.includes(ext)),
				];
				await context.globalState.update(RECENTLY_INSTALLED_QUARTO_EXTENSIONS, updatedRecentlyInstalled.slice(0, 5));
			}
			quickPick.hide();
		});

		quickPick.show();
	});

	context.subscriptions.push(disposable);
}

async function fetchCSVFromURL(url: string): Promise<string> {
	return new Promise((resolve, reject) => {
		https
			.get(url, (res: IncomingMessage) => {
				let data = "";
				res.on("data", (chunk) => {
					data += chunk;
				});
				res.on("end", () => {
					resolve(data);
				});
			})
			.on("error", (err) => {
				reject(err);
			});
	});
}

async function checkQuartoVersion(): Promise<boolean> {
	return new Promise((resolve) => {
		exec("quarto --version;", (error, stdout, stderr) => {
			if (error || stderr) {
				resolve(false);
			} else {
				resolve(stdout.trim().length > 0);
			}
		});
	});
}

async function installQuartoExtension(extension: string): Promise<boolean> {
	quartoExtensionsLog.appendLine(`\n\nInstalling ${extension} ...`);
	return new Promise((resolve) => {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
		const command = `quarto add ${extension} --no-prompt`;
		exec(command, { cwd: workspaceFolder }, (error, stdout, stderr) => {
			if (stderr) {
				quartoExtensionsLog.appendLine(`${stderr}`);
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

async function installExtensions(selectedExtensions: readonly ExtensionQuickPickItem[]) {
	const mutableSelectedExtensions: ExtensionQuickPickItem[] = [...selectedExtensions];

	const isQuartoAvailable = await checkQuartoVersion();
	if (!isQuartoAvailable) {
		const message =
			"Quarto is not installed or not available in PATH. Please install Quarto and make sure it is available in PATH.";
		quartoExtensionsLog.appendLine(message);
		vscode.window.showErrorMessage(message);
		return;
	}

	const trustAuthors = await vscode.window.showQuickPick(["Yes", "No"], {
		placeHolder: "Do you trust the authors of the selected extension(s)?",
	});
	if (trustAuthors !== "Yes") {
		const message = "Operation cancelled because the authors are not trusted.";
		quartoExtensionsLog.appendLine(message);
		vscode.window.showInformationMessage(message);
		return;
	}

	const installWorkspace = await vscode.window.showQuickPick(["Yes", "No"], {
		placeHolder: "Do you want to install the selected extension(s)?",
	});
	if (installWorkspace !== "Yes") {
		const message = "Operation cancelled by the user.";
		quartoExtensionsLog.appendLine(message);
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
				quartoExtensionsLog.appendLine(message);
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
				const success = await installQuartoExtension(selectedExtension.description);
				if (success) {
					installedExtensions.push(selectedExtension.description);
				} else {
					failedExtensions.push(selectedExtension.description);
				}

				installedCount++;
			}

			if (installedExtensions.length > 0) {
				quartoExtensionsLog.appendLine(`\n\nSuccessfully installed extensions:`);
				installedExtensions.forEach((ext) => {
					quartoExtensionsLog.appendLine(` - ${ext}`);
				});
			}

			if (failedExtensions.length > 0) {
				quartoExtensionsLog.appendLine(`\n\nFailed to install extensions:`);
				failedExtensions.forEach((ext) => {
					quartoExtensionsLog.appendLine(` - ${ext}`);
				});
				const message =
					"The following extensions were not installed, try installing them manually with `quarto add <extension>`:";
				vscode.window.showErrorMessage(
					`${message} ${failedExtensions.join(", ")}. See [details](command:quartoExtensions.showOutput).`
				);
			} else {
				const message = `All selected extensions (${installedCount}) were installed successfully.`;
				quartoExtensionsLog.appendLine(message);
				vscode.window.showInformationMessage(`${message} See [details](command:quartoExtensions.showOutput).`);
			}
		}
	);
}

function checkInternetConnection(): Promise<boolean> {
	return new Promise((resolve) => {
		dns.lookup("github.com", (err) => {
			if (err && err.code === "ENOTFOUND") {
				resolve(false);
			} else {
				resolve(true);
			}
		});
	});
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

function createExtensionItems(extensions: string[]): ExtensionQuickPickItem[] {
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

export function deactivate() {}
