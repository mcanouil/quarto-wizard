import * as vscode from "vscode";

/**
 * Output channel for Quarto Wizard logs.
 */
export const QW_LOG = vscode.window.createOutputChannel("Quarto Wizard", { log: true });

/**
 * Key for storing recently installed extensions.
 */
export const QW_RECENTLY_INSTALLED = "recentlyInstalledExtensions";

/**
 * URL to the Quarto extensions CSV file.
 */
export const QW_EXTENSIONS =
	"https://raw.githubusercontent.com/mcanouil/quarto-extensions/main/extensions/quarto-extensions.csv";

/**
 * Key for caching the Quarto extensions CSV.
 */
export const QW_EXTENSIONS_CACHE = "quarto_wizard_extensions_csv";

/**
 * Cache duration for the Quarto extensions CSV (default to 1 hour).
 */
export const QW_EXTENSIONS_CACHE_TIME = 60 * 60 * 1000;

/**
 * Key for caching Quarto extension details retrieved from the GitHub API.
 */
export const QW_EXTENSION_DETAILS_CACHE = "quarto_wizard_extensions_details";

/**
 * Cache duration for Quarto extension details (default to 24 hours).
 */
export const QW_EXTENSION_DETAILS_CACHE_TIME = 24 * 60 * 60 * 1000;

/**
 * GitHub authentication provider ID.
 */
export const QW_AUTH_PROVIDER_ID = "github";

/**
 * Scopes for the GitHub authentication provider.
 * "no scope" = Grants read-only access to public information.
 * The GitHub Authentication Provider accepts the scopes described here:
 * https://developer.github.com/apps/building-oauth-apps/understanding-scopes-for-oauth-apps/
 */
export const QW_AUTH_PROVIDER_SCOPES: string[] = [];
