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
	parseVersionSpec,
	parseExtensionRef,
	formatExtensionRef,
} from "./extension.js";

export {
	type Contributes,
	type ExtensionManifest,
	type RawManifest,
	type SourceType,
	getEffectiveSourceType,
	getExtensionTypes,
	inferSourceType,
	normaliseManifest,
	splitSourceRef,
} from "./manifest.js";

export {
	type RegistryEntry,
	type Registry,
	type RawRegistryEntry,
	parseRegistryEntry,
	parseRegistry,
} from "./registry.js";

export { type HttpHeader, type AuthConfig, type AuthConfigOptions, createAuthConfig, getAuthHeaders } from "./auth.js";
