/**
 * @title Snippet Parsing Module
 * @description Parsing for _snippets.json files.
 *
 * Provides functions to find, parse, and read Quarto extension snippet files.
 *
 * @module filesystem
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { SnippetCollection, SnippetDefinition } from "../types.js";
import { SnippetError } from "../errors.js";
import { getErrorMessage } from "@quarto-wizard/core";

/** The snippet filename convention. */
export const SNIPPET_FILENAME = "_snippets.json";

/**
 * Result of reading a snippet file.
 */
export interface SnippetReadResult {
	/** Parsed snippet collection. */
	snippets: SnippetCollection;
	/** Full path to the snippet file. */
	snippetPath: string;
}

/**
 * Find the snippet file in a directory.
 *
 * @param directory - Directory to search.
 * @returns Path to the snippet file or null if not found.
 */
export function findSnippetFile(directory: string): string | null {
	const snippetPath = path.join(directory, SNIPPET_FILENAME);
	if (fs.existsSync(snippetPath)) {
		return snippetPath;
	}
	return null;
}

/**
 * Validate that a value looks like a snippet definition.
 * A valid entry must have both `prefix` and `body` fields.
 */
function isValidSnippetEntry(value: unknown): value is SnippetDefinition {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}
	const obj = value as Record<string, unknown>;
	const prefix = obj["prefix"];
	const hasPrefix =
		(typeof prefix === "string" && prefix.length > 0) ||
		(Array.isArray(prefix) &&
			prefix.length > 0 &&
			prefix.every((entry) => typeof entry === "string" && entry.length > 0));
	const body = obj["body"];
	const hasBody =
		(typeof body === "string" && body.length > 0) ||
		(Array.isArray(body) &&
			body.length > 0 &&
			body.every((entry) => typeof entry === "string") &&
			body.some((entry) => entry.length > 0));
	const description = obj["description"];
	const hasValidDescription = description === undefined || typeof description === "string";
	return hasPrefix && hasBody && hasValidDescription;
}

/**
 * Parse snippet content from a JSON string.
 * Entries missing `prefix` or `body` are silently skipped.
 *
 * @param content - JSON content string.
 * @param sourcePath - Source path for error messages (optional).
 * @returns Parsed snippet collection.
 * @throws SnippetError if the JSON is invalid or the root is not an object.
 */
export function parseSnippetContent(content: string, sourcePath?: string): SnippetCollection {
	let raw: unknown;
	try {
		raw = JSON.parse(content);
	} catch (error) {
		throw new SnippetError(`Failed to parse snippet JSON: ${getErrorMessage(error)}`, {
			snippetPath: sourcePath,
			cause: error,
		});
	}

	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new SnippetError("Snippet file must contain a JSON object", { snippetPath: sourcePath });
	}

	const result: SnippetCollection = {};
	for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
		if (isValidSnippetEntry(value)) {
			result[name] = value;
		}
	}

	return result;
}

/**
 * Parse a snippet file from a path.
 *
 * @param snippetPath - Full path to the snippet file.
 * @returns Parsed snippet collection.
 * @throws SnippetError if reading or parsing fails.
 */
export function parseSnippetFile(snippetPath: string): SnippetCollection {
	try {
		const content = fs.readFileSync(snippetPath, "utf-8");
		return parseSnippetContent(content, snippetPath);
	} catch (error) {
		if (error instanceof SnippetError) {
			throw error;
		}
		throw new SnippetError(`Failed to read snippet file: ${getErrorMessage(error)}`, {
			snippetPath,
			cause: error,
		});
	}
}

/**
 * Read snippets from an extension directory.
 *
 * @param directory - Directory containing the snippet file.
 * @returns SnippetReadResult or null if no snippet file found.
 */
export function readSnippets(directory: string): SnippetReadResult | null {
	const snippetPath = findSnippetFile(directory);

	if (!snippetPath) {
		return null;
	}

	const snippets = parseSnippetFile(snippetPath);

	return {
		snippets,
		snippetPath,
	};
}
