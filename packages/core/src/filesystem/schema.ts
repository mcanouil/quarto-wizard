/**
 * @title Schema Parsing Module
 * @description Schema parsing for _schema.yml, _schema.yaml, and _schema.json files.
 *
 * Provides functions to find, parse, and read Quarto extension schemas.
 *
 * @module filesystem
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import type { ExtensionSchema, RawSchema } from "../types/schema.js";
import { normaliseSchema, SUPPORTED_SCHEMA_VERSIONS } from "../types/schema.js";
import { SchemaError } from "../errors.js";

/** Supported schema file names, ordered by precedence (JSON first). */
export const SCHEMA_FILENAMES = ["_schema.json", "_schema.yml", "_schema.yaml"] as const;

/**
 * Result of reading a schema file.
 */
export interface SchemaReadResult {
	/** Parsed schema data. */
	schema: ExtensionSchema;
	/** Full path to the schema file. */
	schemaPath: string;
	/** Filename used (e.g., "_schema.yml" or "_schema.json"). */
	filename: string;
}

/**
 * Find the schema file in a directory.
 *
 * @param directory - Directory to search
 * @returns Path to schema file or null if not found
 */
export function findSchemaFile(directory: string): string | null {
	for (const filename of SCHEMA_FILENAMES) {
		const schemaPath = path.join(directory, filename);
		if (fs.existsSync(schemaPath)) {
			return schemaPath;
		}
	}
	return null;
}

/**
 * Detect the schema format from a file path based on its extension.
 */
function detectFormat(filePath: string): "json" | "yaml" {
	return filePath.endsWith(".json") ? "json" : "yaml";
}

/**
 * Parse a schema file from a path.
 *
 * @param schemaPath - Full path to the schema file
 * @returns Parsed schema
 * @throws SchemaError if parsing fails
 */
export function parseSchemaFile(schemaPath: string): ExtensionSchema {
	try {
		const content = fs.readFileSync(schemaPath, "utf-8");
		return parseSchemaContent(content, schemaPath, detectFormat(schemaPath));
	} catch (error) {
		if (error instanceof SchemaError) {
			throw error;
		}
		throw new SchemaError(`Failed to read schema file: ${error instanceof Error ? error.message : String(error)}`, {
			schemaPath,
			cause: error,
		});
	}
}

/**
 * Parse schema content from a YAML or JSON string.
 *
 * @param content - Schema content (YAML or JSON)
 * @param sourcePath - Source path for error messages (optional)
 * @param format - Content format: "yaml" (default) or "json"
 * @returns Parsed schema
 * @throws SchemaError if parsing fails
 */
export function parseSchemaContent(
	content: string,
	sourcePath?: string,
	format: "yaml" | "json" = "yaml",
): ExtensionSchema {
	try {
		const raw = (format === "json" ? JSON.parse(content) : yaml.load(content)) as RawSchema;

		if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
			throw new SchemaError("Schema file is empty or invalid", { schemaPath: sourcePath });
		}

		const schema = normaliseSchema(raw);

		// Warn on unrecognised $schema versions (do not reject for forward-compatibility).
		if (schema.$schema && !SUPPORTED_SCHEMA_VERSIONS.has(schema.$schema)) {
			const known = [...SUPPORTED_SCHEMA_VERSIONS].join(", ");
			 
			console.warn(
				`Unknown schema version "${schema.$schema}" in ${sourcePath ?? "schema"}. Known versions: ${known}.`,
			);
		}

		return schema;
	} catch (error) {
		if (error instanceof SchemaError) {
			throw error;
		}
		throw new SchemaError(`Failed to parse schema: ${error instanceof Error ? error.message : String(error)}`, {
			schemaPath: sourcePath,
			cause: error,
		});
	}
}

/**
 * Read a schema from a directory.
 *
 * @param directory - Directory containing the schema
 * @returns SchemaReadResult or null if no schema found
 */
export function readSchema(directory: string): SchemaReadResult | null {
	const schemaPath = findSchemaFile(directory);

	if (!schemaPath) {
		return null;
	}

	const schema = parseSchemaFile(schemaPath);
	const filename = path.basename(schemaPath);

	return {
		schema,
		schemaPath,
		filename,
	};
}
