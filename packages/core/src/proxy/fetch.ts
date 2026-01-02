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
 * Maximum number of proxy agents to cache.
 * Prevents unbounded memory growth when many different proxy URLs are used.
 */
const MAX_PROXY_CACHE_SIZE = 10;

/**
 * Simple LRU cache for ProxyAgent instances.
 * Uses Map's insertion order to track recency.
 */
class LRUProxyCache {
	private cache = new Map<string, ProxyAgent>();
	private readonly maxSize: number;

	constructor(maxSize: number) {
		this.maxSize = maxSize;
	}

	get(proxyUrl: string): ProxyAgent | undefined {
		const agent = this.cache.get(proxyUrl);
		if (agent) {
			// Move to end (most recently used) by re-inserting
			this.cache.delete(proxyUrl);
			this.cache.set(proxyUrl, agent);
		}
		return agent;
	}

	set(proxyUrl: string, agent: ProxyAgent): void {
		// If already exists, delete first to update position
		if (this.cache.has(proxyUrl)) {
			this.cache.delete(proxyUrl);
		} else if (this.cache.size >= this.maxSize) {
			// Evict least recently used (first entry)
			const firstKey = this.cache.keys().next().value;
			if (firstKey !== undefined) {
				const evictedAgent = this.cache.get(firstKey);
				evictedAgent?.close();
				this.cache.delete(firstKey);
			}
		}
		this.cache.set(proxyUrl, agent);
	}

	clear(): void {
		for (const agent of this.cache.values()) {
			agent.close();
		}
		this.cache.clear();
	}

	get size(): number {
		return this.cache.size;
	}
}

/**
 * Options for proxy-aware fetch.
 */
export interface ProxyFetchOptions extends RequestInit {
	/** Proxy configuration. If not provided, reads from environment. */
	proxyConfig?: ProxyConfig;
}

/**
 * LRU cache for ProxyAgent instances by proxy URL.
 */
const proxyAgentCache = new LRUProxyCache(MAX_PROXY_CACHE_SIZE);

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
		// Type assertions are necessary due to undici/Fetch API type incompatibilities:
		// 1. ProxyAgent extends Dispatcher, but undici's fetch expects Dispatcher from
		//    its own module which may have subtle version-specific type differences.
		// 2. undici's Response is a separate implementation of the Fetch API Response
		//    interface. While compatible at runtime, TypeScript treats them as different
		//    types. Using the global Response type provides better API compatibility.
		// These assertions are safe because undici implements the Fetch API spec.
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
	proxyAgentCache.clear();
}
