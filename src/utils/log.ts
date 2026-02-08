import { QW_LOG } from "../constants";
import { debounce } from "./debounce";

/**
 * Returns a command string to show the logs.
 *
 * @returns {string} The command string to show the logs.
 */
export function getShowLogsLink(): string {
	return "[Show logs](command:quartoWizard.showOutput)";
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
