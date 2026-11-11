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
} from "./manifest.js";

export {
	type InstalledExtension,
	type DiscoveryOptions,
	EXTENSIONS_DIR,
	NO_SOURCE_RECORD,
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

export {
	SOURCE_RECORD_FILENAME,
	SOURCE_RECORD_VERSION,
	type SourceRecordKind,
	type SourceRecord,
	type SourceRecordData,
	type SourceRecordReadResult,
	type LocalEdit,
	type InstalledState,
	type InstallAction,
	hashExtensionFiles,
	readSourceRecord,
	readSourceRecordKeys,
	writeSourceRecord,
	formatLocalEdit,
	getInstalledState,
	compareInstallAction,
} from "./sourceRecord.js";

export {
	PROJECT_FOLDER_MAX_DEPTH,
	type EmbeddingParent,
	type DiscoveredProject,
	type ProjectDiscoveryOptions,
	discoverProjectDirs,
} from "./projects.js";
