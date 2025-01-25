import * as vscode from "vscode";
import { showLogsCommand } from "./log";

export async function checkInternetConnection(
	url: string = "https://github.com/",
	log: vscode.OutputChannel
): Promise<boolean> {
	try {
		const response = await fetch(url);
		if (response.ok) {
			return true;
		} else {
			const message = `No internet connection. Please check your network settings. ${showLogsCommand()}.`;
			log.appendLine(message);
			vscode.window.showErrorMessage(message);
			return false;
		}
	} catch (error) {
		const message = `No internet connection. Please check your network settings. ${showLogsCommand()}.`;
		log.appendLine(message);
		vscode.window.showErrorMessage(message);
		return false;
	}
}
