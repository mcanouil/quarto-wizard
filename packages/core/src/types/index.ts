/**
 * Public type exports for @quarto-wizard/core.
 */

export {
	type ExtensionId,
	type ExtensionRef,
	type VersionSpec,
	type ExtensionType,
	parseExtensionId,
	formatExtensionId,
	isSameExtensionId,
	parseVersionSpec,
	parseExtensionRef,
	formatExtensionRef,
} from "./extension.js";

export {
	type Contributes,
	type ExtensionManifest,
	type RawManifest,
	type SourceType,
	type GitHubLocator,
	formatGitHubLocator,
	getEffectiveSourceType,
	getExtensionTypes,
	inferSourceType,
	normaliseManifest,
	parseGitHubLocator,
	tryParseGitHubLocator,
	splitSourceRef,
	extractCommitFromSource,
	recordedCommit,
} from "./manifest.js";

export {
	type RegistryEntry,
	type Registry,
	type RawRegistryEntry,
	parseRegistryEntry,
	parseRegistry,
} from "./registry.js";

export { type HttpHeader, type AuthConfig, type AuthConfigOptions, createAuthConfig, getAuthHeaders } from "./auth.js";
