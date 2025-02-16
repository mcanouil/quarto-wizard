import * as vscode from "vscode";

export const QW_LOG = vscode.window.createOutputChannel("Quarto Wizard", { log: true });

export const QW_RECENTLY_INSTALLED = "recentlyInstalledExtensions";

export const QW_EXTENSIONS =
	"https://raw.githubusercontent.com/mcanouil/quarto-extensions/main/extensions/quarto-extensions.csv";
export const QW_EXTENSIONS_CACHE = "quarto_wizard_extensions_csv";
export const QW_EXTENSIONS_CACHE_TIME = 60 * 60 * 1000; // 1 hour

export const QW_EXTENSION_DETAILS_CACHE = "quarto_wizard_extensions_details";
export const QW_EXTENSION_DETAILS_CACHE_TIME = 24 * 60 * 60 * 1000; // 24 hours

// The GitHub Authentication Provider accepts the scopes described here:
// https://developer.github.com/apps/building-oauth-apps/understanding-scopes-for-oauth-apps/
export const QW_AUTH_PROVIDER_ID = "github";
export const QW_AUTH_PROVIDER_SCOPES: string[] = []; // "no scope" = Grants read-only access to public information
