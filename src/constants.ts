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
 * Key for storing the opt-in flag that allows Quarto Wizard to use the
 * VSCode GitHub session for authentication. Lives in globalState because
 * it is a preference, not a secret (VSCode owns the session itself).
 */
export const STORAGE_KEY_USE_VSCODE_GITHUB_SESSION = "quartoWizard.useVSCodeGitHubSession";

/**
 * Default registry URL (sourced from core library).
 */
export { getDefaultRegistryUrl } from "@quarto-wizard/core";

/**
 * Key for caching the Quarto extensions JSON.
 */
export const QW_EXTENSIONS_CACHE = "quarto_wizard_extensions";

/**
 * Timeout for registry fetch operations (ms).
 */
export const REGISTRY_FETCH_TIMEOUT_MS = 10_000;

/**
 * Timeout for network connectivity checks (ms).
 */
export const NETWORK_CHECK_TIMEOUT_MS = 5_000;
