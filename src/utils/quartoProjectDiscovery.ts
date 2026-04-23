import * as vscode from "vscode";
import * as path from "node:path";
import { EXTENSIONS_DIR, MANIFEST_FILENAMES, getErrorMessage } from "@quarto-wizard/core";
import { getAutoProjectDetection, type AutoProjectDetection } from "./extensionDetails";
import { logMessage } from "./log";

/**
 * Glob pattern matching Quarto project marker files at any depth within a workspace folder.
 */
export const QUARTO_PROJECT_GLOB = "**/_quarto.{yml,yaml}";

/**
 * Glob pattern matching installed extension manifests at any depth.
 * The presence of one of these promotes the enclosing project folder (the parent of the
 * outermost `_extensions/` ancestor) to a Quarto root.
 */
export const EXTENSION_MANIFEST_GLOB = `**/${EXTENSIONS_DIR}/**/_extension.{yml,yaml}`;

/**
 * Filenames that mark a directory as a Quarto project root via `_quarto.{yml,yaml}`.
 */
export const QUARTO_PROJECT_FILENAMES = ["_quarto.yml", "_quarto.yaml"] as const;

/**
 * A discovered Quarto project root.
 */
export interface QuartoProjectRoot {
	/**
	 * Absolute path to the project root directory (containing `_quarto.{yml,yaml}` and/or
	 * an `_extensions/` directory with at least one installed extension).
	 */
	fsPath: string;
	/**
	 * The workspace folder that owns this root.
	 */
	workspaceFolder: vscode.WorkspaceFolder;
	/**
	 * Display label.
	 * Equal to `workspaceFolder.name` when the root is the workspace folder itself,
	 * otherwise `workspaceFolder.name/<relative path>` (POSIX-separated).
	 */
	label: string;
}

/**
 * Discovers Quarto project roots across the given workspace folders, honouring the
 * `quartoWizard.autoProjectDetection` setting.
 *
 * Smart merge per workspace folder:
 *  - if the folder root itself contains `_quarto.{yml,yaml}`, only that root is returned;
 *  - else, all detected sub-roots are returned;
 *  - if nothing is detected, the folder root is returned as a fallback so the tree view
 *    keeps its empty-state messaging.
 */
export async function discoverQuartoProjectRoots(
	workspaceFolders: readonly vscode.WorkspaceFolder[],
): Promise<QuartoProjectRoot[]> {
	if (workspaceFolders.length === 0) {
		return [];
	}

	const setting = getAutoProjectDetection();
	const results: QuartoProjectRoot[] = [];

	for (const folder of workspaceFolders) {
		const folderPath = folder.uri.fsPath;

		if (setting === false) {
			results.push(buildRoot(folder, folderPath));
			continue;
		}

		const candidates = new Set<string>();

		if (shouldScanSubFolders(setting)) {
			for (const dir of await findSubFolderProjectDirs(folder)) {
				candidates.add(dir);
			}
		}

		if (shouldScanOpenEditors(setting)) {
			for (const dir of await findOpenEditorProjectDirs(folder)) {
				candidates.add(dir);
			}
		}

		if (candidates.has(folderPath) || candidates.size === 0) {
			results.push(buildRoot(folder, folderPath));
			continue;
		}

		const sorted = [...candidates].sort((a, b) =>
			path.relative(folderPath, a).localeCompare(path.relative(folderPath, b)),
		);
		for (const dir of sorted) {
			results.push(buildRoot(folder, dir));
		}
	}

	return results;
}

function shouldScanSubFolders(setting: AutoProjectDetection): boolean {
	return setting === true || setting === "subFolders";
}

function shouldScanOpenEditors(setting: AutoProjectDetection): boolean {
	return setting === true || setting === "openEditors";
}

function buildRoot(folder: vscode.WorkspaceFolder, fsPath: string): QuartoProjectRoot {
	if (fsPath === folder.uri.fsPath) {
		return { fsPath, workspaceFolder: folder, label: folder.name };
	}
	const relative = path.relative(folder.uri.fsPath, fsPath).split(path.sep).join(path.posix.sep);
	return { fsPath, workspaceFolder: folder, label: `${folder.name}/${relative}` };
}

async function findSubFolderProjectDirs(folder: vscode.WorkspaceFolder): Promise<string[]> {
	try {
		// `null` exclude lets VSCode honour the user's `files.exclude` and `search.exclude`,
		// matching how the Git extension scopes its repository scans.
		const [quartoUris, manifestUris] = await Promise.all([
			vscode.workspace.findFiles(new vscode.RelativePattern(folder, QUARTO_PROJECT_GLOB), null),
			vscode.workspace.findFiles(new vscode.RelativePattern(folder, EXTENSION_MANIFEST_GLOB), null),
		]);
		const folderPath = folder.uri.fsPath;
		const dirs: string[] = [];
		for (const uri of quartoUris) {
			if (uri.scheme !== "file") continue;
			const dir = path.dirname(uri.fsPath);
			if (isInside(folderPath, dir)) dirs.push(dir);
		}
		for (const uri of manifestUris) {
			if (uri.scheme !== "file") continue;
			const dir = projectRootFromManifestPath(uri.fsPath);
			if (dir && isInside(folderPath, dir)) dirs.push(dir);
		}
		return dirs;
	} catch (error) {
		logMessage(`Failed to scan ${folder.uri.fsPath} for Quarto projects: ${getErrorMessage(error)}.`, "error");
		return [];
	}
}

/**
 * Maps an extension manifest path to the enclosing project root.
 *
 * Picks the outermost `_extensions` segment so a templated `_extensions/` shipped *inside*
 * another extension does not get treated as its own project.
 */
function projectRootFromManifestPath(manifestPath: string): string | undefined {
	const segments = manifestPath.split(path.sep);
	const idx = segments.indexOf(EXTENSIONS_DIR);
	if (idx <= 0) return undefined;
	return segments.slice(0, idx).join(path.sep);
}

async function findOpenEditorProjectDirs(folder: vscode.WorkspaceFolder): Promise<string[]> {
	const folderPath = folder.uri.fsPath;
	const dirs = new Set<string>();
	for (const document of vscode.workspace.textDocuments) {
		if (document.uri.scheme !== "file" || document.isUntitled) {
			continue;
		}
		const documentPath = document.uri.fsPath;
		if (!isInside(folderPath, documentPath)) {
			continue;
		}
		const projectDir = await ascendForProjectFile(folderPath, path.dirname(documentPath));
		if (projectDir) {
			dirs.add(projectDir);
		}
	}
	return [...dirs];
}

/**
 * Walks `start` upward (inclusive) until a Quarto project marker is found or the workspace
 * folder boundary is reached. Returns the deepest directory containing a marker.
 */
async function ascendForProjectFile(folderPath: string, start: string): Promise<string | undefined> {
	let current = start;
	while (isInside(folderPath, current)) {
		if (await directoryHasProjectMarker(current)) {
			return current;
		}
		const parent = path.dirname(current);
		if (parent === current) {
			return undefined;
		}
		current = parent;
	}
	return undefined;
}

/**
 * True when `dir` qualifies as a Quarto root: it contains `_quarto.{yml,yaml}` or an
 * `_extensions/` directory with at least one installed extension manifest.
 */
async function directoryHasProjectMarker(dir: string): Promise<boolean> {
	const quartoMarkers = await Promise.all(
		QUARTO_PROJECT_FILENAMES.map((filename) => isFile(vscode.Uri.file(path.join(dir, filename)))),
	);
	if (quartoMarkers.includes(true)) {
		return true;
	}
	return await directoryHasInstalledExtension(vscode.Uri.file(path.join(dir, EXTENSIONS_DIR)));
}

async function isFile(uri: vscode.Uri): Promise<boolean> {
	try {
		const stat = await vscode.workspace.fs.stat(uri);
		return (stat.type & vscode.FileType.File) !== 0;
	} catch {
		return false;
	}
}

/**
 * Lazily walks `extensionsDir` and returns true on the first `_extension.{yml,yaml}` found.
 * Empty `_extensions/` directories return false so they don't promote a folder to a root.
 * Symlinks are skipped so a loop (e.g. `_extensions/loop -> _extensions`) cannot drive the
 * walk into an unbounded ancestor chain.
 */
async function directoryHasInstalledExtension(extensionsDir: vscode.Uri): Promise<boolean> {
	let entries: [string, vscode.FileType][];
	try {
		entries = await vscode.workspace.fs.readDirectory(extensionsDir);
	} catch {
		return false;
	}
	for (const [name, type] of entries) {
		if ((type & vscode.FileType.SymbolicLink) !== 0) {
			continue;
		}
		if ((type & vscode.FileType.File) !== 0) {
			if (MANIFEST_FILENAMES.some((filename) => filename === name)) {
				return true;
			}
			continue;
		}
		if ((type & vscode.FileType.Directory) !== 0) {
			const child = vscode.Uri.joinPath(extensionsDir, name);
			if (await directoryHasInstalledExtension(child)) {
				return true;
			}
		}
	}
	return false;
}

/**
 * True when `child` is `parent` or lives below it (resolved, normalised path comparison).
 */
function isInside(parent: string, child: string): boolean {
	const relative = path.relative(parent, child);
	if (relative === "") {
		return true;
	}
	return !relative.startsWith("..") && !path.isAbsolute(relative);
}
