/**
 * Archive module exports.
 */

export { type ZipExtractOptions, extractZip } from "./zip.js";

export { type TarExtractOptions, extractTar } from "./tar.js";

export {
	type ExtractOptions,
	type ExtractResult,
	type DiscoveredExtension,
	detectArchiveFormat,
	extractArchive,
	findExtensionRoot,
	findAllExtensionRoots,
	cleanupExtraction,
} from "./extract.js";
