/**
 * Registry fetching and parsing.
 */

import type { Registry, RawRegistryEntry } from "../types/registry.js";
import { parseRegistry } from "../types/registry.js";
import type { AuthConfig } from "../types/auth.js";
import { getAuthHeaders } from "../types/auth.js";
import { fetchJson } from "./http.js";
import {
  readCachedRegistry,
  writeCachedRegistry,
  getDefaultCacheDir,
} from "./cache.js";

/** Default registry URL. */
const DEFAULT_REGISTRY_URL =
  "https://raw.githubusercontent.com/mcanouil/quarto-extensions/refs/heads/quarto-wizard/quarto-extensions.json";

/** Default cache TTL: 24 hours. */
const DEFAULT_TTL = 24 * 60 * 60 * 1000;

/**
 * Options for fetching the registry.
 */
export interface RegistryOptions {
  /** Custom registry URL. */
  registryUrl?: string;
  /** Cache directory (uses platform default if not provided). */
  cacheDir?: string;
  /** Force refresh, ignoring cache. */
  forceRefresh?: boolean;
  /** Cache TTL in milliseconds (default: 24 hours). */
  cacheTtl?: number;
  /** Authentication configuration. */
  auth?: AuthConfig;
  /** Request timeout in milliseconds. */
  timeout?: number;
}

/**
 * Fetch the extension registry.
 *
 * @param options - Registry options
 * @returns Parsed registry
 */
export async function fetchRegistry(
  options: RegistryOptions = {}
): Promise<Registry> {
  const {
    registryUrl = DEFAULT_REGISTRY_URL,
    cacheDir = getDefaultCacheDir(),
    forceRefresh = false,
    cacheTtl = DEFAULT_TTL,
    auth,
    timeout,
  } = options;

  if (!forceRefresh && cacheDir) {
    const cached = await readCachedRegistry(cacheDir, registryUrl, cacheTtl);
    if (cached) {
      return cached;
    }
  }

  const headers = getAuthHeaders(auth, false);

  const raw = await fetchJson<Record<string, RawRegistryEntry>>(registryUrl, {
    headers,
    timeout,
  });

  const registry = parseRegistry(raw);

  if (cacheDir) {
    await writeCachedRegistry(cacheDir, registryUrl, registry);
  }

  return registry;
}

/**
 * Get the default registry URL.
 */
export function getDefaultRegistryUrl(): string {
  return DEFAULT_REGISTRY_URL;
}
