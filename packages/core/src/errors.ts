/**
 * @title Errors
 * @description Error types for @quarto-wizard/core.
 *
 * Provides typed error classes for handling various failure scenarios.
 *
 * @module errors
 */

/**
 * Base error class for all Quarto Wizard errors.
 */
export class QuartoWizardError extends Error {
	/** Error code for programmatic handling. */
	readonly code: string;
	/** Suggestion for how to resolve the error. */
	readonly suggestion?: string;

	constructor(message: string, code: string, suggestion?: string) {
		super(message);
		this.name = "QuartoWizardError";
		this.code = code;
		this.suggestion = suggestion;

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
	constructor(message: string, suggestion?: string) {
		super(message, "EXTENSION_ERROR", suggestion);
		this.name = "ExtensionError";
	}
}

/**
 * Error when authentication is required or failed.
 */
export class AuthenticationError extends QuartoWizardError {
	constructor(message: string) {
		super(message, "AUTH_ERROR", "Provide a GitHub token via GITHUB_TOKEN environment variable or auth option");
		this.name = "AuthenticationError";
	}
}

/**
 * Error when a repository or resource is not found.
 */
export class RepositoryNotFoundError extends QuartoWizardError {
	constructor(message: string, hint?: string) {
		super(message, "NOT_FOUND", hint ?? "Check if the repository exists and you have access to it");
		this.name = "RepositoryNotFoundError";
	}
}

/**
 * Error related to network operations.
 */
export class NetworkError extends QuartoWizardError {
	/** HTTP status code if available. */
	readonly statusCode?: number;

	constructor(message: string, statusCode?: number) {
		super(message, "NETWORK_ERROR", "Check your internet connection and try again");
		this.name = "NetworkError";
		this.statusCode = statusCode;
	}
}

/**
 * Error related to security issues (path traversal, zip bombs, etc.).
 */
export class SecurityError extends QuartoWizardError {
	constructor(message: string) {
		super(message, "SECURITY_ERROR");
		this.name = "SecurityError";
	}
}

/**
 * Error when parsing a manifest file fails.
 */
export class ManifestError extends QuartoWizardError {
	/** Path to the manifest file. */
	readonly manifestPath?: string;

	constructor(message: string, manifestPath?: string) {
		super(message, "MANIFEST_ERROR", manifestPath ? `Check the manifest file at: ${manifestPath}` : undefined);
		this.name = "ManifestError";
		this.manifestPath = manifestPath;
	}
}

/**
 * Error when a version cannot be resolved.
 */
export class VersionError extends QuartoWizardError {
	constructor(message: string, suggestion?: string) {
		super(message, "VERSION_ERROR", suggestion);
		this.name = "VersionError";
	}
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
