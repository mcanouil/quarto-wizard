/**
 * @title Errors
 * @description Error types for @quarto-wizard/core.
 *
 * Provides typed error classes for handling various failure scenarios.
 *
 * @module errors
 */

/**
 * Options for constructing a QuartoWizardError.
 */
export interface QuartoWizardErrorOptions {
	/** Suggestion for how to resolve the error. */
	suggestion?: string;
	/** Original error that caused this error. */
	cause?: unknown;
}

/**
 * Base error class for all Quarto Wizard errors.
 */
export class QuartoWizardError extends Error {
	/** Error code for programmatic handling. */
	readonly code: string;
	/** Suggestion for how to resolve the error. */
	readonly suggestion?: string;

	constructor(message: string, code: string, options?: QuartoWizardErrorOptions) {
		super(message, { cause: options?.cause });
		this.name = "QuartoWizardError";
		this.code = code;
		this.suggestion = options?.suggestion;

		// Maintain proper stack trace in V8 environments
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
 * Error related to extension operations (install, update, remove).
 */
export class ExtensionError extends QuartoWizardError {
	constructor(message: string, options?: QuartoWizardErrorOptions) {
		super(message, "EXTENSION_ERROR", options);
		this.name = "ExtensionError";
	}
}

/**
 * Error when authentication is required or failed.
 */
export class AuthenticationError extends QuartoWizardError {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, "AUTH_ERROR", {
			suggestion: "Provide a GitHub token via GITHUB_TOKEN environment variable or auth option",
			cause: options?.cause,
		});
		this.name = "AuthenticationError";
	}
}

/**
 * Error when a repository or resource is not found.
 */
export class RepositoryNotFoundError extends QuartoWizardError {
	constructor(message: string, options?: { suggestion?: string; cause?: unknown }) {
		super(message, "NOT_FOUND", {
			suggestion: options?.suggestion ?? "Check if the repository exists and you have access to it",
			cause: options?.cause,
		});
		this.name = "RepositoryNotFoundError";
	}
}

/**
 * Error related to network operations.
 */
export class NetworkError extends QuartoWizardError {
	/** HTTP status code if available. */
	readonly statusCode?: number;

	constructor(message: string, options?: { statusCode?: number; cause?: unknown }) {
		super(message, "NETWORK_ERROR", {
			suggestion: "Check your internet connection and try again",
			cause: options?.cause,
		});
		this.name = "NetworkError";
		this.statusCode = options?.statusCode;
	}
}

/**
 * Error related to security issues (path traversal, zip bombs, etc.).
 */
export class SecurityError extends QuartoWizardError {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, "SECURITY_ERROR", { cause: options?.cause });
		this.name = "SecurityError";
	}
}

/**
 * Error when parsing a manifest file fails.
 */
export class ManifestError extends QuartoWizardError {
	/** Path to the manifest file. */
	readonly manifestPath?: string;

	constructor(message: string, options?: { manifestPath?: string; cause?: unknown }) {
		super(message, "MANIFEST_ERROR", {
			suggestion: options?.manifestPath ? `Check the manifest file at: ${options.manifestPath}` : undefined,
			cause: options?.cause,
		});
		this.name = "ManifestError";
		this.manifestPath = options?.manifestPath;
	}
}

/**
 * Error when a version cannot be resolved.
 */
export class VersionError extends QuartoWizardError {
	constructor(message: string, options?: QuartoWizardErrorOptions) {
		super(message, "VERSION_ERROR", options);
		this.name = "VersionError";
	}
}

/**
 * Error thrown when an operation is cancelled by the user.
 *
 * Use this instead of throwing a generic Error with a cancellation message,
 * so callers can reliably detect cancellation via instanceof rather than
 * fragile string matching.
 */
export class CancellationError extends QuartoWizardError {
	constructor(message = "Operation cancelled by the user.") {
		super(message, "CANCELLED");
		this.name = "CancellationError";
	}
}

/**
 * Check if an error is a CancellationError.
 */
export function isCancellationError(error: unknown): error is CancellationError {
	return error instanceof CancellationError;
}

/**
 * Check if an error is a QuartoWizardError.
 */
export function isQuartoWizardError(error: unknown): error is QuartoWizardError {
	return error instanceof QuartoWizardError;
}

/**
 * Wrap an unknown error as a QuartoWizardError.
 */
export function wrapError(error: unknown, context?: string): QuartoWizardError {
	if (isQuartoWizardError(error)) {
		return error;
	}

	const message = error instanceof Error ? error.message : String(error);
	const contextPrefix = context ? `${context}: ` : "";

	return new QuartoWizardError(`${contextPrefix}${message}`, "UNKNOWN_ERROR");
}
