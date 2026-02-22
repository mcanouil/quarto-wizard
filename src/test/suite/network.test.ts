import * as assert from "assert";
import * as vscode from "vscode";
import { checkInternetConnection } from "../../utils/network";
import * as constants from "../../constants";

interface MockLogOutputChannel {
	info: (message: string) => void;
	warn: (message: string) => void;
	error: (message: string) => void;
	debug: (message: string) => void;
}

suite("Network Utils Test Suite", () => {
	let originalFetch: typeof globalThis.fetch;
	let originalShowErrorMessage: typeof vscode.window.showErrorMessage;
	let originalQwLog: MockLogOutputChannel;
	let logMessages: string[];
	let errorMessages: string[];

	setup(() => {
		// Store original methods
		originalFetch = globalThis.fetch;
		originalShowErrorMessage = vscode.window.showErrorMessage;

		// Reset test state
		logMessages = [];
		errorMessages = [];

		// Mock vscode.window.showErrorMessage
		vscode.window.showErrorMessage = async (message: string) => {
			errorMessages.push(message);
			return undefined;
		};

		// Mock QW_LOG from constants using LogOutputChannel methods
		originalQwLog = (constants as { QW_LOG: MockLogOutputChannel }).QW_LOG;
		(constants as { QW_LOG: MockLogOutputChannel }).QW_LOG = {
			info: (message: string) => {
				logMessages.push(message);
			},
			warn: (message: string) => {
				logMessages.push(message);
			},
			error: (message: string) => {
				logMessages.push(message);
			},
			debug: (message: string) => {
				logMessages.push(message);
			},
		};
	});

	teardown(() => {
		// Restore original methods
		globalThis.fetch = originalFetch;
		vscode.window.showErrorMessage = originalShowErrorMessage;

		// Restore QW_LOG
		(constants as { QW_LOG: MockLogOutputChannel }).QW_LOG = originalQwLog;
	});

	test("should return true when internet connection is available", async () => {
		// Mock successful fetch response
		globalThis.fetch = async (): Promise<Response> =>
			({
				ok: true,
				status: 200,
			}) as Response;

		const result = await checkInternetConnection();

		assert.strictEqual(result, true);
		assert.strictEqual(logMessages.length, 0);
		assert.strictEqual(errorMessages.length, 0);
	});

	test("should return false when fetch response is not ok", async () => {
		// Mock failed fetch response
		globalThis.fetch = async (): Promise<Response> =>
			({
				ok: false,
				status: 404,
			}) as Response;

		const result = await checkInternetConnection();

		assert.strictEqual(result, false);
		assert.strictEqual(logMessages.length, 1);
		assert.ok(logMessages[0].includes("No internet connection"));
		assert.ok(logMessages[0].includes("HTTP 404"));
		assert.strictEqual(errorMessages.length, 1);
		assert.ok(errorMessages[0].includes("No internet connection"));
		assert.ok(errorMessages[0].includes("HTTP 404"));
	});

	test("should return false when fetch throws an error", async () => {
		// Mock fetch that throws an error
		globalThis.fetch = async (): Promise<Response> => {
			throw new Error("Network error");
		};

		const result = await checkInternetConnection();

		assert.strictEqual(result, false);
		assert.strictEqual(logMessages.length, 1);
		assert.ok(logMessages[0].includes("Network check failed"));
		assert.strictEqual(errorMessages.length, 1);
		assert.ok(errorMessages[0].includes("Network check failed"));
	});

	test("should use custom URL when provided", async () => {
		let fetchedUrl = "";

		// Mock fetch to capture the URL
		globalThis.fetch = async (url: RequestInfo | URL): Promise<Response> => {
			fetchedUrl = url.toString();
			return {
				ok: true,
				status: 200,
			} as Response;
		};

		const customUrl = "https://example.com/";
		const result = await checkInternetConnection(customUrl);

		assert.strictEqual(result, true);
		assert.strictEqual(fetchedUrl, customUrl);
	});

	test("should use default GitHub URL when no URL provided", async () => {
		let fetchedUrl = "";

		// Mock fetch to capture the URL
		globalThis.fetch = async (url: RequestInfo | URL): Promise<Response> => {
			fetchedUrl = url.toString();
			return {
				ok: true,
				status: 200,
			} as Response;
		};

		const result = await checkInternetConnection();

		assert.strictEqual(result, true);
		assert.strictEqual(fetchedUrl, "https://github.com/");
	});

	test("should handle timeout errors gracefully", async () => {
		// Mock fetch that simulates timeout
		globalThis.fetch = async (): Promise<Response> => {
			throw new Error("Request timeout");
		};

		const result = await checkInternetConnection();

		assert.strictEqual(result, false);
		assert.strictEqual(logMessages.length, 1);
		assert.ok(logMessages[0].includes("No internet connection"));
		assert.strictEqual(errorMessages.length, 1);
	});

	test("should log error message on failed fetch", async () => {
		globalThis.fetch = async (): Promise<Response> =>
			({
				ok: false,
				status: 500,
			}) as Response;

		const result = await checkInternetConnection();

		assert.strictEqual(result, false);
		assert.strictEqual(logMessages.length, 1);
		assert.ok(logMessages[0].includes("No internet connection"));
	});

	test("should log error message on network exception", async () => {
		globalThis.fetch = async (): Promise<Response> => {
			throw new Error("Network error");
		};

		const result = await checkInternetConnection();

		assert.strictEqual(result, false);
		assert.strictEqual(logMessages.length, 1);
	});

	test("should handle different HTTP status codes", async () => {
		const statusCodes = [404, 500, 503, 403];

		for (const statusCode of statusCodes) {
			// Reset state
			logMessages.length = 0;
			errorMessages.length = 0;

			globalThis.fetch = async (): Promise<Response> =>
				({
					ok: false,
					status: statusCode,
				}) as Response;

			const result = await checkInternetConnection();

			assert.strictEqual(result, false, `Should return false for status ${statusCode}`);
			assert.strictEqual(logMessages.length, 1, `Should log error for status ${statusCode}`);
			assert.strictEqual(errorMessages.length, 1, `Should show error message for status ${statusCode}`);
		}
	});

	test("should handle successful responses with different status codes", async () => {
		const successStatusCodes = [200, 201, 204];

		for (const statusCode of successStatusCodes) {
			// Reset state
			logMessages.length = 0;
			errorMessages.length = 0;

			globalThis.fetch = async (): Promise<Response> =>
				({
					ok: true,
					status: statusCode,
				}) as Response;

			const result = await checkInternetConnection();

			assert.strictEqual(result, true, `Should return true for status ${statusCode}`);
			assert.strictEqual(logMessages.length, 0, `Should not log for successful status ${statusCode}`);
			assert.strictEqual(errorMessages.length, 0, `Should not show error for successful status ${statusCode}`);
		}
	});
});
