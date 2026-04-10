import * as vscode from "vscode";
import {
	createAuthConfig,
	AuthenticationError,
	NetworkError,
	RepositoryNotFoundError,
	getErrorMessage,
	type AuthConfig,
} from "@quarto-wizard/core";
import { logMessage } from "./log";
import { STORAGE_KEY_USE_VSCODE_GITHUB_SESSION } from "../constants";

/**
 * Scopes required for accessing private GitHub repositories.
 */
export const GITHUB_SCOPES = ["repo"];

/**
 * Key for storing manual GitHub token in SecretStorage.
 */
const MANUAL_TOKEN_KEY = "quartoWizard.githubToken";

/**
 * Get GitHub authentication configuration using the following priority:
 * 1. Manual token (SecretStorage) - if user explicitly set one.
 * 2. Environment variables (GITHUB_TOKEN, QUARTO_WIZARD_TOKEN).
 * 3. VSCode GitHub session - only if the user has opted in via
 *    {@link enableVSCodeSessionAuth} (command
 *    `quartoWizard.signInWithGitHubSession` or the "Sign In" action in the
 *    reactive private-repo dialog). The session is fetched silently, so no UI
 *    is ever shown from this call site.
 *
 * @param context - The extension context for accessing secrets and state.
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
	const envAuthConfig = createAuthConfig();
	if (envAuthConfig.githubToken) {
		logMessage("Using GitHub token from environment variable (GITHUB_TOKEN or QUARTO_WIZARD_TOKEN).", "info");
		return envAuthConfig;
	}

	// 3. Silently reuse the VSCode GitHub session, but only if the user has
	//    explicitly opted in. The silent: true flag guarantees no UI is shown
	//    here, so this cannot re-introduce the issue PR #252 fixed.
	const optedIn = context.globalState.get<boolean>(STORAGE_KEY_USE_VSCODE_GITHUB_SESSION) === true;
	if (optedIn) {
		try {
			const session = await vscode.authentication.getSession("github", GITHUB_SCOPES, { silent: true });
			if (session) {
				logMessage("Using GitHub token from VSCode session (opted-in).", "info");
				return createAuthConfig({ githubToken: session.accessToken });
			}
			logMessage("Session opt-in is enabled but no VSCode GitHub session is available.", "debug");
		} catch (error) {
			logMessage(`Silent VSCode GitHub session check failed: ${getErrorMessage(error)}.`, "debug");
		}
	}

	return envAuthConfig;
}

/**
 * Trigger an explicit VSCode GitHub sign-in and record the session opt-in
 * flag so that subsequent {@link getAuthConfig} calls will silently reuse the
 * session. Used by the `quartoWizard.signInWithGitHubSession` command and by
 * the `Sign In` action of the reactive private-repo dialog.
 *
 * @param context - The extension context for persisting the opt-in flag.
 * @returns True if a session was obtained and the flag was set, false otherwise.
 */
export async function enableVSCodeSessionAuth(context: vscode.ExtensionContext): Promise<boolean> {
	try {
		const session = await vscode.authentication.getSession("github", GITHUB_SCOPES, { createIfNone: true });
		if (!session) {
			logMessage("GitHub sign-in did not return a session.", "warn");
			return false;
		}
		await context.globalState.update(STORAGE_KEY_USE_VSCODE_GITHUB_SESSION, true);
		logMessage("GitHub session opt-in enabled. Quarto Wizard will use the VSCode GitHub session.", "info");
		return true;
	} catch (error) {
		logMessage(`GitHub sign-in was cancelled or failed: ${getErrorMessage(error)}.`, "warn");
		return false;
	}
}

/**
 * Clear the session opt-in flag so that {@link getAuthConfig} no longer
 * consults the VSCode GitHub session. Does not sign the user out of VSCode
 * itself — that is VSCode's responsibility and must be user-initiated.
 *
 * @param context - The extension context for persisting the opt-in flag.
 */
export async function disableVSCodeSessionAuth(context: vscode.ExtensionContext): Promise<void> {
	await context.globalState.update(STORAGE_KEY_USE_VSCODE_GITHUB_SESSION, false);
	logMessage("GitHub session opt-in cleared.", "info");
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
 * Options for {@link handleAuthError}.
 */
export interface HandleAuthErrorOptions {
	/**
	 * Extension context used to persist the session opt-in flag when the user
	 * clicks "Sign In" in the private-repo dialog. Required for that flow.
	 */
	context?: vscode.ExtensionContext;
	/**
	 * When true, a 404/"not found" error on an attempt that used no auth
	 * triggers a "may be private, sign in?" dialog. Should only be set by
	 * explicit GitHub install/use entry points so that registry, URL, local,
	 * brand, tree refresh and `handleUri` callers keep their current behaviour.
	 */
	offerSessionOnNotFound?: boolean;
	/**
	 * Whether the failing attempt was authenticated. Used to suppress the
	 * private-repo sign-in dialog when the user was already signed in and hit a
	 * genuine 404.
	 */
	hadAuth?: boolean;
}

/**
 * Checks whether an error indicates an authentication failure and, if so,
 * shows a dialog offering to sign in or set a token.
 *
 * When `offerSessionOnNotFound` is set and `hadAuth` is false, a 404 /
 * {@link RepositoryNotFoundError} additionally triggers a "may be private"
 * sign-in dialog. Clicking `Sign In` there also sets the session opt-in flag
 * via {@link enableVSCodeSessionAuth}, so future installs do not re-prompt.
 *
 * @param prefix - Log prefix for messages.
 * @param error - The error to inspect.
 * @param options - Optional flags controlling extra branches.
 * @returns True if authentication was obtained (user signed in successfully),
 *   false otherwise. Callers can use this to optionally retry the operation.
 */
export async function handleAuthError(
	prefix: string,
	error: unknown,
	options: HandleAuthErrorOptions = {},
): Promise<boolean> {
	const { context, offerSessionOnNotFound = false, hadAuth = false } = options;

	// 0. Private-repo 404 branch for explicit GitHub install/use entry points.
	//    GitHub returns 404 for private repositories accessed without credentials
	//    (to avoid leaking their existence), so a "not found" on an unauthenticated
	//    attempt is ambiguous. Offer the user a chance to sign in.
	if (offerSessionOnNotFound && !hadAuth) {
		const isNotFoundError =
			error instanceof RepositoryNotFoundError || (error instanceof NetworkError && error.statusCode === 404);
		if (isNotFoundError) {
			const action = await vscode.window.showErrorMessage(
				"Repository not found. If it is private, sign in to GitHub to access it.",
				"Sign In",
				"Set Token",
			);
			if (action === "Sign In") {
				if (!context) {
					logMessage(`${prefix} Cannot sign in: no extension context supplied to handleAuthError.`, "warn");
					return false;
				}
				logMessage(`${prefix} User requested GitHub sign-in for possible private repository.`, "info");
				return enableVSCodeSessionAuth(context);
			}
			if (action === "Set Token") {
				await vscode.commands.executeCommand("quartoWizard.setGitHubToken");
			}
			return false;
		}
	}

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
	const message = getErrorMessage(error);
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
			// When context is available, route through enableVSCodeSessionAuth so
			// the session opt-in flag is persisted and future calls will silently
			// reuse the session via getAuthConfig. Without a context, fall back to
			// a bare getSession call that still allows this single retry to succeed.
			if (context) {
				return enableVSCodeSessionAuth(context);
			}
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
