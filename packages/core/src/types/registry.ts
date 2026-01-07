/**
 * @title Registry Types Module
 * @description Registry types for the Quarto extensions registry.
 *
 * Defines types for registry entries and the registry data structure.
 *
 * @module types
 */

/**
 * Entry for an extension in the registry.
 */
export interface RegistryEntry {
	/** Unique key in the registry (usually owner/repo). */
	id: string;
	/** The owner (user or organisation). */
	owner: string;
	/** The display name/title. */
	name: string;
	/** The full repository name (owner/repo format). */
	fullName: string;
	/** Extension description. */
	description: string | null;
	/** Repository topics/tags. */
	topics: string[];
	/** What the extension contributes (e.g., filters, formats, shortcodes). */
	contributes: string[];
	/** Latest version (without 'v' prefix). */
	latestVersion: string | null;
	/** Latest release tag (with 'v' prefix if present). */
	latestTag: string | null;
	/** URL to the latest release page. */
	latestReleaseUrl: string | null;
	/** GitHub star count. */
	stars: number;
	/** Licence information. */
	licence: string | null;
	/** GitHub repository URL. */
	htmlUrl: string;
	/** Whether this extension provides templates. */
	template: boolean;
	/** Default branch name (e.g., "main", "master"). */
	defaultBranchRef: string | null;
	/** SHA of the latest commit on the default branch. */
	latestCommit: string | null;
}

/**
 * The full registry mapping extension IDs to their entries.
 */
export type Registry = Record<string, RegistryEntry>;

/**
 * Raw registry entry as returned from the JSON API.
 *
 * This is the expected format for entries in custom registry JSON files.
 * The registry JSON file should be an object mapping extension IDs (e.g., "owner/repo")
 * to `RawRegistryEntry` objects.
 *
 * @example
 * ```json
 * {
 *   "quarto-ext/lightbox": {
 *     "owner": "quarto-ext",
 *     "title": "Lightbox",
 *     "nameWithOwner": "quarto-ext/lightbox",
 *     "description": "Create lightbox treatments for images",
 *     "repositoryTopics": ["quarto", "quarto-extension", "shortcode"],
 *     "contributes": ["shortcode"],
 *     "latestRelease": "v0.1.4",
 *     "latestReleaseUrl": "https://github.com/quarto-ext/lightbox/releases/tag/v0.1.4",
 *     "stargazerCount": 42,
 *     "licenseInfo": "MIT",
 *     "url": "https://github.com/quarto-ext/lightbox",
 *     "template": false,
 *     "defaultBranchRef": "main",
 *     "latestCommit": "abc1234567890"
 *   }
 * }
 * ```
 */
export interface RawRegistryEntry {
	/** Repository owner (GitHub username or organisation). Required. */
	owner: string;
	/** Display name/title of the extension. Required. */
	title: string;
	/** Full repository name in "owner/repo" format. Required. */
	nameWithOwner: string;
	/** Extension description. */
	description?: string | null;
	/** GitHub repository topics/tags for categorisation. */
	repositoryTopics?: string[];
	/** What the extension contributes (e.g., "filter", "shortcode", "format", "project", "revealjs-plugin", "metadata"). */
	contributes?: string[];
	/** Latest release tag (e.g., "v1.0.0"). */
	latestRelease?: string | null;
	/** URL to the latest release page on GitHub. */
	latestReleaseUrl?: string | null;
	/** GitHub star count. */
	stargazerCount?: number;
	/** SPDX licence identifier (e.g., "MIT", "GPL-3.0"). */
	licenseInfo?: string | null;
	/** GitHub repository URL. Required. */
	url: string;
	/** Whether this extension provides project templates. */
	template?: boolean;
	/** Default branch name (e.g., "main", "master"). */
	defaultBranchRef?: string | null;
	/** SHA of the latest commit on the default branch. */
	latestCommit?: string | null;
}

/**
 * Parse a raw registry entry into a normalised RegistryEntry.
 *
 * @param key - The registry key (usually owner/repo)
 * @param raw - Raw entry from the JSON API
 * @returns Normalised RegistryEntry
 */
export function parseRegistryEntry(key: string, raw: RawRegistryEntry): RegistryEntry {
	const latestTag = raw.latestRelease ?? null;
	const latestVersion = latestTag ? latestTag.replace(/^v/, "") : null;

	return {
		id: key,
		owner: raw.owner,
		name: raw.title,
		fullName: raw.nameWithOwner,
		description: raw.description ?? null,
		topics: raw.repositoryTopics ?? [],
		contributes: raw.contributes ?? [],
		latestVersion,
		latestTag,
		latestReleaseUrl: raw.latestReleaseUrl ?? null,
		stars: raw.stargazerCount ?? 0,
		licence: raw.licenseInfo ?? null,
		htmlUrl: raw.url,
		template: raw.template ?? false,
		defaultBranchRef: raw.defaultBranchRef ?? null,
		latestCommit: raw.latestCommit ?? null,
	};
}

/**
 * Parse a raw registry object into a normalised Registry.
 *
 * @param raw - Raw registry object from JSON
 * @returns Normalised Registry
 */
export function parseRegistry(raw: Record<string, RawRegistryEntry>): Registry {
	const registry: Registry = {};

	for (const [key, entry] of Object.entries(raw)) {
		registry[key] = parseRegistryEntry(key, entry);
	}

	return registry;
}
