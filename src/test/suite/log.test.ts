import * as assert from "assert";
import * as vscode from "vscode";
import { getShowLogsLink, logMessage, logMessageDebounced, resetLogLevelCache, type LogLevel } from "../../utils/log";
import * as constants from "../../constants";

interface MockOutputChannel {
	appendLine: (message: string) => void;
}

suite("Log Utils Test Suite", () => {
	let originalGetConfiguration: typeof vscode.workspace.getConfiguration;
	let originalQwLog: MockOutputChannel;
	let mockConfig: {
		get<T>(key: string): T | undefined;
		update(key: string, value: unknown): Promise<void>;
		has(section: string): boolean;
		inspect(section: string): unknown;
	};
	let configValues: Record<string, unknown>;
	let logMessages: string[];

	setup(() => {
		// Store original methods
		originalGetConfiguration = vscode.workspace.getConfiguration;

		// Reset test state
		configValues = {};
		logMessages = [];

		// Mock configuration
		mockConfig = {
			get<T>(key: string): T | undefined {
				return configValues[key] as T;
			},
			async update(key: string, value: unknown): Promise<void> {
				configValues[key] = value;
			},
			has(section: string): boolean {
				return section in configValues;
			},
			inspect(section: string): unknown {
				return { key: section };
			},
		};

		vscode.workspace.getConfiguration = () => mockConfig as vscode.WorkspaceConfiguration;

		// Mock QW_LOG from constants
		originalQwLog = (constants as { QW_LOG: MockOutputChannel }).QW_LOG;
		(constants as { QW_LOG: MockOutputChannel }).QW_LOG = {
			appendLine: (message: string) => {
				logMessages.push(message);
			},
		};

		// Reset the log level cache so each test reads fresh config
		resetLogLevelCache();
	});

	teardown(() => {
		// Restore original methods
		vscode.workspace.getConfiguration = originalGetConfiguration;

		// Restore QW_LOG
		(constants as { QW_LOG: MockOutputChannel }).QW_LOG = originalQwLog;
	});

	suite("getShowLogsLink", () => {
		test("should return correct command string", () => {
			const result = getShowLogsLink();

			assert.strictEqual(result, "[Show logs](command:quartoWizard.showOutput)");
		});

		test("should return a string that contains the command link", () => {
			const result = getShowLogsLink();

			assert.ok(typeof result === "string");
			assert.ok(result.includes("command:quartoWizard.showOutput"));
			assert.ok(result.includes("Show logs"));
		});
	});

	suite("logMessage", () => {
		test("should log message when type is at configured log level", () => {
			configValues.level = "info";

			logMessage("Test message", "info");

			assert.strictEqual(logMessages.length, 1);
			assert.strictEqual(logMessages[0], "Test message");
		});

		test("should log message when type is below configured log level", () => {
			configValues.level = "debug";

			logMessage("Error message", "error");

			assert.strictEqual(logMessages.length, 1);
			assert.strictEqual(logMessages[0], "Error message");
		});

		test("should not log message when type is above configured log level", () => {
			configValues.level = "error";

			logMessage("Debug message", "debug");

			assert.strictEqual(logMessages.length, 0);
		});

		test("should use default log level 'info' when config is undefined", () => {
			configValues.level = undefined;

			logMessage("Test message", "info");

			assert.strictEqual(logMessages.length, 1);
			assert.strictEqual(logMessages[0], "Test message");
		});

		test("should use default message type 'info' when not specified", () => {
			configValues.level = "info";

			logMessage("Test message");

			assert.strictEqual(logMessages.length, 1);
			assert.strictEqual(logMessages[0], "Test message");
		});

		test("should handle all log levels correctly", () => {
			configValues.level = "debug";

			// All levels should be logged when log level is debug
			logMessage("Error message", "error");
			logMessage("Warning message", "warn");
			logMessage("Info message", "info");
			logMessage("Debug message", "debug");

			assert.strictEqual(logMessages.length, 4);
			assert.strictEqual(logMessages[0], "Error message");
			assert.strictEqual(logMessages[1], "Warning message");
			assert.strictEqual(logMessages[2], "Info message");
			assert.strictEqual(logMessages[3], "Debug message");
		});

		test("should respect error level filtering", () => {
			configValues.level = "error";

			logMessage("Error message", "error");
			logMessage("Warning message", "warn");
			logMessage("Info message", "info");
			logMessage("Debug message", "debug");

			// Only error should be logged
			assert.strictEqual(logMessages.length, 1);
			assert.strictEqual(logMessages[0], "Error message");
		});

		test("should respect warn level filtering", () => {
			configValues.level = "warn";

			logMessage("Error message", "error");
			logMessage("Warning message", "warn");
			logMessage("Info message", "info");
			logMessage("Debug message", "debug");

			// Only error and warn should be logged
			assert.strictEqual(logMessages.length, 2);
			assert.strictEqual(logMessages[0], "Error message");
			assert.strictEqual(logMessages[1], "Warning message");
		});

		test("should respect info level filtering", () => {
			configValues.level = "info";

			logMessage("Error message", "error");
			logMessage("Warning message", "warn");
			logMessage("Info message", "info");
			logMessage("Debug message", "debug");

			// Error, warn, and info should be logged
			assert.strictEqual(logMessages.length, 3);
			assert.strictEqual(logMessages[0], "Error message");
			assert.strictEqual(logMessages[1], "Warning message");
			assert.strictEqual(logMessages[2], "Info message");
		});

		test("should handle unknown log levels gracefully", () => {
			configValues.level = "unknown";

			logMessage("Test message", "info");

			// Should not log when level is unknown
			assert.strictEqual(logMessages.length, 0);
		});

		test("should handle unknown message types gracefully", () => {
			configValues.level = "info";

			logMessage("Test message", "unknown" as LogLevel);

			// Unknown message type has indexOf -1, which is <= any valid level index
			// So it will actually log the message (this is the current behaviour)
			assert.strictEqual(logMessages.length, 1);
			assert.strictEqual(logMessages[0], "Test message");
		});

		test("should handle empty messages", () => {
			configValues.level = "info";

			logMessage("", "info");

			assert.strictEqual(logMessages.length, 1);
			assert.strictEqual(logMessages[0], "");
		});

		test("should handle multiline messages", () => {
			configValues.level = "info";
			const multilineMessage = "Line 1\nLine 2\nLine 3";

			logMessage(multilineMessage, "info");

			assert.strictEqual(logMessages.length, 1);
			assert.strictEqual(logMessages[0], multilineMessage);
		});
	});

	suite("logMessageDebounced", () => {
		test("should be a function", () => {
			assert.ok(typeof logMessageDebounced === "function");
		});

		test("should delay logging when called multiple times rapidly", (done) => {
			configValues.level = "info";

			// Call the debounced function multiple times
			logMessageDebounced("Message 1", "info");
			logMessageDebounced("Message 2", "info");
			logMessageDebounced("Message 3", "info");

			// Should not log immediately
			assert.strictEqual(logMessages.length, 0);

			// Wait for debounce delay (1000ms + buffer)
			setTimeout(() => {
				// Should only log the last message after debounce
				assert.strictEqual(logMessages.length, 1);
				assert.strictEqual(logMessages[0], "Message 3");
				done();
			}, 1100);
		});

		test("should have access to cancel and flush methods", () => {
			assert.ok(typeof logMessageDebounced.cancel === "function");
			assert.ok(typeof logMessageDebounced.flush === "function");
		});

		test("should flush immediately when flush is called", () => {
			configValues.level = "info";

			logMessageDebounced("Flush test message", "info");

			// Should not log immediately
			assert.strictEqual(logMessages.length, 0);

			// Flush should execute immediately
			logMessageDebounced.flush();

			assert.strictEqual(logMessages.length, 1);
			assert.strictEqual(logMessages[0], "Flush test message");
		});

		test("should cancel pending execution when cancel is called", (done) => {
			configValues.level = "info";

			logMessageDebounced("Cancel test message", "info");

			// Cancel the pending execution
			logMessageDebounced.cancel();

			// Wait beyond debounce delay
			setTimeout(() => {
				// Should not have logged anything
				assert.strictEqual(logMessages.length, 0);
				done();
			}, 1100);
		});
	});
});
