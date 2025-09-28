import * as vscode from "vscode";
import { showLogsCommand, logMessage } from "./log";

/**
 * Checks if there is an active internet connection by attempting to fetch a URL.
 *
 * @param {string} [url="https://github.com/"] - The URL to check the internet connection against.
 * @param {number} timeoutMs - Timeout in milliseconds (default: 5000ms).
 * @returns {Promise<boolean>} - A promise that resolves to true if the internet connection is active, otherwise false.
 */
export async function checkInternetConnection(url = "https://github.com/", timeoutMs = 5000): Promise<boolean> {
	try {
		// Create AbortController for timeout handling
		const controller = new AbortController();
		const timeoutId = setTimeout(() => {
			controller.abort();
		}, timeoutMs);

		const response: Response = await fetch(url, {
			signal: controller.signal,
		});

		clearTimeout(timeoutId);

		if (response.ok) {
			return true;
		} else {
			const message = `No internet connection. Please check your network settings.`;
			logMessage(message, "error");
			vscode.window.showErrorMessage(`${message} ${showLogsCommand()}.`);
			return false;
		}
	} catch (error) {
		let message = `No internet connection. Please check your network settings.`;
		if (error instanceof Error && error.name === 'AbortError') {
			message = `Network connection check timed out after ${timeoutMs}ms. Please check your network settings.`;
		}
		logMessage(message, "error");
		vscode.window.showErrorMessage(`${message} ${showLogsCommand()}.`);
		return false;
	}
}
