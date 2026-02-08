import * as assert from "assert";
import * as vscode from "vscode";
import { handleAuthError } from "../../utils/auth";
import * as constants from "../../constants";

interface MockLogOutputChannel {
	info: (message: string) => void;
	warn: (message: string) => void;
	error: (message: string) => void;
	debug: (message: string) => void;
}

suite("Auth Utils Test Suite", () => {
	let originalShowErrorMessage: typeof vscode.window.showErrorMessage;
	let originalGetSession: typeof vscode.authentication.getSession;
	let originalExecuteCommand: typeof vscode.commands.executeCommand;
	let originalQwLog: MockLogOutputChannel;

	let errorMessages: string[];
	let actionItems: string[][];
	let getSessionCalled: boolean;
	let getSessionScopes: string[];
	let getSessionOptions: Record<string, unknown> | undefined;
	let executedCommands: string[];
	let loggedMessages: string[];

	function installMocks(): void {
		errorMessages = [];
		actionItems = [];
		getSessionCalled = false;
		getSessionScopes = [];
		getSessionOptions = undefined;
		executedCommands = [];
		loggedMessages = [];

		// Mock showErrorMessage to capture calls and return undefined (no action taken).
		(vscode.window as { showErrorMessage: unknown }).showErrorMessage = async (
			message: string,
			...items: string[]
		): Promise<string | undefined> => {
			errorMessages.push(message);
			actionItems.push(items);
			return undefined;
		};

		// Mock authentication.getSession
		(vscode.authentication as { getSession: unknown }).getSession = async (
			_providerId: string,
			scopes: readonly string[],
			options?: Record<string, unknown>,
		) => {
			getSessionCalled = true;
			getSessionScopes = [...scopes];
			getSessionOptions = options;
			return undefined as unknown as vscode.AuthenticationSession;
		};

		// Mock commands.executeCommand
		(vscode.commands as { executeCommand: unknown }).executeCommand = async (command: string): Promise<void> => {
			executedCommands.push(command);
		};

		// Mock QW_LOG to capture logged messages using LogOutputChannel methods
		(constants as { QW_LOG: MockLogOutputChannel }).QW_LOG = {
			info: (message: string) => {
				loggedMessages.push(message);
			},
			warn: (message: string) => {
				loggedMessages.push(message);
			},
			error: (message: string) => {
				loggedMessages.push(message);
			},
			debug: (message: string) => {
				loggedMessages.push(message);
			},
		};
	}

	/** Override showErrorMessage so that clicking "Sign In" is simulated. */
	function mockSignInAction(): void {
		(vscode.window as { showErrorMessage: unknown }).showErrorMessage = async (
			message: string,
			...items: string[]
		): Promise<string | undefined> => {
			errorMessages.push(message);
			actionItems.push(items);
			return "Sign In";
		};
	}

	function restoreMocks(): void {
		vscode.window.showErrorMessage = originalShowErrorMessage;
		vscode.authentication.getSession = originalGetSession;
		vscode.commands.executeCommand = originalExecuteCommand;
		(constants as { QW_LOG: MockLogOutputChannel }).QW_LOG = originalQwLog;
	}

	setup(() => {
		originalShowErrorMessage = vscode.window.showErrorMessage;
		originalGetSession = vscode.authentication.getSession;
		originalExecuteCommand = vscode.commands.executeCommand;
		originalQwLog = (constants as { QW_LOG: MockLogOutputChannel }).QW_LOG;

		installMocks();
	});

	teardown(() => {
		restoreMocks();
	});

	suite("handleAuthError", () => {
		test("should show dialog for 401 status code", async () => {
			await handleAuthError("test", new Error("Request failed with status 401"));
			assert.strictEqual(errorMessages.length, 1);
			assert.deepStrictEqual(actionItems[0], ["Sign In", "Set Token"]);
		});

		test("should show dialog for 403 status code", async () => {
			await handleAuthError("test", new Error("Request failed with status 403"));
			assert.strictEqual(errorMessages.length, 1);
			assert.deepStrictEqual(actionItems[0], ["Sign In", "Set Token"]);
		});

		test("should show dialog for Unauthorized keyword", async () => {
			await handleAuthError("test", new Error("Unauthorized"));
			assert.strictEqual(errorMessages.length, 1);
			assert.deepStrictEqual(actionItems[0], ["Sign In", "Set Token"]);
		});

		test("should show dialog for Forbidden keyword", async () => {
			await handleAuthError("test", new Error("Forbidden"));
			assert.strictEqual(errorMessages.length, 1);
			assert.deepStrictEqual(actionItems[0], ["Sign In", "Set Token"]);
		});

		test("should show dialog for authentication failure messages", async () => {
			await handleAuthError("test", new Error("authentication failed"));
			assert.strictEqual(errorMessages.length, 1);
			assert.deepStrictEqual(actionItems[0], ["Sign In", "Set Token"]);
		});

		test("should show dialog for authentication required messages", async () => {
			await handleAuthError("test", new Error("authentication required"));
			assert.strictEqual(errorMessages.length, 1);
			assert.deepStrictEqual(actionItems[0], ["Sign In", "Set Token"]);
		});

		test("should show dialog for authentication expired messages", async () => {
			await handleAuthError("test", new Error("authentication token expired"));
			assert.strictEqual(errorMessages.length, 1);
			assert.deepStrictEqual(actionItems[0], ["Sign In", "Set Token"]);
		});

		test("should not show dialog for non-auth errors", async () => {
			await handleAuthError("test", new Error("Network timeout"));
			assert.strictEqual(errorMessages.length, 0);
		});

		test("should not show dialog for incidental authentication mentions", async () => {
			await handleAuthError("test", new Error("Failed to parse authentication configuration file"));
			assert.strictEqual(errorMessages.length, 0);
		});

		test("should not show dialog for generic authentication error messages", async () => {
			await handleAuthError("test", new Error("authentication configuration error"));
			assert.strictEqual(errorMessages.length, 0);
		});

		test("should not show dialog for distant authentication keyword matches", async () => {
			await handleAuthError("test", new Error("authentication module loaded, but a required dependency is missing"));
			assert.strictEqual(errorMessages.length, 0);
		});

		test("should show dialog for status code with colon separator", async () => {
			await handleAuthError("test", new Error("HTTP 401: Unauthorized"));
			assert.strictEqual(errorMessages.length, 1);
		});

		test("should show dialog for HTTP prefix without separator", async () => {
			await handleAuthError("test", new Error("HTTP 403"));
			assert.strictEqual(errorMessages.length, 1);
		});

		test("should show dialog for status code with comma separator", async () => {
			await handleAuthError("test", new Error("Got 401, Unauthorized"));
			assert.strictEqual(errorMessages.length, 1);
		});

		test("should show dialog for status code with hyphen separator", async () => {
			await handleAuthError("test", new Error("Error 403 - Forbidden"));
			assert.strictEqual(errorMessages.length, 1);
		});

		test("should show dialog for trailing Unauthorized after separator", async () => {
			await handleAuthError("test", new Error("Request failed: Unauthorized"));
			assert.strictEqual(errorMessages.length, 1);
		});

		test("should not show dialog for incidental Unauthorized usage", async () => {
			await handleAuthError("test", new Error("Unauthorized use of API key in sandbox mode"));
			assert.strictEqual(errorMessages.length, 0);
		});

		test("should not show dialog for trailing Forbidden after space", async () => {
			await handleAuthError("test", new Error("This operation is Forbidden"));
			assert.strictEqual(errorMessages.length, 0);
		});

		// Verifies that "Unauthorized" embedded in a sentence does not trigger auth
		// handling. The regex patterns only match standalone "Unauthorized" (the
		// entire trimmed message) or after a colon at the end of the string.
		test("should not show dialog for incidental Unauthorized after space", async () => {
			await handleAuthError("test", new Error("This request is Unauthorized"));
			assert.strictEqual(errorMessages.length, 0);
		});

		// Reverse-order authentication pattern tests
		test("should show dialog for reverse-order 'invalid authentication'", async () => {
			await handleAuthError("test", new Error("Request failed: invalid authentication"));
			assert.strictEqual(errorMessages.length, 1);
		});

		test("should show dialog for reverse-order 'denied authentication'", async () => {
			await handleAuthError("test", new Error("denied authentication for user"));
			assert.strictEqual(errorMessages.length, 1);
		});

		test("should show dialog for reverse-order 'expired authentication'", async () => {
			await handleAuthError("test", new Error("expired authentication token"));
			assert.strictEqual(errorMessages.length, 1);
		});

		test("should not show dialog for distant reverse-order authentication match", async () => {
			await handleAuthError("test", new Error("failure in the process of authentication"));
			assert.strictEqual(errorMessages.length, 0);
		});

		// Boundary tests for 10-character window
		test("should show dialog for authentication keyword at exactly 10 chars distance", async () => {
			// "authentication" + 10 chars + "failed" = boundary match
			await handleAuthError("test", new Error("authentication 12345678 failed"));
			assert.strictEqual(errorMessages.length, 1);
		});

		test("should not show dialog for authentication keyword beyond 10 chars distance", async () => {
			// "authentication" + 11 chars + "failed" = beyond boundary
			await handleAuthError("test", new Error("authentication 123456789 failed"));
			assert.strictEqual(errorMessages.length, 0);
		});

		// Status code narrowing tests (only 401 and 403 match, not other 4xx)
		test("should not show dialog for 404: Unauthorized (non-auth status code)", async () => {
			await handleAuthError("test", new Error("404: Unauthorized"));
			assert.strictEqual(errorMessages.length, 0);
		});

		test("should not show dialog for 429: Forbidden (non-auth status code)", async () => {
			await handleAuthError("test", new Error("429: Forbidden"));
			assert.strictEqual(errorMessages.length, 0);
		});

		test("should show dialog for 401: Unauthorized", async () => {
			await handleAuthError("test", new Error("401: Unauthorized"));
			assert.strictEqual(errorMessages.length, 1);
		});

		test("should show dialog for 403: Forbidden", async () => {
			await handleAuthError("test", new Error("403: Forbidden"));
			assert.strictEqual(errorMessages.length, 1);
		});

		test("should show dialog for error with statusCode 401 property", async () => {
			const error = Object.assign(new Error("Request failed"), { statusCode: 401 });
			await handleAuthError("test", error);
			assert.strictEqual(errorMessages.length, 1);
			assert.deepStrictEqual(actionItems[0], ["Sign In", "Set Token"]);
		});

		test("should show dialog for error with statusCode 403 property", async () => {
			const error = Object.assign(new Error("Request failed"), { statusCode: 403 });
			await handleAuthError("test", error);
			assert.strictEqual(errorMessages.length, 1);
			assert.deepStrictEqual(actionItems[0], ["Sign In", "Set Token"]);
		});

		test("should show dialog for error with status 401 property", async () => {
			const error = Object.assign(new Error("Something went wrong"), { status: 401 });
			await handleAuthError("test", error);
			assert.strictEqual(errorMessages.length, 1);
			assert.deepStrictEqual(actionItems[0], ["Sign In", "Set Token"]);
		});

		test("should show dialog for error with string statusCode property", async () => {
			const error = Object.assign(new Error("Request failed"), { statusCode: "403" });
			await handleAuthError("test", error);
			assert.strictEqual(errorMessages.length, 1);
			assert.deepStrictEqual(actionItems[0], ["Sign In", "Set Token"]);
		});

		test("should not show dialog for non-auth statusCode property", async () => {
			const error = Object.assign(new Error("Not found"), { statusCode: 404 });
			await handleAuthError("test", error);
			assert.strictEqual(errorMessages.length, 0);
		});

		test("should show dialog when message matches auth but statusCode is non-auth", async () => {
			const error = Object.assign(new Error("status code 401"), { statusCode: 404 });
			await handleAuthError("test", error);
			assert.strictEqual(errorMessages.length, 1);
			assert.deepStrictEqual(actionItems[0], ["Sign In", "Set Token"]);
		});

		test("should handle string errors", async () => {
			await handleAuthError("test", "403 Forbidden");
			assert.strictEqual(errorMessages.length, 1);
		});

		test("should trigger sign-in when user clicks Sign In", async () => {
			mockSignInAction();

			await handleAuthError("test", new Error("Unauthorized"));
			assert.strictEqual(errorMessages.length, 1);
			assert.deepStrictEqual(actionItems[0], ["Sign In", "Set Token"]);
			assert.strictEqual(getSessionCalled, true);
			assert.deepStrictEqual(getSessionScopes, ["repo"]);
			assert.strictEqual(getSessionOptions?.createIfNone, true);
			assert.deepStrictEqual(executedCommands, []);
		});

		test("should complete sign-in when session is returned", async () => {
			mockSignInAction();

			const fakeSession: vscode.AuthenticationSession = {
				id: "test-session",
				accessToken: "fake-token",
				account: { id: "user-1", label: "testuser" },
				scopes: ["repo"],
			};
			(vscode.authentication as { getSession: unknown }).getSession = async (
				_providerId: string,
				scopes: readonly string[],
				options?: Record<string, unknown>,
			) => {
				getSessionCalled = true;
				getSessionScopes = [...scopes];
				getSessionOptions = options;
				return fakeSession;
			};

			await handleAuthError("test", new Error("Unauthorized"));
			assert.strictEqual(errorMessages.length, 1);
			assert.strictEqual(getSessionCalled, true);
			assert.strictEqual(getSessionOptions?.createIfNone, true);
			assert.deepStrictEqual(executedCommands, []);
			assert.ok(
				loggedMessages.some((m) => m.includes("User requested GitHub sign-in")),
				"Expected sign-in request to be logged",
			);
			assert.ok(
				!loggedMessages.some((m) => m.includes("cancelled or failed")),
				"Expected no cancellation/failure warning when session succeeds",
			);
		});

		test("should log warning when sign-in is cancelled", async () => {
			mockSignInAction();

			(vscode.authentication as { getSession: unknown }).getSession = async () => {
				getSessionCalled = true;
				throw new Error("User did not consent to login.");
			};

			await handleAuthError("test", new Error("Unauthorized"));
			assert.strictEqual(errorMessages.length, 1);
			assert.strictEqual(getSessionCalled, true);
			assert.ok(
				loggedMessages.some((m) => m.includes("cancelled or failed")),
				"Expected cancellation warning to be logged",
			);
		});

		test("should execute set-token command when user clicks Set Token", async () => {
			(vscode.window as { showErrorMessage: unknown }).showErrorMessage = async (
				message: string,
				...items: string[]
			): Promise<string | undefined> => {
				errorMessages.push(message);
				actionItems.push(items);
				return "Set Token";
			};

			await handleAuthError("test", new Error("Unauthorized"));
			assert.strictEqual(errorMessages.length, 1);
			assert.deepStrictEqual(actionItems[0], ["Sign In", "Set Token"]);
			assert.deepStrictEqual(executedCommands, ["quartoWizard.setGitHubToken"]);
			assert.strictEqual(getSessionCalled, false);
		});
	});
});
