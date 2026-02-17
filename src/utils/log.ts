import * as vscode from "vscode";
import { QW_LOG } from "../constants";
import { debounce } from "./debounce";

/**
 * Returns a markdown command link to show the logs.
 *
 * Only useful in contexts that render markdown (e.g., withProgress titles).
 * For notification messages, use {@link showMessageWithLogs} instead.
 *
 * @returns {string} The markdown command link string.
 */
export function getShowLogsLink(): string {
	return "[Show logs](command:quartoWizard.showOutput)";
}

/** Label for the "Show Logs" action button. */
const SHOW_LOGS_LABEL = "Show Logs";

/**
 * Show a VS Code notification with an optional "Show Logs" action button.
 *
 * VS Code notification messages do not render markdown, so this replaces
 * the pattern of appending {@link getShowLogsLink} to message strings.
 *
 * @param message - The message to display.
 * @param level - Notification level: "info", "warning", or "error".
 */
export async function showMessageWithLogs(
	message: string,
	level: "info" | "warning" | "error" = "info",
): Promise<void> {
	let action: string | undefined;
	switch (level) {
		case "error":
			action = await vscode.window.showErrorMessage(message, SHOW_LOGS_LABEL);
			break;
		case "warning":
			action = await vscode.window.showWarningMessage(message, SHOW_LOGS_LABEL);
			break;
		case "info":
		default:
			action = await vscode.window.showInformationMessage(message, SHOW_LOGS_LABEL);
			break;
	}
	if (action === SHOW_LOGS_LABEL) {
		QW_LOG.show();
	}
}

/**
 * Valid log levels in order of severity (most to least severe).
 */
export type LogLevel = "error" | "warn" | "info" | "debug";

/**
 * Logs a message to the Quarto Wizard log output using the native
 * LogOutputChannel methods.  Level filtering is handled automatically
 * by VS Code (configurable via "Developer: Set Log Level").
 *
 * @param {string} message - The message to log.
 * @param {LogLevel} [level="info"] - The log level for this message.
 */
export function logMessage(message: string, level: LogLevel = "info"): void {
	switch (level) {
		case "error":
			QW_LOG.error(message);
			break;
		case "warn":
			QW_LOG.warn(message);
			break;
		case "debug":
			QW_LOG.debug(message);
			break;
		case "info":
		default:
			QW_LOG.info(message);
			break;
	}
}

/**
 * Debounced version of logMessage that limits how frequently messages are logged.
 * Waits 1000ms before logging the message to prevent excessive logging.
 *
 * @param {string} message - The message to log.
 * @param {LogLevel} [level="info"] - The log level for this message.
 */
export const logMessageDebounced = debounce(logMessage, 1000);
