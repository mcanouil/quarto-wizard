import * as vscode from "vscode";
import { createAuthConfig, type AuthConfig } from "@quarto-wizard/core";
import { logMessage } from "./log";

/**
 * Scopes required for accessing private GitHub repositories.
 */
const GITHUB_SCOPES = ["repo"];

/**
 * Key for storing manual GitHub token in SecretStorage.
 */
const MANUAL_TOKEN_KEY = "quartoWizard.githubToken";

/**
 * Options for getting authentication configuration.
 */
export interface GetAuthConfigOptions {
	/**
	 * If true, prompts user to sign in if no session exists.
	 * @default false
	 */
	createIfNone?: boolean;
	/**
	 * If true, never shows UI (returns undefined if no session).
	 * @default false
	 */
	silent?: boolean;
}

/**
 * Get GitHub authentication configuration using the following priority:
 * 1. Manual token (SecretStorage) - if user explicitly set one.
 * 2. VSCode GitHub session - native OAuth.
 * 3. Environment variables (GITHUB_TOKEN, QUARTO_WIZARD_TOKEN).
 *
 * @param context - The extension context for accessing secrets.
 * @param options - Options for authentication behaviour.
 * @returns AuthConfig with GitHub token if available.
 */
export async function getAuthConfig(
	context: vscode.ExtensionContext,
	options?: GetAuthConfigOptions,
): Promise<AuthConfig> {
	// 1. Check for manual token (highest priority)
	const manualToken = await context.secrets.get(MANUAL_TOKEN_KEY);
	if (manualToken) {
		logMessage("Using manual GitHub token from SecretStorage.", "info");
		return createAuthConfig({ githubToken: manualToken });
	}

	// 2. Try VSCode native GitHub session
	try {
		const session = await vscode.authentication.getSession("github", GITHUB_SCOPES, {
			createIfNone: options?.createIfNone ?? false,
			silent: options?.silent ?? false,
		});

		if (session) {
			logMessage("Using GitHub token from VSCode session.", "info");
			return createAuthConfig({ githubToken: session.accessToken });
		}
	} catch (error) {
		// Only log if it's not a user cancellation
		if (error instanceof Error && !error.message.includes("User did not consent")) {
			logMessage(`GitHub authentication error: ${error.message}`, "warn");
		}
	}

	// 3. Fall back to environment variables (handled by createAuthConfig)
	const authConfig = createAuthConfig();
	if (authConfig.githubToken) {
		logMessage("Using GitHub token from environment variable (GITHUB_TOKEN or QUARTO_WIZARD_TOKEN).", "info");
	}

	return authConfig;
}

/**
 * Set a manual GitHub token (stored securely in SecretStorage).
 * When set, this token takes priority over VSCode sessions and environment variables.
 *
 * @param context - The extension context for accessing secrets.
 * @param token - The GitHub personal access token to store.
 */
export async function setManualToken(context: vscode.ExtensionContext, token: string): Promise<void> {
	await context.secrets.store(MANUAL_TOKEN_KEY, token);
	logMessage("Manual GitHub token stored securely.", "info");
}

/**
 * Clear the manual GitHub token.
 * After clearing, authentication will fall back to VSCode session or environment variables.
 *
 * @param context - The extension context for accessing secrets.
 */
export async function clearManualToken(context: vscode.ExtensionContext): Promise<void> {
	await context.secrets.delete(MANUAL_TOKEN_KEY);
	logMessage("Manual GitHub token cleared.", "info");
}

/**
 * Check if a manual token is set in SecretStorage.
 *
 * @param context - The extension context for accessing secrets.
 * @returns True if a manual token is stored.
 */
export async function hasManualToken(context: vscode.ExtensionContext): Promise<boolean> {
	const token = await context.secrets.get(MANUAL_TOKEN_KEY);
	return token !== undefined;
}

/**
 * Checks whether an error message indicates an authentication failure and,
 * if so, shows a dialog offering to sign in or set a token.
 *
 * @param prefix - Log prefix for messages.
 * @param error - The error to inspect.
 * @returns True if authentication was obtained (user signed in successfully),
 *   false otherwise.  Callers can use this to optionally retry the operation.
 */
export async function handleAuthError(prefix: string, error: unknown): Promise<boolean> {
	// Check for structured error properties first (more reliable than string matching).
	const statusCode =
		error && typeof error === "object" && Object.hasOwn(error, "statusCode")
			? (error as Record<string, unknown>).statusCode
			: error && typeof error === "object" && Object.hasOwn(error, "status")
				? (error as Record<string, unknown>).status
				: undefined;

	// Some HTTP libraries store status codes as strings, so check both.
	const isAuthStatus = statusCode === 401 || statusCode === "401" || statusCode === 403 || statusCode === "403";

	const message = error instanceof Error ? error.message : String(error);
	// String-based fallback for libraries that only throw string errors.
	// Patterns are deliberately narrow to avoid false positives:
	// - "status 401", "status: 403", "HTTP 401" (status code in context).
	// - "authentication [token] failed/required/..." and the reverse order
	//   "failed/denied/... authentication" (up to 10 chars of intervening text
	//   to allow e.g. "authentication token expired" or "invalid authentication").
	// - "401: Unauthorized", "403 - Forbidden" (status code + HTTP reason phrase).
	// - Standalone "Unauthorized" / "Forbidden" (whole message or after colon).
	const isAuthMessage =
		/\bstatus\b.{0,20}\b(401|403)\b/i.test(message) ||
		/\bHTTP\s+(401|403)\b/i.test(message) ||
		/\bauthentication\b.{0,10}\b(fail(?:ed|ure)?|required|denied|invalid|expired)\b/i.test(message) ||
		/\b(fail(?:ed|ure)?|required|denied|invalid|expired)\b.{0,10}\bauthentication\b/i.test(message) ||
		/\b(401|403)\b[:\s,;-]+(Unauthorized|Forbidden)\b/i.test(message) ||
		/:\s*(Unauthorized|Forbidden)\s*$/i.test(message) ||
		/^(Unauthorized|Forbidden)$/i.test(message.trim());

	if (isAuthStatus || isAuthMessage) {
		const action = await vscode.window.showErrorMessage(
			"Authentication may be required. Sign in to GitHub to access private repositories.",
			"Sign In",
			"Set Token",
		);
		if (action === "Sign In") {
			logMessage(`${prefix} User requested GitHub sign-in.`, "info");
			try {
				const session = await vscode.authentication.getSession("github", GITHUB_SCOPES, {
					createIfNone: true,
				});
				if (session) {
					return true;
				}
			} catch {
				logMessage(`${prefix} GitHub sign-in was cancelled or failed.`, "warn");
			}
		} else if (action === "Set Token") {
			await vscode.commands.executeCommand("quartoWizard.setGitHubToken");
		}
	}
	return false;
}

/**
 * Logs the authentication status for an operation.
 * Logs "Authentication: none (public access)." when no auth is configured.
 *
 * @param auth - The authentication configuration.
 */
export function logAuthStatus(auth: AuthConfig | undefined): void {
	if (!auth?.githubToken && (auth?.httpHeaders?.length ?? 0) === 0) {
		logMessage("Authentication: none (public access).", "info");
	}
}
