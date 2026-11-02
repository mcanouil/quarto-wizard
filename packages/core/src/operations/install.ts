/**
 * @title Extension Installation Module
 * @description Extension installation operations.
 *
 * Handles installing extensions from GitHub, URLs, and local sources.
 *
 * @module operations
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { AuthConfig } from "../types/auth.js";
import type { ExtensionId, VersionSpec } from "../types/extension.js";
import type { ExtensionManifest, InstallTrack, SourceType } from "../types/manifest.js";
import {
	extractCommitFromSource,
	formatGitHubLocator,
	parseGitHubLocator,
	recordedCommit,
	shortCommit,
	splitSourceRef,
} from "../types/manifest.js";
import { formatExtensionId, isSameExtensionId, parseExtensionRef } from "../types/extension.js";
import { ExtensionError, LocalEditsError, ManifestError, getErrorMessage } from "../errors.js";
import {
	NO_SOURCE_RECORD,
	getExtensionInstallPath,
	toInstalledExtension,
	type InstalledExtension,
} from "../filesystem/discovery.js";
import { copyDirectory, collectFiles, isInside, pathExists, toRelativePosixPath } from "../filesystem/walk.js";
import { readManifest, type ManifestReadResult } from "../filesystem/manifest.js";
import {
	compareInstallAction,
	getInstalledState,
	readSourceRecord,
	writeSourceRecord,
	type SourceRecord,
	type SourceRecordData,
	type SourceRecordReadResult,
} from "../filesystem/sourceRecord.js";
import { downloadGitHubArchive, downloadFromUrl } from "../github/download.js";
import {
	extractArchive,
	readArchiveExtensions,
	resolveSourceRoot,
	cleanupExtraction,
	type DiscoveredExtension,
} from "../archive/extract.js";
import { fetchRegistry, type RegistryOptions } from "../registry/fetcher.js";
import { lookupRegistryEntry } from "../registry/search.js";

/**
 * Source for extension installation.
 */
export type InstallSource =
	| { type: "github"; owner: string; repo: string; subdirectory?: string; version: VersionSpec }
	| { type: "url"; url: string }
	| { type: "local"; path: string };

/**
 * Progress phases for installation.
 */
export type InstallPhase = "resolving" | "downloading" | "extracting" | "installing" | "finalizing";

/**
 * Progress callback for installation.
 */
export type InstallProgressCallback = (progress: { phase: InstallPhase; message: string; percentage?: number }) => void;

/**
 * Callback for selecting which extension(s) to install from a multi-extension source.
 * Called when a repository contains multiple extensions.
 *
 * @param extensions - Array of discovered extensions in the source
 * @returns Selected extensions to install, or null to cancel
 */
export type ExtensionSelectionCallback = (extensions: DiscoveredExtension[]) => Promise<DiscoveredExtension[] | null>;

/**
 * Callback for confirming overwrite when extension already exists.
 *
 * @param extension - The extension that already exists
 * @returns True to overwrite, false to skip/cancel
 */
export type ConfirmOverwriteCallback = (extension: DiscoveredExtension) => Promise<boolean>;

/**
 * Callback for validating Quarto version requirement.
 *
 * @param required - The required Quarto version string from the manifest
 * @param manifest - The extension manifest
 * @returns True to proceed with installation, false to cancel
 */
export type ValidateQuartoVersionCallback = (required: string, manifest: ExtensionManifest) => Promise<boolean>;

/**
 * Options for extension installation.
 */
export interface InstallOptions extends RegistryOptions {
	/** Project directory. */
	projectDir: string;
	/** Authentication configuration. */
	auth?: AuthConfig;
	/** Progress callback. */
	onProgress?: InstallProgressCallback;
	/**
	 * Replace an installed copy even when it has local changes or is at the same version.
	 * Cannot be combined with `dryRun`.
	 */
	force?: boolean;
	/**
	 * Replace an installed copy at the same version, as an update does.
	 * Unlike `force`, a copy with local changes is still refused.
	 * Updates set it, because a new tag or commit can keep the manifest version.
	 */
	replaceSameVersion?: boolean;
	/** AbortSignal for cancellation. */
	signal?: AbortSignal;
	/** Keep source directory after installation (for template copying). */
	keepSourceDir?: boolean;
	/** Dry run mode - resolve without installing. */
	dryRun?: boolean;
	/**
	 * Source to write in the install record in place of the typed form of `source`.
	 * The record `ref` is the text after its last `@`.
	 * An update sets it to install an exact tag or commit while the record keeps the source it follows.
	 */
	recordSource?: string;
	/**
	 * What updates of a GitHub install follow: the latest tag (default) or the head of a branch.
	 * It applies to a source without a ref, which installs the latest tag or the head of the
	 * default branch, and to the record when `recordSource` is set.
	 * A source with a ref records `branch` for a branch and `tag` otherwise.
	 */
	track?: InstallTrack;
	/**
	 * Callback for selecting extensions when source contains multiple.
	 * If not provided and source contains multiple extensions, the first one is installed (legacy behaviour).
	 */
	selectExtension?: ExtensionSelectionCallback;
	/**
	 * Identifier of the one extension to install from the source.
	 * Only the discovered extension with this owner and name (ignoring case) is kept, however many the source holds.
	 * A null owner matches any owner and installs into `_extensions/<name>`, so an extension installed without an owner is replaced in place.
	 * Installation fails before anything is written when none matches.
	 * When set, `selectExtension` is not called.
	 */
	expectedExtensionId?: ExtensionId;
	/**
	 * Callback for confirming overwrite when extension already exists.
	 * Called before an installed copy is replaced. If not provided, overwrites silently.
	 * Return true to overwrite, false to cancel.
	 */
	confirmOverwrite?: ConfirmOverwriteCallback;
	/**
	 * Callback for validating Quarto version requirement.
	 * Called when the manifest specifies a quartoRequired field.
	 * Return true to proceed, false to cancel.
	 */
	validateQuartoVersion?: ValidateQuartoVersionCallback;
	/**
	 * Source type of the install.
	 * Use "registry" when installing via the extension registry: the install record of a GitHub
	 * source then holds `source-type: registry` under its `quarto-wizard` key.
	 */
	sourceType?: SourceType;
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
	/** Source written in the install record. */
	source: string;
	/** Source type of the installed extension, as discovery reports it. */
	sourceType?: SourceType;
	/**
	 * Data of the install record, written or, in dry run mode, to be written.
	 * Not set when the install was cancelled.
	 */
	recordData?: SourceRecordData;
	/** Path to extracted source root (only set if keepSourceDir was true). */
	sourceRoot?: string;
	/**
	 * Temporary extraction directory the caller must remove once it is done with
	 * `sourceRoot` (only set if keepSourceDir was true). Absent for a local directory
	 * source, which belongs to the user and must not be deleted.
	 */
	temporaryDir?: string;
	/** Whether this was a dry run (no files were actually created). */
	dryRun?: boolean;
	/** Files that would be created (only set in dry run mode). */
	wouldCreate?: string[];
	/** Whether the extension already exists (only relevant in dry run mode). */
	alreadyExists?: boolean;
	/** Additional extensions installed when multiple were selected (only set when using selectExtension callback). */
	additionalInstalls?: InstallResult[];
	/** Additional extensions that failed to install when multiple were selected. */
	additionalInstallFailures?: { extensionId: ExtensionId; error: string }[];
	/** Whether the installation was cancelled by user (via callbacks). */
	cancelled?: boolean;
	/** Whether the installed copy is at the same version and was left as it was. */
	unchanged?: boolean;
	/** Whether an installed copy without an install record was replaced. */
	replacedUntracked?: boolean;
}

/**
 * Parse an install source string.
 *
 * @param input - Source string (GitHub ref, URL, or local path)
 * @returns Parsed InstallSource
 *
 * @example
 * ```typescript
 * // GitHub reference
 * parseInstallSource("quarto-ext/fontawesome");
 * // { type: "github", owner: "quarto-ext", repo: "fontawesome", version: { type: "latest" } }
 *
 * // GitHub with version
 * parseInstallSource("quarto-ext/lightbox@v1.0.0");
 * // { type: "github", ..., version: { type: "tag", tag: "v1.0.0" } }
 *
 * // URL
 * parseInstallSource("https://example.com/ext.zip");
 * // { type: "url", url: "https://example.com/ext.zip" }
 *
 * // Local path
 * parseInstallSource("./my-extension");
 * // { type: "local", path: "./my-extension" }
 * ```
 */
export function parseInstallSource(
	input: string,
	checkExists: (path: string) => boolean = fs.existsSync,
): InstallSource {
	// HTTP/HTTPS URLs
	if (input.startsWith("http://") || input.startsWith("https://")) {
		return { type: "url", url: input };
	}

	// file:// protocol - use URL API for correct parsing when the URI has three
	// slashes (file:///path). For non-standard forms like file://./relative or
	// file://host/share, fall back to stripping the protocol prefix to preserve
	// backwards compatibility.
	if (input.startsWith("file:///")) {
		try {
			const fileUrl = new URL(input);
			return { type: "local", path: decodeURIComponent(fileUrl.pathname) };
		} catch {
			return { type: "local", path: input.slice(7) };
		}
	}
	if (input.startsWith("file://")) {
		return { type: "local", path: input.slice(7) };
	}

	// Unix absolute paths
	if (input.startsWith("/")) {
		return { type: "local", path: input };
	}

	// Unix relative paths
	if (input.startsWith("./") || input.startsWith("../")) {
		return { type: "local", path: input };
	}

	// Tilde expansion (Unix home directory)
	if (input.startsWith("~/")) {
		return { type: "local", path: input };
	}

	// Windows absolute paths (C:\, D:/, etc.)
	if (/^[a-zA-Z]:[/\\]/.test(input)) {
		return { type: "local", path: input };
	}

	// Windows UNC paths (\\server\share)
	if (input.startsWith("\\\\")) {
		return { type: "local", path: input };
	}

	// Archive file extensions (zip, tar.gz, tgz) - treat as local paths
	// This handles cases like "quarto-test-main.zip" or "subdirectory/extension.tar.gz"
	if (/\.(zip|tar\.gz|tgz)$/i.test(input)) {
		return { type: "local", path: input };
	}

	// Filesystem existence check (fallback)
	if (checkExists(input)) {
		return { type: "local", path: input };
	}

	const trimmed = input.trim();
	const { base } = splitSourceRef(trimmed);
	const locator = parseGitHubLocator(base);
	const ref = parseExtensionRef(locator ? `${locator.owner}/${locator.repo}${trimmed.slice(base.length)}` : input);

	if (!ref.id.owner) {
		throw new ExtensionError(`Invalid extension reference: "${input}"`, {
			suggestion: 'Use format "owner/repo" or "owner/repo@version"',
		});
	}

	return {
		type: "github",
		owner: ref.id.owner,
		repo: ref.id.name,
		...(locator?.subdirectory ? { subdirectory: locator.subdirectory } : {}),
		version: ref.version,
	};
}

/**
 * Format an install source as a string.
 */
export function formatInstallSource(source: InstallSource): string {
	switch (source.type) {
		case "github": {
			const base = formatGitHubLocator(source);
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
			if (source.version.type === "commit") {
				return `${base}@${source.version.commit.substring(0, 7)}`;
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
 *
 * @example
 * ```typescript
 * // Install from GitHub
 * const source = parseInstallSource("quarto-ext/fontawesome");
 * const result = await install(source, { projectDir: "." });
 * console.log(`Installed ${result.extension.id.name}`);
 *
 * // Install with progress tracking
 * await install(source, {
 *   projectDir: ".",
 *   onProgress: ({ phase, message }) => console.log(`[${phase}] ${message}`),
 * });
 * ```
 */
export async function install(source: InstallSource, options: InstallOptions): Promise<InstallResult> {
	const {
		projectDir,
		auth,
		onProgress,
		force = false,
		replaceSameVersion = false,
		keepSourceDir = false,
		dryRun = false,
		track = "tag",
		signal,
	} = options;

	if (dryRun && force) {
		throw new ExtensionError("The dryRun option cannot be combined with the force option");
	}

	let archivePath: string | undefined;
	let extractDir: string | undefined;
	// Set only when the extraction directory is a temporary one this call created, so a
	// local directory source is never mistaken for something safe to delete.
	let temporaryDir: string | undefined;
	let tagName: string | undefined;
	let repoRoot: string | undefined;
	let commitSha: string | undefined;
	let fromTag = false;

	try {
		onProgress?.({ phase: "resolving", message: "Resolving extension source..." });

		if (source.type === "github") {
			// Try to get registry info for default branch and latest commit
			let defaultBranch: string | undefined;
			let latestCommit: string | undefined;
			try {
				const registry = await fetchRegistry(options);
				const entry = lookupRegistryEntry(registry, `${source.owner}/${source.repo}`);
				if (entry) {
					defaultBranch = entry.defaultBranchRef ?? undefined;
					// The registry commit is the latest of the whole repository, not of the subdirectory.
					latestCommit = source.subdirectory ? undefined : (entry.latestCommit ?? undefined);
				}
			} catch {
				onProgress?.({ phase: "resolving", message: "Registry unavailable, using defaults." });
			}

			const result = await downloadGitHubArchive(source.owner, source.repo, source.version, {
				auth,
				defaultBranch,
				latestCommit,
				path: source.subdirectory,
				track,
				signal,
				onProgress: (p) => {
					onProgress?.({
						phase: p.phase === "resolving" ? "resolving" : "downloading",
						message: p.message,
						percentage: p.percentage,
					});
				},
			});
			archivePath = result.archivePath;
			tagName = result.tagName;
			commitSha = result.commitSha;
			fromTag = result.fromTag;
		} else if (source.type === "url") {
			onProgress?.({ phase: "downloading", message: "Downloading archive..." });
			archivePath = await downloadFromUrl(source.url, { auth, signal });
		} else {
			archivePath = source.path;
		}

		onProgress?.({ phase: "extracting", message: "Extracting archive..." });

		const archiveStats = await fs.promises.stat(archivePath);
		const recordData = sourceRecordData(source, {
			projectDir,
			recordSource: options.recordSource,
			sourceType: options.sourceType,
			track,
			tagName,
			fromTag,
			commitSha,
			isDirectory: archiveStats.isDirectory(),
		});
		if (source.type === "local" && archiveStats.isDirectory()) {
			extractDir = archivePath;
		} else {
			const extracted = await extractArchive(archivePath);
			extractDir = extracted.extractDir;
			temporaryDir = extracted.extractDir;
		}

		// Find all extensions in the archive, or only below the subdirectory the source names
		const searchRoot = source.type === "github" ? await resolveSourceRoot(extractDir, source, tagName) : extractDir;
		const { root: archiveRoot, extensions: allExtensions } = await readArchiveExtensions(searchRoot, {
			stripWrapper: searchRoot === extractDir,
		});

		if (allExtensions.length === 0) {
			throw new ExtensionError("No _extension.yml found in archive", {
				suggestion: "Ensure the archive contains a valid Quarto extension",
			});
		}

		applySourceOwner(allExtensions, source);

		const expected = options.expectedExtensionId;
		// An expected extension installed without an owner is replaced in that folder,
		// not copied next to it under the owner of the source.
		const offered = expected
			? allExtensions
					.filter((candidate) => isSameExtensionId(candidate.id, expected))
					.map((candidate) =>
						expected.owner === null ? { ...candidate, id: { ...candidate.id, owner: null } } : candidate,
					)
			: allExtensions;
		if (expected && offered.length === 0) {
			const location = formatResolvedSource(source, tagName, commitSha);
			throw new ExtensionError(`${formatExtensionId(expected)} is no longer in ${location}`);
		}

		// An expected extension is already the selection, so the user is not asked to choose.
		const selectedExtensions = await selectExtensionsFromSource(
			offered,
			expected ? undefined : options.selectExtension,
		);
		if (!selectedExtensions) {
			// User cancelled extension selection
			return {
				success: false,
				cancelled: true,
				extension: {
					id: offered[0].id,
					manifest: {} as ExtensionManifest,
					manifestPath: "",
					directory: "",
					...NO_SOURCE_RECORD,
				},
				filesCreated: [],
				source: recordData.source,
			};
		}

		// Use the first selected extension as the primary one
		const extensionRoot = selectedExtensions[0].path;

		// `readArchiveExtensions` already resolved the repository root, wrapper directory and
		// all, so take its answer rather than deriving a second one from the extension path.
		// Splitting on `_extensions` used to fall back to the parent directory for a
		// repository that is itself an extension, which pointed `sourceRoot` outside the
		// source and made template copying sweep up the parent's contents.
		repoRoot = archiveRoot;

		const manifestResult = readManifest(extensionRoot);

		if (!manifestResult) {
			throw new ExtensionError("Failed to read extension manifest");
		}

		// Validate Quarto version requirement if callback provided
		const quartoRequired = manifestResult.manifest.quartoRequired;
		if (quartoRequired && options.validateQuartoVersion) {
			const proceed = await options.validateQuartoVersion(quartoRequired, manifestResult.manifest);
			if (!proceed) {
				// User cancelled due to version mismatch
				const manifestPath = path.join(
					getExtensionInstallPath(projectDir, selectedExtensions[0].id),
					manifestResult.filename,
				);
				return {
					success: false,
					cancelled: true,
					extension: {
						id: selectedExtensions[0].id,
						manifest: manifestResult.manifest,
						manifestPath,
						directory: getExtensionInstallPath(projectDir, selectedExtensions[0].id),
						...NO_SOURCE_RECORD,
					},
					filesCreated: [],
					source: recordData.source,
				};
			}
		}

		onProgress?.({ phase: "installing", message: dryRun ? "Checking installation..." : "Installing extension..." });

		// Use the pre-computed ID from the discovered extension
		// This ensures consistency with additional extensions and respects the directory structure
		const extensionId: ExtensionId = selectedExtensions[0].id;
		const targetDir = getExtensionInstallPath(projectDir, extensionId);
		const alreadyExists = await pathExists(targetDir);

		// In dry-run mode, return what would happen without making changes
		if (dryRun) {
			// Collect files that would be created
			const wouldCreate = await collectExtensionFiles(extensionRoot);
			const manifestPath = path.join(targetDir, manifestResult.filename);

			return {
				success: true,
				extension: {
					id: extensionId,
					manifest: manifestResult.manifest,
					manifestPath,
					directory: targetDir,
					...NO_SOURCE_RECORD,
				},
				filesCreated: [],
				source: recordData.source,
				recordData,
				sourceRoot: keepSourceDir ? repoRoot : undefined,
				temporaryDir: keepSourceDir ? temporaryDir : undefined,
				dryRun: true,
				wouldCreate,
				alreadyExists,
			};
		}

		// Every selected extension is checked before the first is written, so a refusal writes nothing.
		const plans: ExtensionInstallPlan[] = [];
		for (const selected of selectedExtensions) {
			plans.push(await planExtensionInstall(selected, projectDir, recordData, force, replaceSameVersion));
		}

		const primary = await installPlannedExtension(plans[0], recordData, onProgress, options.confirmOverwrite);
		if (primary.cancelled) {
			return primary;
		}

		const additionalInstalls: InstallResult[] = [];
		const additionalInstallFailures: { extensionId: ExtensionId; error: string }[] = [];
		for (const plan of plans.slice(1)) {
			try {
				additionalInstalls.push(await installPlannedExtension(plan, recordData, onProgress, options.confirmOverwrite));
			} catch (error) {
				const message = getErrorMessage(error);
				additionalInstallFailures.push({ extensionId: plan.extension.id, error: message });
				onProgress?.({
					phase: "installing",
					message: `Failed to install additional extension ${formatExtensionId(plan.extension.id)}: ${message}`,
				});
			}
		}

		return {
			...primary,
			sourceRoot: keepSourceDir ? repoRoot : undefined,
			temporaryDir: keepSourceDir ? temporaryDir : undefined,
			additionalInstalls: additionalInstalls.length > 0 ? additionalInstalls : undefined,
			additionalInstallFailures: additionalInstallFailures.length > 0 ? additionalInstallFailures : undefined,
		};
	} finally {
		if (archivePath && source.type !== "local" && fs.existsSync(archivePath)) {
			// Cleanup is best-effort; archive deletion failure is non-critical since
			// it's in a temp directory that will be cleaned up eventually by the OS
			// eslint-disable-next-line @typescript-eslint/no-empty-function
			await fs.promises.unlink(archivePath).catch(() => {});
		}

		// Only the temporary directory is ours to remove, and only when the caller is not
		// going to keep reading from it.
		if (temporaryDir && !keepSourceDir) {
			await cleanupExtraction(temporaryDir);
		}
	}
}

/**
 * Resolve extension ID from source and manifest.
 *
 * @internal
 * Exported for testing purposes only. Not part of the public API.
 */
export function resolveExtensionId(source: InstallSource, extensionRoot: string): ExtensionId {
	if (source.type === "github") {
		return { owner: source.owner, name: source.repo };
	}

	// Normalise path separators for cross-platform compatibility
	// This handles both Unix (/) and Windows (\) paths
	const normalisedPath = extensionRoot.replace(/[/\\]/g, path.sep);
	const pathParts = normalisedPath.split(path.sep);
	const extensionsIndex = pathParts.lastIndexOf("_extensions");

	if (extensionsIndex >= 0) {
		const partsAfterExtensions = pathParts.slice(extensionsIndex + 1);

		if (partsAfterExtensions.length >= 2) {
			// Structure: _extensions/owner/name
			const owner = partsAfterExtensions[0];
			const name = partsAfterExtensions[partsAfterExtensions.length - 1];
			if (owner && !owner.startsWith(".")) {
				return { owner, name };
			}
		}

		// Structure: _extensions/name (no owner)
		if (partsAfterExtensions.length === 1) {
			const name = partsAfterExtensions[0];
			return { owner: null, name };
		}
	}

	// No _extensions in path - invalid extension source
	throw new ExtensionError("Invalid extension structure: missing _extensions directory", {
		suggestion: "Extension source must contain _extensions/owner/name or _extensions/name structure",
	});
}

/**
 * Apply GitHub owner to all discovered extensions.
 * When installing from GitHub, extensions are namespaced under the repository owner.
 *
 * @param extensions - Discovered extensions to update
 * @param source - Installation source
 */
export function applySourceOwner(extensions: DiscoveredExtension[], source: InstallSource): void {
	if (source.type === "github") {
		for (const ext of extensions) {
			ext.id.owner = source.owner;
		}
	}
}

/**
 * Select extensions from a list using an optional callback.
 * Returns null if the user cancelled.
 *
 * @param allExtensions - All discovered extensions
 * @param selectExtension - Optional callback for user selection
 * @returns Selected extensions, or null if cancelled
 */
export async function selectExtensionsFromSource(
	allExtensions: DiscoveredExtension[],
	selectExtension?: ExtensionSelectionCallback,
): Promise<DiscoveredExtension[] | null> {
	if (allExtensions.length > 1 && selectExtension) {
		const selected = await selectExtension(allExtensions);
		if (!selected || selected.length === 0) {
			return null;
		}
		return selected;
	}
	return allExtensions.length === 1 ? allExtensions : [allExtensions[0]];
}

/**
 * Format a source with the tag or commit it resolved to, for messages.
 */
function formatResolvedSource(source: InstallSource, tagName?: string, commitSha?: string): string {
	if (source.type === "github") {
		const base = formatGitHubLocator(source);
		if (commitSha) {
			return `${base}@${shortCommit(commitSha)}`;
		}
		return tagName && tagName !== "HEAD" ? `${base}@${tagName}` : base;
	}

	return formatInstallSource(source);
}

/**
 * Path of a local source as the install record holds it: relative to the project root,
 * `/`-separated and starting with `./`, when it lies inside the project, else absolute.
 */
function formatLocalRecordSource(projectDir: string, sourcePath: string): string {
	const absolute = path.resolve(sourcePath);
	const root = path.resolve(projectDir);
	if (!isInside(root, absolute)) {
		return absolute;
	}
	const relative = toRelativePosixPath(root, absolute);
	return relative === "" ? "." : `./${relative}`;
}

/**
 * Build the data of the install record of a source.
 *
 * `source` is `recordSource` when set, else the source as typed, with the tag it resolved to
 * when it has no ref. `ref` is the text after the last `@` of `source`.
 * A GitHub record always holds `quarto-wizard.track`. It holds `quarto-wizard.commit` when the
 * download resolved to a commit that the recorded ref does not name: the head of a branch, or
 * the head of the default branch when the repository has no version tag.
 */
function sourceRecordData(
	source: InstallSource,
	context: {
		projectDir: string;
		recordSource?: string;
		sourceType?: SourceType;
		track: InstallTrack;
		tagName?: string;
		fromTag: boolean;
		commitSha?: string;
		isDirectory: boolean;
	},
): SourceRecordData {
	if (source.type === "url") {
		return { source: context.recordSource ?? source.url, kind: "url" };
	}
	if (source.type === "local") {
		return {
			source: context.recordSource ?? formatLocalRecordSource(context.projectDir, source.path),
			kind: context.isDirectory ? "local-dir" : "local-archive",
		};
	}
	const { recorded, track, commit } = githubRecordSource(source, context);
	const { ref } = splitSourceRef(recorded);
	const quartoWizard: NonNullable<SourceRecordData["quartoWizard"]> = { track };
	if (context.sourceType === "registry") {
		quartoWizard.sourceType = "registry";
	}
	if (commit && (ref === undefined || shortCommit(ref) !== shortCommit(commit))) {
		quartoWizard.commit = commit;
	}
	return {
		source: recorded,
		kind: "github",
		...(ref !== undefined && { ref }),
		quartoWizard,
	};
}

/**
 * Source, update mode and commit that the install record of a GitHub source names.
 * The commit is a candidate: `sourceRecordData` drops it when the recorded ref is that commit.
 */
function githubRecordSource(
	source: Extract<InstallSource, { type: "github" }>,
	context: { recordSource?: string; track: InstallTrack; tagName?: string; fromTag: boolean; commitSha?: string },
): { recorded: string; track: InstallTrack; commit?: string } {
	if (context.recordSource !== undefined) {
		return { recorded: context.recordSource, track: context.track, commit: context.commitSha };
	}
	switch (source.version.type) {
		case "latest": {
			const base = formatGitHubLocator(source);
			if (context.fromTag && context.tagName) {
				return { recorded: `${base}@${context.tagName}`, track: "tag" };
			}
			return { recorded: base, track: context.track, commit: context.commitSha };
		}
		case "branch":
			return { recorded: formatInstallSource(source), track: "branch", commit: context.commitSha };
		default:
			return { recorded: formatInstallSource(source), track: "tag" };
	}
}

/**
 * Read the manifest of an installed copy, or null when it has none or it cannot be parsed.
 * A copy whose manifest cannot be parsed has no version, so an install replaces it.
 */
function readInstalledManifest(dir: string): ManifestReadResult | null {
	try {
		return readManifest(dir);
	} catch (error) {
		if (error instanceof ManifestError) {
			return null;
		}
		throw error;
	}
}

/**
 * Seven-character commit in lower case of an installed copy, or null when it is not known.
 *
 * The install record gives it first. A copy without a record gives the commit of its
 * Quarto Wizard 3 manifest source. A record that cannot be read gives none.
 */
function installedCommit(result: SourceRecordReadResult, installed: ExtensionManifest): string | null {
	if (result.status === "ok") {
		return recordedCommit(result.record);
	}
	return result.status === "absent" && installed.source ? extractCommitFromSource(installed.source) : null;
}

/**
 * Whether an install resolved to a commit, and the installed copy has no commit or another one.
 * Commits are compared on their first seven characters, without regard to case.
 * The commit of the install comes from the download resolution, which checked a commit ref before it downloaded it.
 */
function movesToAnotherCommit(
	installedRecord: SourceRecordReadResult,
	installed: ExtensionManifest,
	recordData: SourceRecordData,
): boolean {
	const incoming = recordedCommit(recordData);
	return incoming !== null && installedCommit(installedRecord, installed) !== incoming;
}

/**
 * What an install does to the installed copy of one extension.
 * `untracked` is true when a copy without an install record is replaced.
 */
type Replacement = { action: "write"; untracked: boolean } | { action: "unchanged"; installed: ManifestReadResult };

/**
 * Decide whether an install writes the extension, with the rules of Quarto 2.
 *
 * Without `force`, a copy at the same version is left as it is, and a copy with local
 * changes is refused before anything is written.
 * An install that resolved to a commit other than the installed one is an update, whatever the versions.
 * With `replaceSameVersion`, a copy at the same version is replaced too, unless it has local changes.
 *
 * @throws LocalEditsError when the installed copy has local changes and `force` is not set
 */
function checkReplacement(
	targetDir: string,
	alreadyExists: boolean,
	extensionId: ExtensionId,
	incoming: ExtensionManifest,
	recordData: SourceRecordData,
	force: boolean,
	replaceSameVersion: boolean,
): Replacement {
	if (!alreadyExists) {
		return { action: "write", untracked: false };
	}
	const installedRecord = readSourceRecord(targetDir);
	if (force) {
		return { action: "write", untracked: installedRecord.status === "absent" };
	}
	const installed = readInstalledManifest(targetDir);
	if (
		installed &&
		!replaceSameVersion &&
		!movesToAnotherCommit(installedRecord, installed.manifest, recordData) &&
		compareInstallAction(installed.manifest.version || undefined, incoming.version || undefined) === "no-change"
	) {
		return { action: "unchanged", installed };
	}
	const state = getInstalledState(targetDir, installedRecord);
	if (state.kind === "modified") {
		throw new LocalEditsError(extensionId, state.edits);
	}
	return { action: "write", untracked: state.kind === "untracked" };
}

/**
 * Write an extension to disk with transactional rollback.
 *
 * Copies extension files to the target directory, then writes the install record at the
 * top of it. Extensions embedded in the copied folder get no record of their own.
 * The manifest is left as the source had it.
 * If any step fails, the target directory is cleaned up to avoid leaving an inconsistent state.
 *
 * @param sourceDir - Source directory containing the extension
 * @param targetDir - Destination directory for the extension
 * @param recordData - Data of the install record
 * @returns List of files created, and the install record written
 */
async function writeExtensionToDisk(
	sourceDir: string,
	targetDir: string,
	recordData: SourceRecordData,
): Promise<{ filesCreated: string[]; record: SourceRecord }> {
	try {
		const filesCreated = await copyDirectory(sourceDir, targetDir);
		const record = writeSourceRecord(targetDir, recordData);
		return { filesCreated, record };
	} catch (error) {
		// Rollback: remove partially installed extension to maintain consistency.
		// eslint-disable-next-line @typescript-eslint/no-empty-function
		await fs.promises.rm(targetDir, { recursive: true, force: true }).catch(() => {});
		throw error;
	}
}

/**
 * Collect extension files for dry-run preview.
 * Returns relative paths that would be created.
 */
async function collectExtensionFiles(sourceDir: string): Promise<string[]> {
	const absolutePaths = await collectFiles(sourceDir);
	return absolutePaths.map((p) => path.relative(sourceDir, p));
}

/**
 * An extension checked for installation, before anything is written.
 */
export interface ExtensionInstallPlan {
	/** Discovered extension with path and pre-computed ID. */
	extension: DiscoveredExtension;
	/** Manifest of the extension to install. */
	manifestResult: ManifestReadResult;
	/** Folder the extension is installed to. */
	targetDir: string;
	/** Whether a copy is installed in `targetDir`. */
	alreadyExists: boolean;
	/** What the install does to the installed copy. */
	replacement: Replacement;
}

/**
 * Check one extension for installation without writing anything.
 *
 * Plan every extension of a source before writing the first one, so that a refusal leaves the project as it was.
 *
 * @param extension - Discovered extension with path and pre-computed ID
 * @param projectDir - Project directory to install to
 * @param recordData - Data of the install record to write
 * @param force - Whether to replace an installed copy that has local changes or is at the same version
 * @param replaceSameVersion - Whether to replace an installed copy at the same version that has no local changes
 * @returns The plan to pass to `installPlannedExtension`
 * @throws LocalEditsError when the installed copy has local changes and `force` is not set
 */
export async function planExtensionInstall(
	extension: DiscoveredExtension,
	projectDir: string,
	recordData: SourceRecordData,
	force: boolean,
	replaceSameVersion = false,
): Promise<ExtensionInstallPlan> {
	const manifestResult = readManifest(extension.path);

	if (!manifestResult) {
		throw new ExtensionError("Failed to read extension manifest");
	}

	const targetDir = getExtensionInstallPath(projectDir, extension.id);
	const alreadyExists = await pathExists(targetDir);
	const replacement = checkReplacement(
		targetDir,
		alreadyExists,
		extension.id,
		manifestResult.manifest,
		recordData,
		force,
		replaceSameVersion,
	);
	return { extension, manifestResult, targetDir, alreadyExists, replacement };
}

/**
 * Install an extension as its plan says.
 *
 * @param plan - Plan from `planExtensionInstall`
 * @param recordData - Data of the install record to write
 * @param onProgress - Progress callback
 * @param confirmOverwrite - Callback to confirm overwrite when extension exists
 * @returns Installation result
 */
export async function installPlannedExtension(
	plan: ExtensionInstallPlan,
	recordData: SourceRecordData,
	onProgress?: InstallProgressCallback,
	confirmOverwrite?: ConfirmOverwriteCallback,
): Promise<InstallResult> {
	const { extension, manifestResult, targetDir, alreadyExists, replacement } = plan;
	const extensionId: ExtensionId = extension.id;

	if (replacement.action === "unchanged") {
		return {
			success: true,
			unchanged: true,
			extension: toInstalledExtension(
				extensionId,
				replacement.installed.manifest,
				path.join(targetDir, replacement.installed.filename),
				targetDir,
			),
			filesCreated: [],
			source: recordData.source,
			recordData,
			alreadyExists: true,
		};
	}

	if (alreadyExists) {
		// If confirmOverwrite callback is provided, ask for confirmation
		if (confirmOverwrite) {
			const proceed = await confirmOverwrite(extension);
			if (!proceed) {
				// User cancelled overwrite
				return {
					success: false,
					cancelled: true,
					extension: {
						id: extensionId,
						manifest: manifestResult.manifest,
						manifestPath: path.join(targetDir, manifestResult.filename),
						directory: targetDir,
						...NO_SOURCE_RECORD,
					},
					filesCreated: [],
					source: recordData.source,
					alreadyExists: true,
				};
			}
		}
		await fs.promises.rm(targetDir, { recursive: true, force: true });
	}

	onProgress?.({ phase: "installing", message: `Installing ${formatExtensionId(extensionId)}...` });

	const { filesCreated, record } = await writeExtensionToDisk(extension.path, targetDir, recordData);
	const installed = toInstalledExtension(
		extensionId,
		manifestResult.manifest,
		path.join(targetDir, manifestResult.filename),
		targetDir,
		{ status: "ok", record },
	);

	return {
		success: true,
		extension: installed,
		filesCreated,
		source: recordData.source,
		sourceType: installed.manifest.sourceType,
		recordData,
		...(replacement.untracked && { replacedUntracked: true }),
	};
}
