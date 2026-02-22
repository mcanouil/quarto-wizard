import { NETWORK_CHECK_TIMEOUT_MS } from "../constants";
import { logMessage, showMessageWithLogs } from "./log";

/**
 * Checks if there is an active internet connection by attempting to fetch a URL.
 *
 * @param {string} [url="https://github.com/"] - The URL to check the internet connection against.
 * @param {number} timeoutMs - Timeout in milliseconds (default: 5000ms).
 * @returns {Promise<boolean>} - A promise that resolves to true if the internet connection is active, otherwise false.
 */
export async function checkInternetConnection(
	url = "https://github.com/",
	timeoutMs = NETWORK_CHECK_TIMEOUT_MS,
): Promise<boolean> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => {
		controller.abort();
	}, timeoutMs);

	try {
		// Uses raw fetch rather than proxyFetch because proxyFetch lives in
		// @quarto-wizard/core and is not exported for extension-layer use.
		// In corporate proxy environments this check may report "no internet"
		// even when actual extension operations (which use proxyFetch) succeed.
		const response: Response = await fetch(url, {
			signal: controller.signal,
		});

		if (response.ok) {
			return true;
		}

		const message = `No internet connection. Unable to reach required service at ${url} (HTTP ${response.status}). Please check your network settings.`;
		logMessage(message, "error");
		showMessageWithLogs(message, "error");
		return false;
	} catch (error) {
		let userMessage: string;
		if (error instanceof Error && error.name === "AbortError") {
			userMessage = `Network connection check timed out after ${timeoutMs}ms. Please check your network settings.`;
		} else {
			userMessage = `No internet connection. Please check your network settings.`;
			if (error instanceof Error) {
				logMessage(`Network check failed: ${error.message}.`, "error");
			}
		}
		logMessage(userMessage, "error");
		showMessageWithLogs(userMessage, "error");
		return false;
	} finally {
		clearTimeout(timeoutId);
	}
}
