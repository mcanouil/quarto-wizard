import * as vscode from "vscode";
import { createAuthConfig, AuthenticationError, NetworkError, type AuthConfig } from "@quarto-wizard/core";
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
 * Get GitHub authentication configuration using the following priority:
 * 1. Manual token (SecretStorage) - if user explicitly set one.
 * 2. Environment variables (GITHUB_TOKEN, QUARTO_WIZARD_TOKEN).
 *
 * VSCode GitHub session acquisition is handled reactively by
 * {@link handleAuthError} when authentication errors occur.
 *
 * @param context - The extension context for accessing secrets.
 * @returns AuthConfig with GitHub token if available.
 */
export async function getAuthConfig(context: vscode.ExtensionContext): Promise<AuthConfig> {
	// 1. Check for manual token (highest priority)
	const manualToken = await context.secrets.get(MANUAL_TOKEN_KEY);
	if (manualToken) {
		logMessage("Using manual GitHub token from SecretStorage.", "info");
		return createAuthConfig({ githubToken: manualToken });
	}

	// 2. Fall back to environment variables (handled by createAuthConfig)
	const authConfig = createAuthConfig();
	if (authConfig.githubToken) {
		logMessage("Using GitHub token from environment variable (GITHUB_TOKEN or QUARTO_WIZARD_TOKEN).", "info");
	}

	return authConfig;
}

/**
 * Set a manual GitHub token (stored securely in SecretStorage).
 * When set, this token takes priority over environment variables.
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
 * After clearing, authentication will fall back to environment variables.
 *
 * @param context - The extension context for accessing secrets.
 */
export async function clearManualToken(context: vscode.ExtensionContext): Promise<void> {
	await context.secrets.delete(MANUAL_TOKEN_KEY);
	logMessage("Manual GitHub token cleared.", "info");
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
	// 1. Check for typed core errors (most reliable, avoids string matching).
	const isTypedAuthError =
		error instanceof AuthenticationError ||
		(error instanceof NetworkError && (error.statusCode === 401 || error.statusCode === 403));

	// 2. Check for structured error properties from non-core errors.
	const statusCode = isTypedAuthError
		? undefined
		: error && typeof error === "object" && Object.hasOwn(error, "statusCode")
			? (error as Record<string, unknown>).statusCode
			: error && typeof error === "object" && Object.hasOwn(error, "status")
				? (error as Record<string, unknown>).status
				: undefined;

	// Some HTTP libraries store status codes as strings, so check both.
	const isAuthStatus = statusCode === 401 || statusCode === "401" || statusCode === 403 || statusCode === "403";

	// 3. String-based fallback for libraries that only throw string errors.
	// Patterns are deliberately narrow to avoid false positives:
	// - "status 401", "status: 403", "HTTP 401" (status code in context).
	// - "authentication [token] failed/required/..." and the reverse order
	//   "failed/denied/... authentication" (forward: up to 10 chars, reverse: up
	//   to 5 chars to avoid "Failed to parse authentication..." false positives).
	// - "401: Unauthorized", "403 - Forbidden" (status code + HTTP reason phrase).
	// - Standalone "Unauthorized" / "Forbidden" (whole message or after colon).
	const message = error instanceof Error ? error.message : String(error);
	const isAuthMessage =
		/\bstatus\b.{0,20}\b(401|403)\b/i.test(message) ||
		/\bHTTP\s+(401|403)\b/i.test(message) ||
		/\bauthentication\b.{0,10}\b(fail(?:ed|ure)?|required|denied|invalid|expired)\b/i.test(message) ||
		/\b(fail(?:ed|ure)?|required|denied|invalid|expired)\b.{0,5}\bauthentication\b/i.test(message) ||
		/\b(401|403)\b[:\s,;-]+(Unauthorized|Forbidden)\b/i.test(message) ||
		/(?<!\d):\s*(Unauthorized|Forbidden)\s*$/i.test(message) ||
		/^(Unauthorized|Forbidden)$/i.test(message.trim());

	if (isTypedAuthError || isAuthStatus || isAuthMessage) {
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
