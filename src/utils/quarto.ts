import * as vscode from "vscode";
import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { logMessage, showLogsCommand } from "./log";
import { findModifiedExtensions, getMtimeExtensions, removeExtension } from "./extensions";

// Cache the Quarto path to avoid repeated configuration lookups
let cachedQuartoPath: string | undefined;

/**
 * Detects if the extension is running in Positron IDE.
 *
 * @returns {boolean} - True if running in Positron, false otherwise.
 */
function isPositronIDE(): boolean {
	// Check vscode.env.appName (Positron uses "Positron")
	if (vscode.env.appName.toLowerCase().includes("positron")) {
		return true;
	}
	// Check POSITRON environment variable (set to "1" in Positron)
	return process.env.POSITRON === "1";
}

/**
 * Gets IDE-specific hints for configuring Quarto CLI path.
 *
 * @returns {string} - A hint message specific to the detected IDE.
 */
function getQuartoPathHint(): string {
	if (isPositronIDE()) {
		const isWindows = process.platform === "win32";
		const command = isWindows ? "Get-Command quarto" : "which quarto";
		return `Positron bundles Quarto CLI. Find the path using '${command}' in the Positron terminal, then set it in settings.`;
	}
	return "";
}

/**
 * Retrieves the Quarto path from the configuration.
 * Falls back through multiple configuration sources in order of preference:
 * 1. quartoWizard.quarto.path (extension-specific setting)
 * 2. quarto.path (general Quarto extension setting)
 * 3. "quarto" (system PATH)
 *
 * @returns {string} - The Quarto path.
 */
export function getQuartoPath(): string {
	if (cachedQuartoPath) {
		return cachedQuartoPath;
	}
	const config = vscode.workspace.getConfiguration("quartoWizard.quarto");
	let quartoPath = config.get<string>("path");

	// Try fallback to general Quarto extension configuration
	if (!quartoPath || quartoPath === "") {
		const fallbackConfig = vscode.workspace.getConfiguration("quarto");
		quartoPath = fallbackConfig.get<string>("path");
	}

	// Final fallback to system PATH
	if (!quartoPath || quartoPath === "") {
		quartoPath = "quarto";
	}

	cachedQuartoPath = quartoPath || "quarto";
	return cachedQuartoPath;
}

// Clear cached path when configuration changes and re-validate
vscode.workspace.onDidChangeConfiguration(async (e) => {
	if (e.affectsConfiguration("quartoWizard.quarto.path") || e.affectsConfiguration("quarto.path")) {
		cachedQuartoPath = undefined;
		await checkQuartoPath(getQuartoPath());
	}
});

/**
 * Checks if the Quarto path is valid and updates the cached path if necessary.
 * Throws an error if the path is invalid.
 *
 * @param {string | undefined} quartoPath - The Quarto path to check.
 * @throws {Error} - Throws an error if the Quarto path is invalid.
 * @returns {Promise<void>} - A promise that resolves if the Quarto path is valid.
 */
export async function checkQuartoPath(quartoPath: string | undefined): Promise<void> {
	if (!quartoPath) {
		const message = "Quarto CLI path is not configured.";
		logMessage(message, "error");

		const hint = getQuartoPathHint();
		if (hint) {
			logMessage(hint, "info");
		}

		const errorMessage = hint
			? `${message} Please install Quarto or configure the path in settings. ${hint} ${showLogsCommand()}.`
			: `${message} Please install Quarto or configure the path in settings. ${showLogsCommand()}.`;

		vscode.window
			.showErrorMessage(errorMessage, "Install Quarto", "Open Settings")
			.then((selection) => {
				if (selection === "Install Quarto") {
					vscode.env.openExternal(vscode.Uri.parse("https://quarto.org/docs/get-started/"));
				} else if (selection === "Open Settings") {
					vscode.commands.executeCommand("workbench.action.openSettings", "quartoWizard.quarto.path");
				}
			});
		throw new Error(message);
	}

	const versionCheckResult = await checkQuartoVersion(quartoPath);
	if (!versionCheckResult) {
		const message = `Quarto CLI not found at path: '${quartoPath}'.`;
		logMessage(message, "error");

		const isDefaultPath = quartoPath === "quarto";
		const helpMessage = isDefaultPath
			? "Quarto CLI is not installed or not in your system PATH."
			: "The configured path does not point to a valid Quarto CLI executable.";

		logMessage(helpMessage, "error");

		const hint = getQuartoPathHint();
		if (hint) {
			logMessage(hint, "info");
		}

		const errorMessage = hint
			? `${message} ${helpMessage} ${hint} ${showLogsCommand()}.`
			: `${message} ${helpMessage} ${showLogsCommand()}.`;

		vscode.window
			.showErrorMessage(errorMessage, "Install Quarto", "Open Settings", "View Logs")
			.then((selection) => {
				if (selection === "Install Quarto") {
					vscode.env.openExternal(vscode.Uri.parse("https://quarto.org/docs/get-started/"));
				} else if (selection === "Open Settings") {
					vscode.commands.executeCommand("workbench.action.openSettings", "quartoWizard.quarto.path");
				} else if (selection === "View Logs") {
					vscode.commands.executeCommand("quartoWizard.showOutput");
				}
			});
		throw new Error(message);
	}
}

/**
 * Checks if the Quarto version is valid by executing the version command.
 *
 * @param {string | undefined} quartoPath - The Quarto path to check the version for.
 * @param {number} timeoutMs - Timeout in milliseconds (default: 10000ms).
 * @returns {Promise<boolean>} - A promise that resolves to true if the Quarto version is valid, otherwise false.
 */
export async function checkQuartoVersion(quartoPath: string | undefined, timeoutMs = 10000): Promise<boolean> {
	return new Promise((resolve) => {
		if (!quartoPath) {
			resolve(false);
			return;
		}

		const process = spawn(quartoPath, ["--version"], {
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		let isResolved = false;

		// Set up timeout
		const timeout = setTimeout(() => {
			if (!isResolved) {
				isResolved = true;
				logMessage(`Quarto version check timed out after ${timeoutMs}ms`, "error");
				process.kill("SIGTERM");
				resolve(false);
			}
		}, timeoutMs);

		const cleanup = () => {
			clearTimeout(timeout);
		};

		process.stdout?.on("data", (data) => {
			stdout += data.toString();
		});

		process.stderr?.on("data", (data) => {
			stderr += data.toString();
		});

		process.on("error", (error: NodeJS.ErrnoException) => {
			if (!isResolved) {
				isResolved = true;
				cleanup();

				if (error.code === "ENOENT") {
					logMessage(`Quarto executable not found at path: '${quartoPath}'`, "error");
					logMessage(`This typically means Quarto is not installed or not in PATH.`, "error");
				} else {
					logMessage(`Error checking Quarto version: ${error.message} (code: ${error.code})`, "error");
				}

				resolve(false);
			}
		});

		process.on("close", (code) => {
			if (!isResolved) {
				isResolved = true;
				cleanup();
				if (code !== 0 || stderr) {
					resolve(false);
				} else {
					resolve(stdout.trim().length > 0);
				}
			}
		});
	});
}

/**
 * Installs a Quarto extension.
 *
 * @param {string} extension - The name of the extension to install.
 * @param {string} workspaceFolder - The workspace folder path.
 * @param {number} timeoutMs - Timeout in milliseconds (default: 30000ms).
 * @returns {Promise<boolean>} - A promise that resolves to true if the extension is installed successfully, otherwise false.
 */
export async function installQuartoExtension(
	extension: string,
	workspaceFolder: string,
	timeoutMs = 30000
): Promise<boolean> {
	logMessage(`Installing ${extension} ...`, "info");

	if (!workspaceFolder) {
		return false;
	}

	const quartoPath = getQuartoPath();
	try {
		await checkQuartoPath(quartoPath);
	} catch {
		logMessage("Cannot install extension: Quarto CLI is not available.", "error");
		return false;
	}

	return new Promise((resolve) => {
		const process = spawn(quartoPath, ["add", extension, "--no-prompt"], {
			cwd: workspaceFolder,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = ""; // Collected for potential future use in success detection
		let stderr = "";
		let isResolved = false;

		// Set up timeout
		const timeout = setTimeout(() => {
			if (!isResolved) {
				isResolved = true;
				logMessage(`Extension installation timed out after ${timeoutMs}ms`, "error");
				process.kill("SIGTERM");
				resolve(false);
			}
		}, timeoutMs);

		const cleanup = () => {
			clearTimeout(timeout);
		};

		process.stdout?.on("data", (data) => {
			stdout += data.toString();
		});

		process.stderr?.on("data", (data) => {
			stderr += data.toString();
		});

		process.on("error", (error: NodeJS.ErrnoException) => {
			if (!isResolved) {
				isResolved = true;
				cleanup();

				if (error.code === "ENOENT") {
					logMessage(`Error installing extension: Quarto CLI not found at path '${quartoPath}'.`, "error");
					logMessage(`Please ensure Quarto is installed and the path is configured correctly.`, "error");
				} else {
					logMessage(`Error installing extension: ${error.message} (code: ${error.code})`, "error");
				}

				resolve(false);
			}
		});

		process.on("close", (code) => {
			if (!isResolved) {
				isResolved = true;
				cleanup();
				let isInstalled = false;

				if (code !== 0) {
					logMessage(`Error installing extension: Process exited with code ${code}`, "error");
					if (stderr) {
						logMessage(`${stderr}`, "error");
					}
				} else if (stderr) {
					// Quarto CLI often outputs success messages to stderr, so check for success indicators
					isInstalled = stderr.includes("Extension installation complete");
					if (!isInstalled) {
						logMessage(`${stderr}`, "error");
					}
				} else if (stdout.trim().length >= 0) {
					// No error and no stderr means successful installation
					// stdout is checked for future extensibility (currently always true)
					isInstalled = true;
				}

				if (isInstalled) {
					// Refresh the extensions tree view to show the newly installed extension
					vscode.commands.executeCommand("quartoWizard.extensionsInstalled.refresh");
					resolve(true);
				} else {
					resolve(false);
				}
			}
		});
	});
}

// Update _extension.yml file with source, i.e., GitHub username/repo
// This is needed for the extension to be updated in the future
// To be removed when Quarto supports source records in the _extension.yml file or elsewhere
// See https://github.com/quarto-dev/quarto-cli/issues/11468
/**
 * Updates the _extension.yml file with the source information for the installed extension.
 *
 * @param {string} extension - The name of the extension to install.
 * @param {string} workspaceFolder - The workspace folder path.
 * @returns {Promise<boolean>} - A promise that resolves to true if the extension source is updated successfully, otherwise false.
 */
export async function installQuartoExtensionSource(extension: string, workspaceFolder: string): Promise<boolean> {
	const extensionsDirectory = path.join(workspaceFolder, "_extensions");
	const existingExtensions = getMtimeExtensions(extensionsDirectory);

	const success = await installQuartoExtension(extension, workspaceFolder);

	const newExtension = findModifiedExtensions(existingExtensions, extensionsDirectory);
	const fileNames = ["_extension.yml", "_extension.yaml"];
	const filePath = fileNames
		.map((name) => path.join(extensionsDirectory, ...newExtension, name))
		.find((fullPath) => fs.existsSync(fullPath));
	if (filePath) {
		const fileContent = fs.readFileSync(filePath, "utf-8");
		const updatedContent = fileContent.includes("source: ")
			? fileContent // If "source: " already exists, do not modify it as it comes from "quarto add"
			: `${fileContent.trim()}\nsource: ${extension}`;
		fs.writeFileSync(filePath, updatedContent);
	}
	vscode.commands.executeCommand("quartoWizard.extensionsInstalled.refresh");
	return success;
}

/**
 * Removes a Quarto extension.
 *
 * @param {string} extension - The name of the extension to remove.
 * @param {string} workspaceFolder - The workspace folder path.
 * @returns {Promise<boolean>} - A promise that resolves to true if the extension is removed successfully, otherwise false.
 */
export async function removeQuartoExtension(extension: string, workspaceFolder: string): Promise<boolean> {
	logMessage(`Removing ${extension} ...`, "info");
	if (!workspaceFolder) {
		return false;
	}
	const status = await removeExtension(extension, path.join(workspaceFolder, "_extensions"));
	return status;
}
/** Quarto command to remove an extension.
 *
 * @param extension - The name of the extension to remove.
 * @param root - The root directory where the extension is located.
 * @returns {boolean} - Status (true for success, false for failure).
 *
 * @deprecated Use removeExtension from extensions.ts instead.
 */
// export async function removeExtension(extension: string, root: string): Promise<boolean> {
// 	return new Promise((resolve) => {
// 		const quartoPath = getQuartoPath();
// 		checkQuartoPath(quartoPath);
// 		const command = `${quartoPath} remove ${extension} --no-prompt`;
// 		exec(command, { cwd: root }, (error, stdout, stderr) => {
// 			if (stderr) {
// 				logMessage(`${stderr}`, "error");
// 				const isRemoved = stderr.includes("Extension removed");
// 				if (isRemoved) {
// 					resolve(true);
// 				} else {
// 					resolve(false);
// 					return;
// 				}
// 			}
// 			vscode.commands.executeCommand("quartoWizard.extensionsInstalled.refresh");
// 			resolve(true);
// 		});
// 	});
// }
