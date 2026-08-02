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
	updateManifestSource,
} from "./manifest.js";

export {
	type InstalledExtension,
	type DiscoveryOptions,
	EXTENSIONS_DIR,
	getExtensionsDir,
	hasExtensionsDir,
	discoverInstalledExtensions,
	discoverInstalledExtensionsSync,
	findInstalledExtension,
	getExtensionInstallPath,
} from "./discovery.js";

export {
	type WalkEntry,
	type WalkCallback,
	walkDirectory,
	collectFiles,
	copyDirectory,
	pathExists,
	toRelativePosixPath,
	isInside,
} from "./walk.js";

export { QUARTOIGNORE_FILENAME, readQuartoIgnore, isQuartoIgnored, quartoIgnoreGlobs } from "./quartoignore.js";
