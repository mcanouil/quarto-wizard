/**
 * @title HTTP Utilities Module
 * @description HTTP utilities with timeout and retry support.
 *
 * Provides robust fetch operations with configurable timeouts and retries.
 *
 * @module registry
 */

import { CancellationError, NetworkError } from "../errors.js";
import { proxyFetch } from "../proxy/index.js";

/**
 * Options for HTTP requests.
 */
export interface HttpOptions {
	/** Request timeout in milliseconds (default: 30000). */
	timeout?: number;
	/** Number of retry attempts (default: 3). */
	retries?: number;
	/** Base delay for exponential backoff in ms (default: 1000). */
	retryDelay?: number;
	/** Custom headers to include. */
	headers?: Record<string, string>;
	/** AbortSignal for cancellation. */
	signal?: AbortSignal;
}

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000;

/**
 * Fetch with timeout support.
 *
 * @param url - URL to fetch
 * @param options - Fetch options
 * @param timeout - Timeout in milliseconds
 * @returns Response
 */
async function fetchWithTimeout(
	url: string,
	options: RequestInit,
	timeout: number,
	externalSignal?: AbortSignal,
): Promise<Response> {
	if (externalSignal?.aborted) {
		throw new CancellationError();
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeout);

	// Link external signal to internal controller so callers can cancel
	const onExternalAbort = () => controller.abort();
	externalSignal?.addEventListener("abort", onExternalAbort, { once: true });

	try {
		const response = await proxyFetch(url, {
			...options,
			signal: controller.signal,
		});
		return response;
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			// Distinguish user cancellation from timeout
			if (externalSignal?.aborted) {
				throw new CancellationError();
			}
			throw new NetworkError(`Request timed out after ${timeout}ms`, { cause: error });
		}
		throw error;
	} finally {
		clearTimeout(timeoutId);
		externalSignal?.removeEventListener("abort", onExternalAbort);
	}
}

/**
 * Check if an error is retryable.
 */
function isRetryableError(error: unknown): boolean {
	if (error instanceof NetworkError) {
		const statusCode = error.statusCode;
		if (statusCode) {
			return statusCode >= 500 || statusCode === 429;
		}
		return true;
	}
	return error instanceof Error && error.name === "AbortError";
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch with retry support and a response processor.
 *
 * @param url - URL to fetch
 * @param requestHeaders - Headers to send
 * @param processResponse - Callback to extract the desired value from the response
 * @param options - HTTP options
 * @returns Processed response value
 */
async function fetchWithRetry<T>(
	url: string,
	requestHeaders: Record<string, string>,
	processResponse: (response: Response) => Promise<T>,
	options: HttpOptions = {},
): Promise<T> {
	const {
		timeout = DEFAULT_TIMEOUT,
		retries = DEFAULT_RETRIES,
		retryDelay = DEFAULT_RETRY_DELAY,
		headers = {},
		signal,
	} = options;

	let lastError: Error | undefined;

	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			const response = await fetchWithTimeout(
				url,
				{
					method: "GET",
					headers: {
						...requestHeaders,
						...headers,
					},
				},
				timeout,
				signal,
			);

			if (!response.ok) {
				throw new NetworkError(`HTTP ${response.status}: ${response.statusText}`, { statusCode: response.status });
			}

			return await processResponse(response);
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));

			if (attempt < retries && isRetryableError(error)) {
				const delay = retryDelay * Math.pow(2, attempt);
				await sleep(delay);
				continue;
			}

			throw error;
		}
	}

	throw lastError ?? new NetworkError("Request failed after all retries");
}

/**
 * Fetch JSON with timeout and retry support.
 *
 * @param url - URL to fetch
 * @param options - HTTP options
 * @returns Parsed JSON response
 */
export async function fetchJson<T>(url: string, options: HttpOptions = {}): Promise<T> {
	return fetchWithRetry<T>(
		url,
		{ Accept: "application/json", "User-Agent": "quarto-wizard" },
		(response) => response.json() as Promise<T>,
		options,
	);
}

/**
 * Fetch text with timeout and retry support.
 *
 * @param url - URL to fetch
 * @param options - HTTP options
 * @returns Response text
 */
export async function fetchText(url: string, options: HttpOptions = {}): Promise<string> {
	return fetchWithRetry<string>(url, { "User-Agent": "quarto-wizard" }, (response) => response.text(), options);
}
