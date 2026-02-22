/**
 * @title Errors
 * @description Error types for @quarto-wizard/snippets.
 *
 * @module errors
 */

/**
 * Error when parsing a snippet file fails.
 */
export class SnippetError extends Error {
	/** Error code for programmatic handling. */
	readonly code = "SNIPPET_ERROR";
	/** Path to the snippet file. */
	readonly snippetPath?: string;
	/** Suggestion for how to resolve the error. */
	readonly suggestion?: string;

	constructor(message: string, options?: { snippetPath?: string; cause?: unknown }) {
		super(message, { cause: options?.cause });
		this.name = "SnippetError";
		this.snippetPath = options?.snippetPath;
		this.suggestion = options?.snippetPath ? `Check the snippet file at: ${options.snippetPath}` : undefined;

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
