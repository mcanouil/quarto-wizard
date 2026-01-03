/**
 * @title Proxy Configuration Module
 * @description Proxy configuration from environment variables.
 *
 * Quarto Wizard respects standard proxy environment variables for network requests.
 * This is useful when working behind a corporate proxy.
 *
 * @module proxy
 *
 * @envvar HTTP_PROXY - Proxy URL for HTTP requests.
 * @envvar http_proxy - Proxy URL for HTTP requests (lowercase variant).
 * @envvar HTTPS_PROXY - Proxy URL for HTTPS requests.
 * @envvar https_proxy - Proxy URL for HTTPS requests (lowercase variant).
 * @envvar NO_PROXY - Comma or space-separated list of hosts to bypass the proxy.
 * @envvar no_proxy - Comma or space-separated list of hosts to bypass (lowercase variant).
 *
 * The uppercase variants take precedence over lowercase if both are set.
 *
 * @example Setting proxy for HTTPS requests
 * ```bash
 * export HTTPS_PROXY=http://proxy.example.com:8080
 * ```
 *
 * @example Setting proxy with authentication
 * ```bash
 * export HTTPS_PROXY=http://user:password@proxy.example.com:8080
 * ```
 *
 * @example Bypassing proxy for specific hosts
 * ```bash
 * export NO_PROXY=localhost,127.0.0.1,.internal.corp
 * ```
 *
 * @pattern * - Matches all hosts (disables proxy).
 * @pattern example.com - Matches exactly example.com and subdomains like api.example.com.
 * @pattern .example.com - Matches domain example.com and all subdomains.
 * @pattern localhost - Matches the literal hostname localhost.
 * @pattern 127.0.0.1 - Matches the literal IP address.
 *
 * @note CIDR notation (e.g., 192.168.1.0/24) is not supported.
 */

/**
 * Proxy configuration.
 */
export interface ProxyConfig {
	/** Proxy URL for HTTP requests. */
	httpProxy?: string;
	/** Proxy URL for HTTPS requests. */
	httpsProxy?: string;
	/** List of hosts/patterns to bypass the proxy. */
	noProxy: string[];
}

/**
 * Get proxy URL from environment variables.
 * Checks uppercase first, then lowercase.
 *
 * @param name - Base name of the environment variable (e.g., "HTTP_PROXY")
 * @returns Proxy URL or undefined
 */
function getProxyEnv(name: string): string | undefined {
	return process.env[name.toUpperCase()] ?? process.env[name.toLowerCase()];
}

/**
 * Parse NO_PROXY environment variable into a list of patterns.
 *
 * @param noProxy - NO_PROXY value (comma or space separated)
 * @returns List of patterns
 */
function parseNoProxy(noProxy: string | undefined): string[] {
	if (!noProxy) {
		return [];
	}

	return noProxy
		.split(/[,\s]+/)
		.map((pattern) => pattern.trim().toLowerCase())
		.filter((pattern) => pattern.length > 0);
}

/**
 * Read proxy configuration from environment variables.
 *
 * @returns Proxy configuration
 */
export function getProxyConfig(): ProxyConfig {
	return {
		httpProxy: getProxyEnv("HTTP_PROXY"),
		httpsProxy: getProxyEnv("HTTPS_PROXY"),
		noProxy: parseNoProxy(getProxyEnv("NO_PROXY")),
	};
}

/**
 * Check if a hostname should bypass the proxy.
 *
 * Supports patterns:
 * - "*" matches all hosts
 * - ".example.com" matches example.com and all subdomains
 * - "example.com" matches exactly example.com
 * - "192.168.1.0/24" style CIDR is NOT supported (matched literally)
 *
 * @param hostname - Hostname to check
 * @param noProxy - List of NO_PROXY patterns
 * @returns True if the host should bypass the proxy
 */
export function shouldBypassProxy(hostname: string, noProxy: string[]): boolean {
	if (noProxy.length === 0) {
		return false;
	}

	const host = hostname.toLowerCase();

	for (const pattern of noProxy) {
		// Wildcard matches everything
		if (pattern === "*") {
			return true;
		}

		// Pattern starting with dot matches domain and subdomains
		if (pattern.startsWith(".")) {
			const domain = pattern.slice(1);
			if (host === domain || host.endsWith(pattern)) {
				return true;
			}
		} else {
			// Exact match or suffix match
			if (host === pattern || host.endsWith(`.${pattern}`)) {
				return true;
			}
		}
	}

	return false;
}

/**
 * Get the appropriate proxy URL for a given request URL.
 *
 * @param url - Request URL
 * @param config - Proxy configuration
 * @returns Proxy URL or undefined if no proxy should be used
 */
export function getProxyForUrl(url: string, config?: ProxyConfig): string | undefined {
	if (!config) {
		config = getProxyConfig();
	}

	let parsedUrl: URL;
	try {
		parsedUrl = new URL(url);
	} catch {
		return undefined;
	}

	// Check if host should bypass proxy
	if (shouldBypassProxy(parsedUrl.hostname, config.noProxy)) {
		return undefined;
	}

	// Select proxy based on protocol
	const protocol = parsedUrl.protocol.toLowerCase();

	if (protocol === "https:") {
		return config.httpsProxy ?? config.httpProxy;
	}

	if (protocol === "http:") {
		return config.httpProxy;
	}

	return undefined;
}
