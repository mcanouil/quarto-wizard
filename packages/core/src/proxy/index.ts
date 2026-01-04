/**
 * Proxy configuration and fetch utilities.
 */

export { getProxyConfig, getProxyForUrl, shouldBypassProxy, type ProxyConfig } from "./config.js";
export { proxyFetch, clearProxyAgentCache, type ProxyFetchOptions } from "./fetch.js";
