/**
 * Archive module exports.
 */

export { checkPathTraversal, checkSymlinkTarget, formatSize, validateUrlProtocol } from "./security.js";

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
