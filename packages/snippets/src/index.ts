/**
 * @quarto-wizard/snippets - Snippet types, parsing, and caching
 * for Quarto extension snippet files.
 *
 * This library provides functionality for:
 * - Snippet type definitions (SnippetDefinition, SnippetCollection, etc.)
 * - Snippet file parsing (_snippets.json)
 * - Snippet caching (in-memory lazy-loading cache)
 */

// Type exports
export * from "./types.js";

// Error exports
export { SnippetError } from "./errors.js";

// Filesystem exports
export * from "./filesystem/index.js";
