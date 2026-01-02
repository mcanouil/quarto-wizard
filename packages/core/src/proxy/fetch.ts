/**
 * @title Proxy-Aware Fetch Module
 * @description Proxy-aware fetch wrapper using undici.
 *
 * Automatically routes requests through configured proxy servers.
 *
 * @module proxy
 */

import { fetch as undiciFetch, ProxyAgent, type Dispatcher } from "undici";
import { getProxyForUrl, type ProxyConfig } from "./config.js";

/**
 * Options for proxy-aware fetch.
 */
export interface ProxyFetchOptions extends RequestInit {
	/** Proxy configuration. If not provided, reads from environment. */
	proxyConfig?: ProxyConfig;
}

/**
 * Cache for ProxyAgent instances by proxy URL.
 */
const proxyAgentCache = new Map<string, ProxyAgent>();

/**
 * Get or create a ProxyAgent for a given proxy URL.
 *
 * @param proxyUrl - Proxy URL
 * @returns ProxyAgent instance
 */
function getProxyAgent(proxyUrl: string): ProxyAgent {
	let agent = proxyAgentCache.get(proxyUrl);

	if (!agent) {
		agent = new ProxyAgent(proxyUrl);
		proxyAgentCache.set(proxyUrl, agent);
	}

	return agent;
}

/**
 * Proxy-aware fetch function.
 *
 * Uses undici's fetch with ProxyAgent when a proxy is configured via
 * environment variables (HTTP_PROXY, HTTPS_PROXY, NO_PROXY).
 *
 * @param url - URL to fetch
 * @param options - Fetch options with optional proxy configuration
 * @returns Response
 */
export async function proxyFetch(url: string | URL, options: ProxyFetchOptions = {}): Promise<Response> {
	const { proxyConfig, ...fetchOptions } = options;
	const urlString = url.toString();
	const proxyUrl = getProxyForUrl(urlString, proxyConfig);

	if (proxyUrl) {
		const dispatcher = getProxyAgent(proxyUrl);
		return undiciFetch(url, {
			...fetchOptions,
			dispatcher: dispatcher as unknown as Dispatcher,
		}) as unknown as Response;
	}

	// No proxy needed, use regular fetch
	return fetch(urlString, fetchOptions);
}

/**
 * Clear the proxy agent cache.
 * Useful for testing or when proxy configuration changes.
 */
export function clearProxyAgentCache(): void {
	for (const agent of proxyAgentCache.values()) {
		agent.close();
	}
	proxyAgentCache.clear();
}
