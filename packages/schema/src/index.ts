/**
 * @quarto-wizard/schema - Schema types, parsing, validation, and caching
 * for Quarto extension schema files.
 *
 * This library provides functionality for:
 * - Schema type definitions (FieldDescriptor, ExtensionSchema, etc.)
 * - Schema file parsing (_schema.yml, _schema.yaml, _schema.json)
 * - Schema validation (structure and semantic checks)
 * - Schema caching (in-memory lazy-loading cache)
 */

// Error exports
export { SchemaError } from "./errors.js";

// Type exports
export * from "./types/index.js";

// Filesystem exports
export * from "./filesystem/index.js";

// Validation exports
export * from "./validation/index.js";
