/**
 * @title Errors
 * @description Error types for @quarto-wizard/schema.
 *
 * @module errors
 */

/**
 * Error when parsing a schema file fails.
 */
export class SchemaError extends Error {
	/** Error code for programmatic handling. */
	readonly code = "SCHEMA_ERROR";
	/** Path to the schema file. */
	readonly schemaPath?: string;
	/** Suggestion for how to resolve the error. */
	readonly suggestion?: string;

	constructor(message: string, options?: { schemaPath?: string; cause?: unknown }) {
		super(message, { cause: options?.cause });
		this.name = "SchemaError";
		this.schemaPath = options?.schemaPath;
		this.suggestion = options?.schemaPath ? `Check the schema file at: ${options.schemaPath}` : undefined;

		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, this.constructor);
		}
	}

	/**
	 * Format the error for display.
	 */
	format(): string {
		let result = `${this.name}: ${this.message}`;
		if (this.suggestion) {
			result += `\n  Suggestion: ${this.suggestion}`;
		}
		return result;
	}
}

/**
 * Extract a human-readable message from an unknown error value.
 */
export function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
