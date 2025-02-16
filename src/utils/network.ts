import * as vscode from "vscode";
import { QW_LOG } from "../constants";
import { showLogsCommand } from "./log";

export async function checkInternetConnection(url: string = "https://github.com/"): Promise<boolean> {
	try {
		const response: Response = await fetch(url);
		if (response.ok) {
			return true;
		} else {
			const message = `No internet connection. Please check your network settings.`;
			QW_LOG.appendLine(message);
			vscode.window.showErrorMessage(`${message} ${showLogsCommand()}.`);
			return false;
		}
	} catch (error) {
		const message = `No internet connection. Please check your network settings.`;
		QW_LOG.appendLine(message);
		vscode.window.showErrorMessage(`${message} ${showLogsCommand()}.`);
		return false;
	}
}
