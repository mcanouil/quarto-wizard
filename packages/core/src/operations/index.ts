/**
 * Operations module exports.
 */

export {
  type InstallSource,
  type InstallPhase,
  type InstallProgressCallback,
  type InstallOptions,
  type InstallResult,
  parseInstallSource,
  formatInstallSource,
  install,
} from "./install.js";

export {
  type UpdateInfo,
  type UpdateCheckOptions,
  type UpdateOptions,
  type UpdateResult,
  checkForUpdates,
  applyUpdates,
  update,
} from "./update.js";

export {
  type RemoveOptions,
  type RemoveResult,
  remove,
  removeMultiple,
} from "./remove.js";

export {
  type OverwriteCallback,
  type OverwriteBatchResult,
  type OverwriteBatchCallback,
  type FileSelectionResult,
  type FileSelectionCallback,
  type UseOptions,
  type UseResult,
  use,
  getTemplateFiles,
} from "./use.js";
