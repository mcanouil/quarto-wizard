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

// Restrict to the characters GitHub permits in owner and repo names so that
// inputs like `!/!@!@...` don't get misclassified and the pattern isn't
// susceptible to polynomial backtracking (CodeQL `js/polynomial-redos`).
// Callers must strip any `@ref` suffix first (see `splitSourceRef`).
const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+$/;

/**
 * Split a source string of the form `base@ref` into its base and an indicator
 * of whether an explicit ref was present.
 *
 * @param source - Raw source string (e.g. `owner/repo@v1.2.3`)
 * @returns Tuple of base and whether a ref was present
 */
export function splitSourceRef(source: string): { base: string; hasRef: boolean } {
	const atIndex = source.lastIndexOf("@");
	if (atIndex <= 0) {
		return { base: source, hasRef: false };
	}
	return {
		base: source.substring(0, atIndex),
		hasRef: true,
	};
}

function isLocalSourcePath(source: string): boolean {
	return (
		source.startsWith("file://") ||
		source.startsWith("/") ||
		source.startsWith("~/") ||
		source.startsWith("\\\\") ||
		source.startsWith(".") ||
		/^[A-Za-z]:[/\\]/.test(source)
	);
}

function isLegacyGitHubSource(source: string): boolean {
	return GITHUB_REPOSITORY_PATTERN.test(source) && !source.startsWith(".");
}

/**
 * Infer the source type from a raw source string when no explicit `source-type`
 * was recorded in the manifest (legacy installations).
 *
 * @param source - Raw source string from the manifest
 * @returns Inferred source type, or undefined if the string is unrecognised
 */
export function inferSourceType(source: string | undefined): SourceType | undefined {
	if (!source) {
		return undefined;
	}
	if (/^https?:\/\//.test(source)) {
		return "url";
	}
	if (isLocalSourcePath(source)) {
		return "local";
	}
	if (isLegacyGitHubSource(splitSourceRef(source).base)) {
		return "registry";
	}
	return undefined;
}

/**
 * Resolve the effective source type for a manifest, preferring the explicit
 * `sourceType` field and falling back to inference from the source string.
 *
 * @param manifest - Parsed extension manifest
 * @returns The resolved source type, or undefined if it cannot be determined
 */
export function getEffectiveSourceType(manifest: ExtensionManifest): SourceType | undefined {
	if (manifest.sourceType) {
		return manifest.sourceType;
	}
	return inferSourceType(manifest.source);
}
