/**
 * Filesystem module exports.
 */

export {
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

export {
  type WalkEntry,
  type WalkCallback,
  walkDirectory,
  collectFiles,
  copyDirectory,
} from "./walk.js";
