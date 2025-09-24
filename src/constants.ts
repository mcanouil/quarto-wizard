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
 * Key for storing recently used templates.
 */
export const QW_RECENTLY_USED = "recentlyUsedTemplates";

/**
 * URL to the Quarto extensions CSV file.
 */
export const QW_EXTENSIONS =
	"https://raw.githubusercontent.com/mcanouil/quarto-extensions/refs/heads/quarto-wizard/quarto-extensions.json";

/**
 * Key for caching the Quarto extensions JSON.
 */
export const QW_EXTENSIONS_CACHE = "quarto_wizard_extensions";

/**
 * Cache duration for the Quarto extensions JSON in milliseconds.
 * Currently set to 0 to disable caching (was 1 hour: 1 * 60 * 60 * 1000).
 * This ensures users always get the latest extension information.
 */
export const QW_EXTENSIONS_CACHE_TIME = 0 * 60 * 60 * 1000;
