import * as vscode from "vscode";
import { QW_LOG } from "../constants";

export function showLogsCommand(): string {
	return "[Show logs](command:quartoWizard.showOutput)";
}

export function logMessage(message: string, type: string = "info"): void {
	const levels = ["error", "warn", "info", "debug"];
	const config = vscode.workspace.getConfiguration("quartoWizard.log", null);
	const logLevel = config.get<string>("level") ?? "info";

	if (levels.indexOf(type) <= levels.indexOf(logLevel)) {
		QW_LOG.appendLine(message);
	}
}
