/**
 * @title Manifest Types Module
 * @description Extension manifest types for parsing _extension.yml files.
 *
 * Defines types for extension contributions and manifest structure.
 *
 * @module types
 */

import type { ExtensionType } from "./extension.js";

/**
 * Contributions an extension can provide to Quarto.
 * Uses singular forms normalised from YAML plural keys.
 */
export interface Contributes {
	/** Lua filters provided by the extension. */
	filter?: string[];
	/** Shortcodes provided by the extension. */
	shortcode?: string[];
	/** Custom formats provided by the extension. */
	format?: Record<string, unknown>;
	/** Project type contributions. */
	project?: unknown;
	/** Reveal.js plugins provided by the extension. */
	revealjsPlugin?: string[];
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
	/** Source type indicating how the extension was installed. */
	sourceType?: SourceType;
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
		"revealjs-plugins"?: string[];
		metadata?: unknown;
	};
	source?: string;
	"source-type"?: string;
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

	if (contributes.filter && contributes.filter.length > 0) {
		types.push("filter");
	}

	if (contributes.shortcode && contributes.shortcode.length > 0) {
		types.push("shortcode");
	}

	if (contributes.format && Object.keys(contributes.format).length > 0) {
		types.push("format");
	}

	if (contributes.project) {
		types.push("project");
	}

	if (contributes.revealjsPlugin && contributes.revealjsPlugin.length > 0) {
		types.push("revealjs-plugin");
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
		version: typeof raw.version === "string" || typeof raw.version === "number" ? String(raw.version) : "",
		quartoRequired: raw["quarto-required"],
		contributes: {
			filter: raw.contributes?.filters,
			shortcode: raw.contributes?.shortcodes,
			format: raw.contributes?.formats,
			project: raw.contributes?.project,
			revealjsPlugin: raw.contributes?.["revealjs-plugins"],
			metadata: raw.contributes?.metadata,
		},
		source: raw.source,
		sourceType: parseSourceType(raw["source-type"]),
	};
}

/** Valid source types for extension installation. */
export type SourceType = "github" | "url" | "local" | "registry";

const VALID_SOURCE_TYPES: ReadonlySet<string> = new Set<SourceType>(["github", "url", "local", "registry"]);

function parseSourceType(value: string | undefined): SourceType | undefined {
	if (!value || !VALID_SOURCE_TYPES.has(value)) {
		return undefined;
	}
	return value as SourceType;
}
