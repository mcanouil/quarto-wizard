/**
 * @title Manifest Types Module
 * @description Extension manifest types for parsing _extension.yml files.
 *
 * Defines types for extension contributions and manifest structure.
 *
 * @module types
 */

import type { ExtensionType } from "./extension.js";
import { normaliseSubdirectory } from "../archive/security.js";
import { ExtensionError } from "../errors.js";

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
 * Split a source string of the form `base@ref` into its base and its ref.
 *
 * @param source - Raw source string (e.g. `owner/repo@v1.2.3`)
 * @returns The base, whether a ref was present, and the ref (the text after the last `@`), undefined when there is none
 */
export function splitSourceRef(source: string): { base: string; hasRef: boolean; ref: string | undefined } {
	const atIndex = source.lastIndexOf("@");
	const hasRef = atIndex > 0;
	const base = hasRef ? source.substring(0, atIndex) : source;
	return { base, hasRef, ref: hasRef ? source.slice(base.length + 1) : undefined };
}

/**
 * Check if a source string represents a commit-based installation.
 *
 * @param source - Source as recorded in the manifest or the install record
 * @returns The seven-character commit in lower case, or null when the source is not pinned to a commit
 */
export function extractCommitFromSource(source: string): string | null {
	const atIndex = source.lastIndexOf("@");
	if (atIndex <= 0) return null;

	const ref = source.substring(atIndex + 1);
	if (/^[a-f0-9]{7,40}$/i.test(ref)) {
		return ref.substring(0, 7).toLowerCase();
	}
	return null;
}

/**
 * First seven characters of a commit, in lower case.
 */
export function shortCommit(commit: string): string {
	return commit.slice(0, 7).toLowerCase();
}

/**
 * What an update follows for a GitHub install: the latest tag, or the head of a branch.
 */
export type InstallTrack = "tag" | "branch";

/**
 * Update mode that an install record names.
 *
 * Only a GitHub record can say `branch`; a missing record, another kind, or a missing or unknown value is `tag`.
 *
 * @param record - Install record, or null when there is none
 * @returns `branch` when the record says so, otherwise `tag`
 */
export function recordedTrack(record: { kind: string; quartoWizard?: { track?: InstallTrack } } | null): InstallTrack {
	return record?.kind === "github" && record.quartoWizard?.track === "branch" ? "branch" : "tag";
}

/**
 * Seven-character commit in lower case that an install record holds, or null.
 *
 * The commit is `quarto-wizard.commit` for an unpinned source, or the commit ref of a pinned one.
 *
 * @param data - Source and Quarto Wizard data of an install record
 * @returns The commit, or null when the record names none
 */
export function recordedCommit(data: { source: string; quartoWizard?: { commit?: string } }): string | null {
	const tracked = data.quartoWizard?.commit;
	return tracked ? shortCommit(tracked) : extractCommitFromSource(data.source);
}

/**
 * Repository and optional subdirectory named by a GitHub source.
 */
export interface GitHubLocator {
	owner: string;
	repo: string;
	/** Normalised repository subdirectory, absent for the repository root. */
	subdirectory?: string;
}

/**
 * Parse the base of a GitHub source, without its `@ref`, into its repository
 * and subdirectory.
 *
 * Empty segments in the subdirectory are dropped.
 *
 * @param base - Source without its ref (e.g. `owner/repo/sub/dir`)
 * @returns The locator, or null when the owner or the repository is missing
 * @throws ExtensionError with code "INVALID_SUBDIRECTORY" when the subdirectory could leave the repository
 */
export function parseGitHubLocator(base: string): GitHubLocator | null {
	const [owner, repo, ...segments] = base.split("/");
	const subdirectory = normaliseSubdirectory(segments.filter(Boolean).join("/"));
	if (!owner || !repo) {
		return null;
	}
	return subdirectory ? { owner, repo, subdirectory } : { owner, repo };
}

/**
 * Parse the base of a GitHub source like `parseGitHubLocator`, without throwing.
 *
 * @param base - Source without its ref (e.g. `owner/repo/sub/dir`)
 * @returns The locator, or null when the source names no repository or a subdirectory that could leave it
 */
export function tryParseGitHubLocator(base: string): GitHubLocator | null {
	try {
		return parseGitHubLocator(base);
	} catch (error) {
		if (error instanceof ExtensionError) {
			return null;
		}
		throw error;
	}
}

/**
 * Format a GitHub locator as `owner/repo` or `owner/repo/<subdirectory>`.
 *
 * @param locator - Repository and optional subdirectory
 * @returns Source base without a ref
 */
export function formatGitHubLocator(locator: GitHubLocator): string {
	const base = `${locator.owner}/${locator.repo}`;
	return locator.subdirectory ? `${base}/${locator.subdirectory}` : base;
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
