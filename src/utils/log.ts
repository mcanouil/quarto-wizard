import * as vscode from "vscode";
import { debounce } from "lodash";
import { QW_LOG } from "../constants";

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

const LOG_LEVELS: LogLevel[] = ["error", "warn", "info", "debug"];
let cachedLogLevel: LogLevel | undefined;
let cachedLogLevelTimestamp = 0;
/**
 * Time-to-live for the cached log level (milliseconds).
 *
 * The cache avoids reading VS Code configuration on every log call.
 * Explicit configuration changes are handled immediately via the
 * `onDidChangeConfiguration` listener in extension.ts, which calls
 * `resetLogLevelCache()`.  The TTL only governs the rare case of stale
 * reads between the configuration change event and the next log call.
 */
const LOG_LEVEL_CACHE_TTL_MS = 5000;

/**
 * Logs a message to the Quarto Wizard log output if the message type
 * is at or below the configured log level.
 *
 * The log level configuration is cached for 5 seconds to avoid reading
 * configuration on every call.
 *
 * @param {string} message - The message to log.
 * @param {LogLevel} [level="info"] - The log level for this message.
 */
export function logMessage(message: string, level: LogLevel = "info"): void {
	const now = Date.now();
	if (!cachedLogLevel || now - cachedLogLevelTimestamp > LOG_LEVEL_CACHE_TTL_MS) {
		const config = vscode.workspace.getConfiguration("quartoWizard.log", null);
		cachedLogLevel = (config.get<string>("level") as LogLevel) ?? "info";
		cachedLogLevelTimestamp = now;
	}

	if (LOG_LEVELS.indexOf(level) <= LOG_LEVELS.indexOf(cachedLogLevel)) {
		QW_LOG.appendLine(message);
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

/**
 * Resets the cached log level so the next logMessage call re-reads configuration.
 *
 * @internal Exported for use in tests only.
 */
export function resetLogLevelCache(): void {
	cachedLogLevel = undefined;
	cachedLogLevelTimestamp = 0;
}
