import * as assert from "assert";
import { getShowLogsLink, logMessage, logMessageDebounced, type LogLevel } from "../../utils/log";
import * as constants from "../../constants";

interface MockLogOutputChannel {
	info: (message: string) => void;
	warn: (message: string) => void;
	error: (message: string) => void;
	debug: (message: string) => void;
}

suite("Log Utils Test Suite", () => {
	let originalQwLog: MockLogOutputChannel;
	let loggedMessages: { level: string; message: string }[];

	setup(() => {
		loggedMessages = [];

		// Mock QW_LOG from constants with LogOutputChannel-style methods
		originalQwLog = (constants as { QW_LOG: MockLogOutputChannel }).QW_LOG;
		(constants as { QW_LOG: MockLogOutputChannel }).QW_LOG = {
			info: (message: string) => {
				loggedMessages.push({ level: "info", message });
			},
			warn: (message: string) => {
				loggedMessages.push({ level: "warn", message });
			},
			error: (message: string) => {
				loggedMessages.push({ level: "error", message });
			},
			debug: (message: string) => {
				loggedMessages.push({ level: "debug", message });
			},
		};
	});

	teardown(() => {
		// Restore QW_LOG
		(constants as { QW_LOG: MockLogOutputChannel }).QW_LOG = originalQwLog;
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
		test("should log info message using native info method", () => {
			logMessage("Test message", "info");

			assert.strictEqual(loggedMessages.length, 1);
			assert.strictEqual(loggedMessages[0].level, "info");
			assert.strictEqual(loggedMessages[0].message, "Test message");
		});

		test("should log error message using native error method", () => {
			logMessage("Error message", "error");

			assert.strictEqual(loggedMessages.length, 1);
			assert.strictEqual(loggedMessages[0].level, "error");
			assert.strictEqual(loggedMessages[0].message, "Error message");
		});

		test("should log warn message using native warn method", () => {
			logMessage("Warning message", "warn");

			assert.strictEqual(loggedMessages.length, 1);
			assert.strictEqual(loggedMessages[0].level, "warn");
			assert.strictEqual(loggedMessages[0].message, "Warning message");
		});

		test("should log debug message using native debug method", () => {
			logMessage("Debug message", "debug");

			assert.strictEqual(loggedMessages.length, 1);
			assert.strictEqual(loggedMessages[0].level, "debug");
			assert.strictEqual(loggedMessages[0].message, "Debug message");
		});

		test("should use default message type 'info' when not specified", () => {
			logMessage("Test message");

			assert.strictEqual(loggedMessages.length, 1);
			assert.strictEqual(loggedMessages[0].level, "info");
			assert.strictEqual(loggedMessages[0].message, "Test message");
		});

		test("should handle unknown message types by falling through to info", () => {
			logMessage("Test message", "unknown" as LogLevel);

			assert.strictEqual(loggedMessages.length, 1);
			assert.strictEqual(loggedMessages[0].level, "info");
			assert.strictEqual(loggedMessages[0].message, "Test message");
		});

		test("should route each log level to its native method", () => {
			logMessage("Error message", "error");
			logMessage("Warning message", "warn");
			logMessage("Info message", "info");
			logMessage("Debug message", "debug");

			assert.strictEqual(loggedMessages.length, 4);
			assert.strictEqual(loggedMessages[0].level, "error");
			assert.strictEqual(loggedMessages[1].level, "warn");
			assert.strictEqual(loggedMessages[2].level, "info");
			assert.strictEqual(loggedMessages[3].level, "debug");
		});

		test("should handle empty messages", () => {
			logMessage("", "info");

			assert.strictEqual(loggedMessages.length, 1);
			assert.strictEqual(loggedMessages[0].message, "");
		});

		test("should handle multiline messages", () => {
			const multilineMessage = "Line 1\nLine 2\nLine 3";

			logMessage(multilineMessage, "info");

			assert.strictEqual(loggedMessages.length, 1);
			assert.strictEqual(loggedMessages[0].message, multilineMessage);
		});
	});

	suite("logMessageDebounced", () => {
		test("should be a function", () => {
			assert.ok(typeof logMessageDebounced === "function");
		});

		test("should delay logging when called multiple times rapidly", (done) => {
			// Call the debounced function multiple times
			logMessageDebounced("Message 1", "info");
			logMessageDebounced("Message 2", "info");
			logMessageDebounced("Message 3", "info");

			// Should not log immediately
			assert.strictEqual(loggedMessages.length, 0);

			// Wait for debounce delay (1000ms + buffer)
			setTimeout(() => {
				// Should only log the last message after debounce
				assert.strictEqual(loggedMessages.length, 1);
				assert.strictEqual(loggedMessages[0].message, "Message 3");
				done();
			}, 1100);
		});

		test("should have access to cancel and flush methods", () => {
			assert.ok(typeof logMessageDebounced.cancel === "function");
			assert.ok(typeof logMessageDebounced.flush === "function");
		});

		test("should flush immediately when flush is called", () => {
			logMessageDebounced("Flush test message", "info");

			// Should not log immediately
			assert.strictEqual(loggedMessages.length, 0);

			// Flush should execute immediately
			logMessageDebounced.flush();

			assert.strictEqual(loggedMessages.length, 1);
			assert.strictEqual(loggedMessages[0].message, "Flush test message");
		});

		test("should cancel pending execution when cancel is called", (done) => {
			logMessageDebounced("Cancel test message", "info");

			// Cancel the pending execution
			logMessageDebounced.cancel();

			// Wait beyond debounce delay
			setTimeout(() => {
				// Should not have logged anything
				assert.strictEqual(loggedMessages.length, 0);
				done();
			}, 1100);
		});
	});
});
