import * as vscode from "vscode";

/**
 * Output channel for Quarto Wizard logs.
 */
export const QW_LOG = vscode.window.createOutputChannel("Quarto Wizard", { log: true });

/**
 * Key for storing recently installed extensions.
 */
export const STORAGE_KEY_RECENTLY_INSTALLED = "recentlyInstalledExtensions";

/**
 * Key for storing recently used templates.
 */
export const STORAGE_KEY_RECENTLY_USED = "recentlyUsedTemplates";

/**
 * Default registry URL (sourced from core library).
 */
export { getDefaultRegistryUrl } from "@quarto-wizard/core";

/**
 * Key for caching the Quarto extensions JSON.
 */
export const QW_EXTENSIONS_CACHE = "quarto_wizard_extensions";
