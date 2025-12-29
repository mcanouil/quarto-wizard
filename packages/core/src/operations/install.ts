/**
 * Extension installation operations.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { AuthConfig } from "../types/auth.js";
import type { ExtensionId, VersionSpec } from "../types/extension.js";
import type { ExtensionManifest } from "../types/manifest.js";
import { parseExtensionId, parseExtensionRef } from "../types/extension.js";
import { ExtensionError } from "../errors.js";
import {
  getExtensionInstallPath,
  type InstalledExtension,
} from "../filesystem/discovery.js";
import { copyDirectory } from "../filesystem/walk.js";
import { readManifest, updateManifestSource } from "../filesystem/manifest.js";
import { downloadGitHubArchive, downloadFromUrl } from "../github/download.js";
import {
  extractArchive,
  findExtensionRoot,
  cleanupExtraction,
} from "../archive/extract.js";

/**
 * Source for extension installation.
 */
export type InstallSource =
  | { type: "github"; owner: string; repo: string; version: VersionSpec }
  | { type: "url"; url: string }
  | { type: "local"; path: string };

/**
 * Progress phases for installation.
 */
export type InstallPhase =
  | "resolving"
  | "downloading"
  | "extracting"
  | "installing"
  | "finalizing";

/**
 * Progress callback for installation.
 */
export type InstallProgressCallback = (progress: {
  phase: InstallPhase;
  message: string;
  percentage?: number;
}) => void;

/**
 * Options for extension installation.
 */
export interface InstallOptions {
  /** Project directory. */
  projectDir: string;
  /** Authentication configuration. */
  auth?: AuthConfig;
  /** Progress callback. */
  onProgress?: InstallProgressCallback;
  /** Force reinstall if already installed. */
  force?: boolean;
  /** Keep source directory after installation (for template copying). */
  keepSourceDir?: boolean;
}

/**
 * Result of installation.
 */
export interface InstallResult {
  /** Whether installation succeeded. */
  success: boolean;
  /** Installed extension details. */
  extension: InstalledExtension;
  /** Files created during installation. */
  filesCreated: string[];
  /** Source string for the manifest. */
  source: string;
  /** Path to extracted source root (only set if keepSourceDir was true). */
  sourceRoot?: string;
}

/**
 * Parse an install source string.
 *
 * @param input - Source string (GitHub ref, URL, or local path)
 * @returns Parsed InstallSource
 */
export function parseInstallSource(input: string): InstallSource {
  if (input.startsWith("http://") || input.startsWith("https://")) {
    return { type: "url", url: input };
  }

  if (input.startsWith("/") || input.startsWith("./") || input.startsWith("../")) {
    return { type: "local", path: input };
  }

  if (fs.existsSync(input)) {
    return { type: "local", path: input };
  }

  const ref = parseExtensionRef(input);

  if (!ref.id.owner) {
    throw new ExtensionError(
      `Invalid extension reference: "${input}"`,
      'Use format "owner/repo" or "owner/repo@version"'
    );
  }

  return {
    type: "github",
    owner: ref.id.owner,
    repo: ref.id.name,
    version: ref.version,
  };
}

/**
 * Format an install source as a string.
 */
export function formatInstallSource(source: InstallSource): string {
  switch (source.type) {
    case "github": {
      const base = `${source.owner}/${source.repo}`;
      if (source.version.type === "latest") {
        return base;
      }
      if (source.version.type === "tag") {
        return `${base}@${source.version.tag}`;
      }
      if (source.version.type === "branch") {
        return `${base}@${source.version.branch}`;
      }
      if (source.version.type === "exact") {
        return `${base}@v${source.version.version}`;
      }
      return base;
    }
    case "url":
      return source.url;
    case "local":
      return source.path;
  }
}

/**
 * Install an extension from a source.
 *
 * @param source - Installation source
 * @param options - Installation options
 * @returns Installation result
 */
export async function install(
  source: InstallSource,
  options: InstallOptions
): Promise<InstallResult> {
  const { projectDir, auth, onProgress, force = false, keepSourceDir = false } = options;

  let archivePath: string | undefined;
  let extractDir: string | undefined;
  let tagName: string | undefined;
  let repoRoot: string | undefined;

  try {
    onProgress?.({ phase: "resolving", message: "Resolving extension source..." });

    if (source.type === "github") {
      const result = await downloadGitHubArchive(
        source.owner,
        source.repo,
        source.version,
        {
          auth,
          onProgress: (p) => {
            onProgress?.({
              phase: p.phase === "resolving" ? "resolving" : "downloading",
              message: p.message,
              percentage: p.percentage,
            });
          },
        }
      );
      archivePath = result.archivePath;
      tagName = result.tagName;
    } else if (source.type === "url") {
      onProgress?.({ phase: "downloading", message: "Downloading archive..." });
      archivePath = await downloadFromUrl(source.url, { auth });
    } else {
      archivePath = source.path;
    }

    onProgress?.({ phase: "extracting", message: "Extracting archive..." });

    if (source.type === "local" && fs.statSync(archivePath).isDirectory()) {
      extractDir = archivePath;
    } else {
      const extracted = await extractArchive(archivePath);
      extractDir = extracted.extractDir;
    }

    const extensionRoot = await findExtensionRoot(extractDir);

    if (!extensionRoot) {
      throw new ExtensionError(
        "No _extension.yml found in archive",
        "Ensure the archive contains a valid Quarto extension"
      );
    }

    // Compute repo root from extensionRoot
    // extensionRoot is like /tmp/xxx/owner-repo-tag/_extensions/owner/name
    // Repo root is the parent of _extensions (e.g., /tmp/xxx/owner-repo-tag)
    const extensionRootParts = extensionRoot.split(path.sep);
    const extensionsIndex = extensionRootParts.lastIndexOf("_extensions");
    if (extensionsIndex >= 0) {
      repoRoot = extensionRootParts.slice(0, extensionsIndex).join(path.sep) || "/";
    } else {
      // No _extensions in path, extension is at repo root level
      repoRoot = path.dirname(extensionRoot);
    }

    const manifestResult = readManifest(extensionRoot);

    if (!manifestResult) {
      throw new ExtensionError("Failed to read extension manifest");
    }

    onProgress?.({ phase: "installing", message: "Installing extension..." });

    const extensionId = resolveExtensionId(source, extensionRoot, manifestResult.manifest);
    const targetDir = getExtensionInstallPath(projectDir, extensionId);

    if (fs.existsSync(targetDir)) {
      if (!force) {
        throw new ExtensionError(
          `Extension already installed: ${extensionId.owner}/${extensionId.name}`,
          "Use force option to reinstall"
        );
      }
      await fs.promises.rm(targetDir, { recursive: true, force: true });
    }

    const filesCreated = await copyExtension(extensionRoot, targetDir);

    onProgress?.({ phase: "finalizing", message: "Updating manifest..." });

    const sourceString = formatSourceString(source, tagName);
    const manifestPath = path.join(targetDir, manifestResult.filename);
    updateManifestSource(manifestPath, sourceString);

    const finalManifest = readManifest(targetDir);

    return {
      success: true,
      extension: {
        id: extensionId,
        manifest: finalManifest?.manifest ?? manifestResult.manifest,
        manifestPath,
        directory: targetDir,
      },
      filesCreated,
      source: sourceString,
      sourceRoot: keepSourceDir ? repoRoot : undefined,
    };
  } finally {
    if (archivePath && source.type !== "local" && fs.existsSync(archivePath)) {
      await fs.promises.unlink(archivePath).catch(() => {});
    }

    // Only cleanup extraction directory if keepSourceDir is false
    if (extractDir && source.type !== "local" && !keepSourceDir) {
      await cleanupExtraction(extractDir);
    }
  }
}

/**
 * Resolve extension ID from source and manifest.
 */
function resolveExtensionId(
  source: InstallSource,
  extensionRoot: string,
  manifest: ExtensionManifest
): ExtensionId {
  if (source.type === "github") {
    return { owner: source.owner, name: source.repo };
  }

  const dirName = path.basename(extensionRoot);
  const parentName = path.basename(path.dirname(extensionRoot));

  if (parentName && !parentName.startsWith(".") && !parentName.includes("-")) {
    return { owner: parentName, name: dirName };
  }

  const title = manifest.title.toLowerCase().replace(/[^a-z0-9-]/g, "-");

  return { owner: "local", name: title || dirName };
}

/**
 * Format source string for manifest.
 */
function formatSourceString(source: InstallSource, tagName?: string): string {
  if (source.type === "github") {
    const base = `${source.owner}/${source.repo}`;
    return tagName && tagName !== "HEAD" ? `${base}@${tagName}` : base;
  }

  return formatInstallSource(source);
}

/**
 * Copy extension files to target directory.
 */
async function copyExtension(
  sourceDir: string,
  targetDir: string
): Promise<string[]> {
  return copyDirectory(sourceDir, targetDir);
}
