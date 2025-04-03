import * as vscode from "vscode";
import { debounce } from "lodash";
import { QW_LOG } from "../constants";

/**
 * Returns a command string to show the logs.
 *
 * @returns {string} The command string to show the logs.
 */
export function showLogsCommand(): string {
	return "[Show logs](command:quartoWizard.showOutput)";
}

/**
 * Logs a message to the Quarto Wizard log output if the message type
 * is at or below the configured log level.
 *
 * @param {string} message - The message to log.
 * @param {string} [type="info"] - The type of log message (e.g., "error", "warn", "info", "debug").
 */
export function logMessage(message: string, type = "info"): void {
	const levels = ["error", "warn", "info", "debug"];
	const config = vscode.workspace.getConfiguration("quartoWizard.log", null);
	const logLevel = config.get<string>("level") ?? "info";

	if (levels.indexOf(type) <= levels.indexOf(logLevel)) {
		QW_LOG.appendLine(message);
	}
}

/**
 * Debounced version of logMessage that limits how frequently messages are logged.
 * Waits 1000ms before logging the message to prevent excessive logging.
 *
 * @param {string} message - The message to log.
 * @param {string} [type="info"] - The type of log message.
 */
export const debouncedLogMessage = debounce(logMessage, 1000);
