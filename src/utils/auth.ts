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
		logMessage("Using manual GitHub token from SecretStorage.", "debug");
		return createAuthConfig({ githubToken: manualToken });
	}

	// 2. Try VSCode native GitHub session
	try {
		const session = await vscode.authentication.getSession("github", GITHUB_SCOPES, {
			createIfNone: options?.createIfNone ?? false,
			silent: options?.silent ?? false,
		});

		if (session) {
			logMessage("Using GitHub token from VSCode session.", "debug");
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
		logMessage("Using GitHub token from environment variable.", "debug");
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
 * Check if any GitHub authentication is available (silent check, no prompts).
 * Checks manual token, VSCode session, and environment variables.
 *
 * @param context - The extension context for accessing secrets.
 * @returns True if any authentication method is available.
 */
export async function hasGitHubAuth(context: vscode.ExtensionContext): Promise<boolean> {
	// Check manual token
	if (await hasManualToken(context)) {
		return true;
	}

	// Check VSCode session (silent)
	try {
		const session = await vscode.authentication.getSession("github", GITHUB_SCOPES, {
			createIfNone: false,
			silent: true,
		});
		if (session) {
			return true;
		}
	} catch {
		// Ignore errors in silent check
	}

	// Check environment variables
	const authConfig = createAuthConfig();
	return authConfig.githubToken !== undefined;
}
