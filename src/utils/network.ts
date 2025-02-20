import * as vscode from "vscode";
import { showLogsCommand, logMessage } from "./log";

/**
 * Checks if there is an active internet connection by attempting to fetch a URL.
 *
 * @param {string} [url="https://github.com/"] - The URL to check the internet connection against.
 * @returns {Promise<boolean>} - A promise that resolves to true if the internet connection is active, otherwise false.
 */
export async function checkInternetConnection(url = "https://github.com/"): Promise<boolean> {
	try {
		const response: Response = await fetch(url);
		if (response.ok) {
			return true;
		} else {
			const message = `No internet connection. Please check your network settings.`;
			logMessage(message, "error");
			vscode.window.showErrorMessage(`${message} ${showLogsCommand()}.`);
			return false;
		}
	} catch {
		const message = `No internet connection. Please check your network settings.`;
		logMessage(message, "error");
		vscode.window.showErrorMessage(`${message} ${showLogsCommand()}.`);
		return false;
	}
}
