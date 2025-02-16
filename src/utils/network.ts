import * as vscode from "vscode";
import { showLogsCommand, logMessage } from "./log";

export async function checkInternetConnection(url: string = "https://github.com/"): Promise<boolean> {
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
	} catch (error) {
		const message = `No internet connection. Please check your network settings.`;
		logMessage(message, "error");
		vscode.window.showErrorMessage(`${message} ${showLogsCommand()}.`);
		return false;
	}
}
