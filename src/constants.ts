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
export const QW_EXTENSIONS = "https://m.canouil.dev/quarto-extensions/extensions.json";

/**
 * Key for caching the Quarto extensions JSON.
 */
export const QW_EXTENSIONS_CACHE = "quarto_wizard_extensions";
