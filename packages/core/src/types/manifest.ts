/**
 * Extension manifest types for parsing _extension.yml files.
 */

import type { ExtensionType } from "./extension.js";

/**
 * Contributions an extension can provide to Quarto.
 */
export interface Contributes {
	/** Lua filters provided by the extension. */
	filters?: string[];
	/** Shortcodes provided by the extension. */
	shortcodes?: string[];
	/** Custom formats provided by the extension. */
	formats?: Record<string, unknown>;
	/** Project type contributions. */
	project?: unknown;
	/** Reveal.js plugins provided by the extension. */
	revealjsPlugins?: string[];
	/** Metadata contributions. */
	metadata?: unknown;
}

/**
 * Parsed extension manifest from _extension.yml.
 */
export interface ExtensionManifest {
	/** Display title of the extension. */
	title: string;
	/** Author of the extension. */
	author: string;
	/** Version string of the extension. */
	version: string;
	/** Minimum required Quarto version. */
	quartoRequired?: string;
	/** Contributions provided by the extension. */
	contributes: Contributes;
	/** Source URL or reference (added during installation). */
	source?: string;
}

/**
 * Raw manifest data as parsed from YAML.
 * This matches the structure of _extension.yml files.
 */
export interface RawManifest {
	title?: string;
	author?: string;
	version?: string | number;
	"quarto-required"?: string;
	contributes?: {
		filters?: string[];
		shortcodes?: string[];
		formats?: Record<string, unknown>;
		project?: unknown;
		revealjs?: {
			plugins?: string[];
		};
		metadata?: unknown;
	};
	source?: string;
}

/**
 * Get the extension types from a manifest based on its contributions.
 *
 * @param manifest - Extension manifest to analyse
 * @returns Array of extension types
 */
export function getExtensionTypes(manifest: ExtensionManifest): ExtensionType[] {
	const types: ExtensionType[] = [];
	const { contributes } = manifest;

	if (contributes.filters && contributes.filters.length > 0) {
		types.push("filter");
	}

	if (contributes.shortcodes && contributes.shortcodes.length > 0) {
		types.push("shortcode");
	}

	if (contributes.formats && Object.keys(contributes.formats).length > 0) {
		types.push("format");
	}

	if (contributes.project) {
		types.push("project");
	}

	if (contributes.revealjsPlugins && contributes.revealjsPlugins.length > 0) {
		types.push("revealjs");
	}

	if (contributes.metadata) {
		types.push("metadata");
	}

	return types;
}

/**
 * Convert a raw manifest from YAML to a normalised ExtensionManifest.
 *
 * @param raw - Raw manifest data from YAML parsing
 * @returns Normalised ExtensionManifest
 */
export function normaliseManifest(raw: RawManifest): ExtensionManifest {
	return {
		title: raw.title ?? "",
		author: raw.author ?? "",
		version: String(raw.version ?? ""),
		quartoRequired: raw["quarto-required"],
		contributes: {
			filters: raw.contributes?.filters,
			shortcodes: raw.contributes?.shortcodes,
			formats: raw.contributes?.formats,
			project: raw.contributes?.project,
			revealjsPlugins: raw.contributes?.revealjs?.plugins,
			metadata: raw.contributes?.metadata,
		},
		source: raw.source,
	};
}
