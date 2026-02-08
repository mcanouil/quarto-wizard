import * as vscode from "vscode";
import { logMessage } from "../utils/log";

/**
 * API interface for the Quarto VS Code extension.
 * This matches the API exposed by quarto.quarto extension (PR #879).
 */
interface QuartoExtensionApi {
	getQuartoPath(): string | undefined;
	getQuartoVersion(): string | undefined;
	isQuartoAvailable(): boolean;
}

/**
 * Information about the Quarto CLI installation.
 */
export interface QuartoVersionInfo {
	/** Whether Quarto is available. */
	available: boolean;
	/** The Quarto CLI version string (e.g., "1.8.20"). */
	version: string | undefined;
	/** The path to the Quarto CLI binary. */
	path: string | undefined;
}

/**
 * Get information about the Quarto CLI installation via the Quarto VS Code extension API.
 *
 * This function is opportunistic: if the Quarto extension is not installed or the API
 * is unavailable, it returns a result indicating Quarto is not available. It never
 * prompts the user to install the Quarto extension.
 *
 * @returns Information about the Quarto CLI installation.
 */
export async function getQuartoVersionInfo(): Promise<QuartoVersionInfo> {
	const unavailable: QuartoVersionInfo = {
		available: false,
		version: undefined,
		path: undefined,
	};

	// Check if the Quarto extension is installed
	const quartoExt = vscode.extensions.getExtension("quarto.quarto");

	if (!quartoExt) {
		logMessage("Quarto extension not installed. Skipping version check.", "debug");
		return unavailable;
	}

	try {
		// Activate the extension and get the API
		const api = (await quartoExt.activate()) as QuartoExtensionApi;

		if (!api) {
			logMessage("Quarto extension API not available.", "debug");
			return unavailable;
		}

		// Check if the API methods exist (for older versions of the extension)
		if (typeof api.isQuartoAvailable !== "function") {
			logMessage("Quarto extension API does not expose isQuartoAvailable().", "debug");
			return unavailable;
		}

		const available = api.isQuartoAvailable();
		const version = typeof api.getQuartoVersion === "function" ? api.getQuartoVersion() : undefined;
		const path = typeof api.getQuartoPath === "function" ? api.getQuartoPath() : undefined;

		logMessage(`Quarto version info: available=${available}, version=${version ?? "unknown"}.`, "debug");

		return {
			available,
			version,
			path,
		};
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		logMessage(`Failed to get Quarto version info: ${errorMsg}.`, "debug");
		return unavailable;
	}
}
