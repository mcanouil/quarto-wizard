/**
 * @title Project Discovery Module
 * @description Discovery of Quarto project folders below a root directory.
 *
 * Finds folders that hold a Quarto configuration or installed extensions,
 * and extensions that embed other extensions in their own `_extensions` folder.
 *
 * @module filesystem
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { minimatch } from "minimatch";
import type { ExtensionId } from "../types/extension.js";
import {
	EXTENSIONS_DIR,
	type InstalledExtension,
	applySourceRecord,
	discoverInstalledExtensionsSync,
	readDirectorySorted,
} from "./discovery.js";
import { readManifest } from "./manifest.js";
import { toRelativePosixPath } from "./walk.js";

/** Deepest folder level searched for projects, where the scan root is level 0. */
export const PROJECT_FOLDER_MAX_DEPTH = 2;

const QUARTO_CONFIG_FILENAMES = ["_quarto.yml", "_quarto.yaml"] as const;
const SKIPPED_DIRECTORIES = new Set([EXTENSIONS_DIR, ".git", "node_modules"]);

/**
 * The extension that embeds other extensions.
 */
export interface EmbeddingParent {
	/** Identifier of the embedding extension. */
	id: ExtensionId;
	/** Manifest `source`, undefined when the extension is developed locally. */
	source?: string;
}

/**
 * A folder that holds a Quarto project or an extension with embedded extensions.
 */
export interface DiscoveredProject {
	/** Absolute path of the folder. */
	directory: string;
	/** POSIX path relative to the scan root, "." for the scan root. */
	relativePath: string;
	/** Whether the folder holds `_quarto.yml` or `_quarto.yaml`. */
	hasQuartoConfig: boolean;
	/** Set only for an extension that embeds other extensions. */
	embeddedIn?: EmbeddingParent;
}

/**
 * Options for project discovery.
 */
export interface ProjectDiscoveryOptions {
	/** Minimatch globs, matched against the relative path with `{ dot: true }`. */
	excludePatterns?: readonly string[];
	/** Checked before the walk starts. The walk is synchronous, so an already aborted signal gives an empty result. */
	signal?: AbortSignal;
}

function listSubdirectories(directory: string): string[] {
	try {
		return readDirectorySorted(directory)
			.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !SKIPPED_DIRECTORIES.has(entry.name))
			.map((entry) => entry.name);
	} catch {
		return [];
	}
}

function hasQuartoConfig(directory: string): boolean {
	return QUARTO_CONFIG_FILENAMES.some((filename) => fs.existsSync(path.join(directory, filename)));
}

function findEmbeddingParents(rootDir: string, installed: readonly InstalledExtension[]): DiscoveredProject[] {
	return installed
		.filter((extension) => discoverInstalledExtensionsSync(extension.directory).length > 0)
		.map((extension) => ({
			directory: extension.directory,
			relativePath: toRelativePosixPath(rootDir, extension.directory),
			hasQuartoConfig: false,
			embeddedIn: { id: extension.id, source: extension.manifest.source },
		}));
}

/** Whether a folder is in an `_extensions` folder, as `_extensions/<name>` or `_extensions/<owner>/<name>`. */
function isInExtensionsDir(directory: string): boolean {
	const parent = path.dirname(directory);
	return path.basename(parent) === EXTENSIONS_DIR || path.basename(path.dirname(parent)) === EXTENSIONS_DIR;
}

/** Whether a folder is an installed extension with a source, from its install record or its manifest. */
function isInstalledWithSource(directory: string): boolean {
	let manifestResult;
	try {
		manifestResult = readManifest(directory);
	} catch {
		// A manifest that cannot be parsed gives no source.
		return false;
	}
	return manifestResult !== null && Boolean(applySourceRecord(directory, manifestResult.manifest).manifest.source);
}

/**
 * Whether an extension is embedded in an installed parent.
 *
 * The parent is an ancestor folder that is an extension in an `_extensions` folder and has a source.
 * An embedded extension of an installed parent changes only when its parent is updated.
 * An extension embedded in a parent that is developed locally (no source) is independent.
 *
 * @param extensionDir - Extension folder
 * @param memo - Result of each ancestor folder already checked, shared between calls that check the same tree
 * @returns True when an ancestor folder is an installed extension with a source
 */
export function isEmbeddedInInstalledParent(extensionDir: string, memo = new Map<string, boolean>()): boolean {
	let directory = path.dirname(path.resolve(extensionDir));
	while (path.dirname(directory) !== directory) {
		if (isInExtensionsDir(directory)) {
			let installed = memo.get(directory);
			if (installed === undefined) {
				installed = isInstalledWithSource(directory);
				memo.set(directory, installed);
			}
			if (installed) {
				return true;
			}
		}
		directory = path.dirname(directory);
	}
	return false;
}

/**
 * Find Quarto project folders below a directory.
 *
 * The walk is breadth-first and stops at `PROJECT_FOLDER_MAX_DEPTH`.
 * It does not enter `_extensions`, `.git`, `node_modules`, symbolic links,
 * or folders that match an exclude pattern.
 * A folder is a project when it holds a Quarto configuration or installed extensions.
 * An extension that holds installed extensions of its own is reported right after its project.
 *
 * @param rootDir - Directory to scan
 * @param options - Discovery options
 * @returns Projects in walk order, the scan root first
 */
export function discoverProjectDirs(rootDir: string, options: ProjectDiscoveryOptions = {}): DiscoveredProject[] {
	const { excludePatterns = [], signal } = options;
	const projects: DiscoveredProject[] = [];
	let level: string[] = [rootDir];

	for (let depth = 0; depth <= PROJECT_FOLDER_MAX_DEPTH && level.length > 0; depth++) {
		const next: string[] = [];

		for (const directory of level) {
			if (signal?.aborted) {
				return [];
			}

			const relativePath = toRelativePosixPath(rootDir, directory) || ".";
			const configured = hasQuartoConfig(directory);
			const installed = discoverInstalledExtensionsSync(directory);
			if (configured || installed.length > 0) {
				projects.push({ directory, relativePath, hasQuartoConfig: configured });
				projects.push(...findEmbeddingParents(rootDir, installed));
			}

			if (depth === PROJECT_FOLDER_MAX_DEPTH) {
				continue;
			}
			for (const name of listSubdirectories(directory)) {
				const child = path.join(directory, name);
				const childRelative = toRelativePosixPath(rootDir, child);
				if (!excludePatterns.some((pattern) => minimatch(childRelative, pattern, { dot: true }))) {
					next.push(child);
				}
			}
		}

		level = next;
	}

	return projects;
}
