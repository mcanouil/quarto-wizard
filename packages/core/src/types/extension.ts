/**
 * @title Extension Types Module
 * @description Extension identification and reference types.
 *
 * Defines types for extension IDs, version specifications, and references.
 *
 * @module types
 */

/**
 * Unique identifier for a Quarto extension.
 * Supports both "owner/name" and name-only patterns.
 */
export interface ExtensionId {
	/** The owner (user or organisation) of the extension. */
	owner: string | null;
	/** The name of the extension. */
	name: string;
}

/**
 * Version specification for extension references.
 */
export type VersionSpec =
	| { type: "exact"; version: string }
	| { type: "tag"; tag: string }
	| { type: "branch"; branch: string }
	| { type: "commit"; commit: string }
	| { type: "latest" };

/**
 * Reference to an extension with optional version specification.
 */
export interface ExtensionRef {
	id: ExtensionId;
	version: VersionSpec;
}

/**
 * Types of contributions an extension can provide.
 */
export type ExtensionType = "filter" | "shortcode" | "format" | "project" | "revealjs-plugin" | "metadata";

/**
 * Parse an extension ID string into an ExtensionId object.
 *
 * @param input - Extension ID string (e.g., "quarto-ext/lightbox" or "lightbox")
 * @returns Parsed ExtensionId object
 */
export function parseExtensionId(input: string): ExtensionId {
	const trimmed = input.trim();
	const parts = trimmed.split("/");

	if (parts.length === 2 && parts[0] && parts[1]) {
		return { owner: parts[0], name: parts[1] };
	}

	return { owner: null, name: trimmed };
}

/**
 * Format an ExtensionId object as a string.
 *
 * @param id - ExtensionId to format
 * @returns Formatted string (e.g., "quarto-ext/lightbox" or "lightbox")
 */
export function formatExtensionId(id: ExtensionId): string {
	return id.owner ? `${id.owner}/${id.name}` : id.name;
}

/**
 * Parse a version specification string.
 *
 * Resolution order: tag > commit > branch
 *
 * @param input - Version string (e.g., "v1.0.0", "abc1234", "main", "latest")
 * @returns Parsed VersionSpec
 */
export function parseVersionSpec(input: string): VersionSpec {
	const trimmed = input.trim();

	if (trimmed === "" || trimmed.toLowerCase() === "latest") {
		return { type: "latest" };
	}

	// 1. Tags: starts with 'v' or looks like semver (e.g., "v1.0.0", "1.0.0")
	if (trimmed.startsWith("v") || /^\d+\.\d+/.test(trimmed)) {
		return { type: "tag", tag: trimmed };
	}

	// 2. Commits: 7-40 hex characters (e.g., "abc1234", "abc1234567890...")
	if (/^[a-f0-9]{7,40}$/i.test(trimmed)) {
		return { type: "commit", commit: trimmed };
	}

	// 3. Branches: anything else (e.g., "main", "develop", "feature/foo")
	return { type: "branch", branch: trimmed };
}

/**
 * Parse an extension reference string into an ExtensionRef object.
 *
 * @param input - Extension reference string (e.g., "quarto-ext/lightbox@v1.0.0")
 * @returns Parsed ExtensionRef object
 */
export function parseExtensionRef(input: string): ExtensionRef {
	const trimmed = input.trim();
	const atIndex = trimmed.lastIndexOf("@");

	if (atIndex === -1 || atIndex === 0) {
		return {
			id: parseExtensionId(trimmed),
			version: { type: "latest" },
		};
	}

	const idPart = trimmed.substring(0, atIndex);
	const versionPart = trimmed.substring(atIndex + 1);

	return {
		id: parseExtensionId(idPart),
		version: parseVersionSpec(versionPart),
	};
}

/**
 * Format an ExtensionRef object as a string.
 *
 * @param ref - ExtensionRef to format
 * @returns Formatted string (e.g., "quarto-ext/lightbox@v1.0.0")
 */
export function formatExtensionRef(ref: ExtensionRef): string {
	const idStr = formatExtensionId(ref.id);

	switch (ref.version.type) {
		case "latest":
			return idStr;
		case "exact":
			return `${idStr}@${ref.version.version}`;
		case "tag":
			return `${idStr}@${ref.version.tag}`;
		case "branch":
			return `${idStr}@${ref.version.branch}`;
		case "commit":
			return `${idStr}@${ref.version.commit.substring(0, 7)}`;
	}
}
