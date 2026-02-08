/**
 * Registry module exports.
 */

export { type HttpOptions, fetchJson, fetchText } from "./http.js";

export {
	DEFAULT_CACHE_TTL,
	getDefaultCacheDir,
	getCacheFilePath,
	readCachedRegistry,
	writeCachedRegistry,
	clearRegistryCache,
	getCacheStatus,
} from "./cache.js";

export { type RegistryOptions, fetchRegistry, getDefaultRegistryUrl } from "./fetcher.js";

export {
	type ListAvailableOptions,
	type SearchOptions,
	listAvailable,
	search,
	getExtension,
	getExtensionsByOwner,
} from "./search.js";
