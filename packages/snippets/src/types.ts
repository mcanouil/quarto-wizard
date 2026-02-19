/**
 * @title Snippet Types
 * @description Types for VS Code snippet JSON format and namespace utilities.
 *
 * @module types
 */

/**
 * Extension identifier for snippet namespacing.
 * Structurally compatible with @quarto-wizard/core's ExtensionId.
 */
export interface SnippetExtensionId {
	/** The owner (user or organisation) of the extension, or null if unowned. */
	owner: string | null;
	/** The name of the extension. */
	name: string;
}

/**
 * A single snippet definition in VS Code snippet JSON format.
 */
export interface SnippetDefinition {
	/** Trigger prefix(es) for the snippet. */
	prefix: string | string[];
	/** Body lines of the snippet (joined with newlines on insertion). */
	body: string | string[];
	/** Human-readable description shown in IntelliSense. */
	description?: string;
}

/**
 * A collection of named snippet definitions.
 * Keys are human-readable snippet names; values are the definitions.
 */
export type SnippetCollection = Record<string, SnippetDefinition>;

/**
 * Compute the namespace string for an extension.
 * Format: "owner-name" when an owner exists, "name" otherwise.
 *
 * @param id - Extension identifier.
 * @returns Namespace string.
 */
export function snippetNamespace(id: SnippetExtensionId): string {
	return id.owner ? `${id.owner}-${id.name}` : id.name;
}

/**
 * Qualify a snippet prefix with its extension namespace.
 * Format: "namespace:rawPrefix".
 *
 * @param namespace - Extension namespace (from {@link snippetNamespace}).
 * @param rawPrefix - Original snippet prefix.
 * @returns Qualified prefix string.
 */
export function qualifySnippetPrefix(namespace: string, rawPrefix: string): string {
	return `${namespace}:${rawPrefix}`;
}
