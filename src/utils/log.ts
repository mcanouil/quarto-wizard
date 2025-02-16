import { QW_LOG } from "../constants";

export function showLogsCommand(): string {
	return "[Show logs](command:quartoWizard.showOutput)";
}

export function logMessage(message: string): void {
	QW_LOG.appendLine(message);
}
