/**
 * @quarto-wizard/core - Core library for Quarto extension management.
 *
 * This library provides functionality for:
 * - Extension discovery (filesystem scanning)
 * - Manifest parsing (_extension.yml)
 * - Registry integration (remote extension discovery)
 * - GitHub integration (downloading extensions)
 * - Extension lifecycle (install, update, remove)
 */

// Type exports
export * from "./types/index.js";

// Error exports
export {
	QuartoWizardError,
	ExtensionError,
	AuthenticationError,
	RepositoryNotFoundError,
	NetworkError,
	SecurityError,
	ManifestError,
	VersionError,
	CancellationError,
	isQuartoWizardError,
	isCancellationError,
	getErrorMessage,
	wrapError,
} from "./errors.js";

// Filesystem exports
export * from "./filesystem/index.js";

// Registry exports
export * from "./registry/index.js";

// GitHub exports
export * from "./github/index.js";

// Archive exports
export * from "./archive/index.js";

// Operations exports
export * from "./operations/index.js";

// Proxy exports
export * from "./proxy/index.js";
