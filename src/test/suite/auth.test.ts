import * as assert from "assert";
import * as vscode from "vscode";
import { NetworkError, RepositoryNotFoundError } from "@quarto-wizard/core";
import { disableVSCodeSessionAuth, enableVSCodeSessionAuth, getAuthConfig, handleAuthError } from "../../utils/auth";
import * as constants from "../../constants";
import { STORAGE_KEY_USE_VSCODE_GITHUB_SESSION } from "../../constants";

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

		test("Sign In in the 401/403 dialog sets the session opt-in flag when context is provided", async () => {
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

			const context = makeMockContext();
			const result = await handleAuthError("test", new Error("401: Unauthorized"), { context });
			assert.strictEqual(result, true, "Expected handleAuthError to report successful sign-in");
			assert.strictEqual(getSessionCalled, true);
			assert.strictEqual(getSessionOptions?.createIfNone, true);
			assert.strictEqual(
				context.globalState.get(STORAGE_KEY_USE_VSCODE_GITHUB_SESSION),
				true,
				"Expected the session opt-in flag to be persisted when context is provided",
			);
		});

		// Private-repo 404 branch: offered only for explicit GitHub install/use entry points
		// (offerSessionOnNotFound: true) when the failing attempt used no auth.
		const PRIVATE_REPO_MESSAGE = "Repository not found. If it is private, sign in to GitHub to access it.";

		test("should show private-repo dialog for RepositoryNotFoundError when offerSessionOnNotFound and !hadAuth", async () => {
			const context = makeMockContext();
			await handleAuthError("test", new RepositoryNotFoundError("Repository not found: owner/repo"), {
				context,
				offerSessionOnNotFound: true,
				hadAuth: false,
			});
			assert.strictEqual(errorMessages.length, 1);
			assert.strictEqual(errorMessages[0], PRIVATE_REPO_MESSAGE);
			assert.deepStrictEqual(actionItems[0], ["Sign In", "Set Token"]);
		});

		test("should show private-repo dialog for NetworkError statusCode 404 when offerSessionOnNotFound and !hadAuth", async () => {
			const context = makeMockContext();
			await handleAuthError("test", new NetworkError("Failed to download: HTTP 404", { statusCode: 404 }), {
				context,
				offerSessionOnNotFound: true,
				hadAuth: false,
			});
			assert.strictEqual(errorMessages.length, 1);
			assert.strictEqual(errorMessages[0], PRIVATE_REPO_MESSAGE);
		});

		test("should NOT show private-repo dialog when hadAuth is true", async () => {
			const context = makeMockContext();
			await handleAuthError("test", new RepositoryNotFoundError("Repository not found: owner/repo"), {
				context,
				offerSessionOnNotFound: true,
				hadAuth: true,
			});
			assert.strictEqual(errorMessages.length, 0);
		});

		test("should NOT show private-repo dialog when offerSessionOnNotFound is omitted", async () => {
			await handleAuthError("test", new RepositoryNotFoundError("Repository not found: owner/repo"));
			assert.strictEqual(errorMessages.length, 0);
		});

		test("should NOT show private-repo dialog for non-404 errors even when flag is set", async () => {
			const context = makeMockContext();
			await handleAuthError("test", new NetworkError("Server error: HTTP 500", { statusCode: 500 }), {
				context,
				offerSessionOnNotFound: true,
				hadAuth: false,
			});
			assert.strictEqual(errorMessages.length, 0);
		});

		test("should still fire existing 401/403 dialog alongside offerSessionOnNotFound flag", async () => {
			const context = makeMockContext();
			await handleAuthError("test", new Error("401: Unauthorized"), {
				context,
				offerSessionOnNotFound: true,
				hadAuth: false,
			});
			assert.strictEqual(errorMessages.length, 1);
			// The existing reactive dialog text, not the private-repo one.
			assert.notStrictEqual(errorMessages[0], PRIVATE_REPO_MESSAGE);
			assert.deepStrictEqual(actionItems[0], ["Sign In", "Set Token"]);
		});

		test("Sign In in the 404 dialog sets the session opt-in flag", async () => {
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

			const context = makeMockContext();
			const result = await handleAuthError("test", new RepositoryNotFoundError("Repository not found: owner/repo"), {
				context,
				offerSessionOnNotFound: true,
				hadAuth: false,
			});
			assert.strictEqual(result, true, "Expected handleAuthError to report successful sign-in");
			assert.strictEqual(getSessionCalled, true);
			assert.deepStrictEqual(getSessionScopes, ["repo"]);
			assert.strictEqual(getSessionOptions?.createIfNone, true);
			assert.strictEqual(
				context.globalState.get(STORAGE_KEY_USE_VSCODE_GITHUB_SESSION),
				true,
				"Expected the session opt-in flag to be persisted",
			);
		});

		test("Set Token in the 404 dialog dispatches quartoWizard.setGitHubToken", async () => {
			(vscode.window as { showErrorMessage: unknown }).showErrorMessage = async (
				message: string,
				...items: string[]
			): Promise<string | undefined> => {
				errorMessages.push(message);
				actionItems.push(items);
				return "Set Token";
			};

			const context = makeMockContext();
			await handleAuthError("test", new RepositoryNotFoundError("Repository not found: owner/repo"), {
				context,
				offerSessionOnNotFound: true,
				hadAuth: false,
			});
			assert.deepStrictEqual(executedCommands, ["quartoWizard.setGitHubToken"]);
			assert.strictEqual(getSessionCalled, false);
			assert.strictEqual(
				context.globalState.get(STORAGE_KEY_USE_VSCODE_GITHUB_SESSION),
				undefined,
				"Expected the opt-in flag not to be set when user chose Set Token",
			);
		});
	});

	suite("getAuthConfig", () => {
		const ORIGINAL_GITHUB_TOKEN = process.env["GITHUB_TOKEN"];
		const ORIGINAL_QUARTO_WIZARD_TOKEN = process.env["QUARTO_WIZARD_TOKEN"];

		setup(() => {
			delete process.env["GITHUB_TOKEN"];
			delete process.env["QUARTO_WIZARD_TOKEN"];
		});

		teardown(() => {
			if (ORIGINAL_GITHUB_TOKEN === undefined) {
				delete process.env["GITHUB_TOKEN"];
			} else {
				process.env["GITHUB_TOKEN"] = ORIGINAL_GITHUB_TOKEN;
			}
			if (ORIGINAL_QUARTO_WIZARD_TOKEN === undefined) {
				delete process.env["QUARTO_WIZARD_TOKEN"];
			} else {
				process.env["QUARTO_WIZARD_TOKEN"] = ORIGINAL_QUARTO_WIZARD_TOKEN;
			}
		});

		test("manual token takes priority over env var and session opt-in", async () => {
			const context = makeMockContext({ manualToken: "manual", optedIn: true });
			process.env["GITHUB_TOKEN"] = "env";
			(vscode.authentication as { getSession: unknown }).getSession = async () => {
				getSessionCalled = true;
				return {
					id: "x",
					accessToken: "vscode",
					account: { id: "u", label: "u" },
					scopes: ["repo"],
				} as vscode.AuthenticationSession;
			};

			const auth = await getAuthConfig(context);
			assert.strictEqual(auth.githubToken, "manual");
			assert.strictEqual(getSessionCalled, false, "Expected getSession not to be called when manual token is set");
		});

		test("env var takes priority over session opt-in", async () => {
			const context = makeMockContext({ optedIn: true });
			process.env["GITHUB_TOKEN"] = "env";
			(vscode.authentication as { getSession: unknown }).getSession = async () => {
				getSessionCalled = true;
				return {
					id: "x",
					accessToken: "vscode",
					account: { id: "u", label: "u" },
					scopes: ["repo"],
				} as vscode.AuthenticationSession;
			};

			const auth = await getAuthConfig(context);
			assert.strictEqual(auth.githubToken, "env");
			assert.strictEqual(getSessionCalled, false, "Expected getSession not to be called when env var is set");
		});

		test("session used when opt-in flag is true and no manual/env token", async () => {
			const context = makeMockContext({ optedIn: true });
			(vscode.authentication as { getSession: unknown }).getSession = async (
				_providerId: string,
				scopes: readonly string[],
				options?: Record<string, unknown>,
			) => {
				getSessionCalled = true;
				getSessionScopes = [...scopes];
				getSessionOptions = options;
				return {
					id: "x",
					accessToken: "vscode-token",
					account: { id: "u", label: "u" },
					scopes: ["repo"],
				} as vscode.AuthenticationSession;
			};

			const auth = await getAuthConfig(context);
			assert.strictEqual(auth.githubToken, "vscode-token");
			assert.strictEqual(getSessionCalled, true);
			assert.deepStrictEqual(getSessionScopes, ["repo"]);
			assert.strictEqual(getSessionOptions?.silent, true);
			assert.notStrictEqual(getSessionOptions?.createIfNone, true);
		});

		test("session NOT used when opt-in flag is false", async () => {
			const context = makeMockContext({ optedIn: false });
			(vscode.authentication as { getSession: unknown }).getSession = async () => {
				getSessionCalled = true;
				return {
					id: "x",
					accessToken: "vscode",
					account: { id: "u", label: "u" },
					scopes: ["repo"],
				} as vscode.AuthenticationSession;
			};

			const auth = await getAuthConfig(context);
			assert.strictEqual(auth.githubToken, undefined);
			assert.strictEqual(getSessionCalled, false, "Expected getSession not to be called without opt-in");
		});

		test("falls back to empty config when opt-in flag is true but session missing", async () => {
			const context = makeMockContext({ optedIn: true });
			(vscode.authentication as { getSession: unknown }).getSession = async () => {
				getSessionCalled = true;
				return undefined as unknown as vscode.AuthenticationSession;
			};

			const auth = await getAuthConfig(context);
			assert.strictEqual(auth.githubToken, undefined);
			assert.strictEqual(getSessionCalled, true);
		});

		test("degrades gracefully when silent session check throws", async () => {
			const context = makeMockContext({ optedIn: true });
			(vscode.authentication as { getSession: unknown }).getSession = async () => {
				getSessionCalled = true;
				throw new Error("session provider unavailable");
			};

			const auth = await getAuthConfig(context);
			assert.strictEqual(auth.githubToken, undefined);
			assert.strictEqual(getSessionCalled, true);
		});
	});

	suite("enableVSCodeSessionAuth / disableVSCodeSessionAuth", () => {
		test("enable: sets opt-in flag to true on successful session", async () => {
			const context = makeMockContext();
			(vscode.authentication as { getSession: unknown }).getSession = async () =>
				({
					id: "x",
					accessToken: "t",
					account: { id: "u", label: "u" },
					scopes: ["repo"],
				}) as vscode.AuthenticationSession;

			const ok = await enableVSCodeSessionAuth(context);
			assert.strictEqual(ok, true);
			assert.strictEqual(context.globalState.get(STORAGE_KEY_USE_VSCODE_GITHUB_SESSION), true);
		});

		test("enable: does not set opt-in flag when sign-in is cancelled", async () => {
			const context = makeMockContext();
			(vscode.authentication as { getSession: unknown }).getSession = async () => {
				throw new Error("User did not consent to login.");
			};

			const ok = await enableVSCodeSessionAuth(context);
			assert.strictEqual(ok, false);
			assert.strictEqual(context.globalState.get(STORAGE_KEY_USE_VSCODE_GITHUB_SESSION), undefined);
		});

		test("enable: does not set opt-in flag when session is undefined", async () => {
			const context = makeMockContext();
			(vscode.authentication as { getSession: unknown }).getSession = async () =>
				undefined as unknown as vscode.AuthenticationSession;

			const ok = await enableVSCodeSessionAuth(context);
			assert.strictEqual(ok, false);
			assert.strictEqual(context.globalState.get(STORAGE_KEY_USE_VSCODE_GITHUB_SESSION), undefined);
		});

		test("disable: sets opt-in flag to false", async () => {
			const context = makeMockContext({ optedIn: true });
			let authCalled = false;
			(vscode.authentication as { getSession: unknown }).getSession = async () => {
				authCalled = true;
				return undefined as unknown as vscode.AuthenticationSession;
			};

			await disableVSCodeSessionAuth(context);
			assert.strictEqual(context.globalState.get(STORAGE_KEY_USE_VSCODE_GITHUB_SESSION), false);
			assert.strictEqual(authCalled, false, "disable must not touch vscode.authentication");
		});
	});

	/**
	 * Minimal ExtensionContext mock for auth tests.
	 * Supports secrets.get/store/delete and globalState.get/update.
	 */
	function makeMockContext(initial: { manualToken?: string; optedIn?: boolean } = {}): vscode.ExtensionContext {
		const secretStore = new Map<string, string>();
		if (initial.manualToken !== undefined) {
			secretStore.set("quartoWizard.githubToken", initial.manualToken);
		}
		const globalStateStore = new Map<string, unknown>();
		if (initial.optedIn !== undefined) {
			globalStateStore.set(STORAGE_KEY_USE_VSCODE_GITHUB_SESSION, initial.optedIn);
		}

		const secrets = {
			get: async (key: string) => secretStore.get(key),
			store: async (key: string, value: string) => {
				secretStore.set(key, value);
			},
			delete: async (key: string) => {
				secretStore.delete(key);
			},
			keys: async () => Array.from(secretStore.keys()),
			onDidChange: (() => ({
				dispose: () => {
					/* noop */
				},
			})) as unknown as vscode.Event<vscode.SecretStorageChangeEvent>,
		} as unknown as vscode.SecretStorage;

		const globalState = {
			keys: () => Array.from(globalStateStore.keys()),
			get: <T>(key: string, defaultValue?: T): T | undefined => {
				if (globalStateStore.has(key)) {
					return globalStateStore.get(key) as T;
				}
				return defaultValue;
			},
			update: async (key: string, value: unknown) => {
				if (value === undefined) {
					globalStateStore.delete(key);
				} else {
					globalStateStore.set(key, value);
				}
			},
			setKeysForSync: () => {
				/* noop */
			},
		} as unknown as vscode.Memento & { setKeysForSync(keys: readonly string[]): void };

		return {
			secrets,
			globalState,
		} as unknown as vscode.ExtensionContext;
	}
});
