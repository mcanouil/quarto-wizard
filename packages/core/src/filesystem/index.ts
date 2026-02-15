/**
 * Filesystem module exports.
 */

export {
	MANIFEST_FILENAMES,
	type ManifestReadResult,
	findManifestFile,
	parseManifestFile,
	parseManifestContent,
	readManifest,
	hasManifest,
	writeManifest,
	updateManifestSource,
} from "./manifest.js";

export {
	type InstalledExtension,
	type DiscoveryOptions,
	getExtensionsDir,
	hasExtensionsDir,
	discoverInstalledExtensions,
	discoverInstalledExtensionsSync,
	findInstalledExtension,
	getExtensionInstallPath,
} from "./discovery.js";

export { type WalkEntry, type WalkCallback, walkDirectory, collectFiles, copyDirectory, pathExists } from "./walk.js";

export {
	SCHEMA_FILENAMES,
	type SchemaReadResult,
	findSchemaFile,
	parseSchemaFile,
	parseSchemaContent,
	readSchema,
} from "./schema.js";

export { SchemaCache } from "./schema-cache.js";
