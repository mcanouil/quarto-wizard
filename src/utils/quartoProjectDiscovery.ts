import * as vscode from "vscode";
import * as path from "node:path";
import {
	EXTENSIONS_DIR,
	MANIFEST_FILENAMES,
	QUARTOIGNORE_FILENAME,
	getErrorMessage,
	getExtensionsDir,
	isInside,
	isQuartoIgnored,
	readQuartoIgnore,
	toRelativePosixPath,
} from "@quarto-wizard/core";

export { isInside } from "@quarto-wizard/core";
import { getAutoProjectDetection } from "./extensionDetails";
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
 * Glob pattern matching Quarto project marker files in a direct subfolder (one level deep).
 * The workspace folder root itself must be checked separately.
 */
export const QUARTO_PROJECT_DIRECT_GLOB = "*/_quarto.{yml,yaml}";

/**
 * Glob pattern matching installed extension manifests for projects that live as direct
 * subfolders of the workspace folder.
 */
export const EXTENSION_MANIFEST_DIRECT_GLOB = `*/${EXTENSIONS_DIR}/**/_extension.{yml,yaml}`;

/**
 * Filenames that mark a directory as a Quarto project root via `_quarto.{yml,yaml}`.
 */
export const QUARTO_PROJECT_FILENAMES = ["_quarto.yml", "_quarto.yaml"] as const;

/**
 * Upper bound on the matches one scan returns.
 * A workspace folder that holds more project markers than this is far outside the
 * shape the tree view serves, so the cap stops a runaway walk instead of the scan.
 */
export const MAX_SCAN_RESULTS = 5000;

/**
 * Builds the exclude pattern for a file scan from the exclude settings of the editor.
 *
 * `findFiles` applies no exclude at all for a `null` argument, and applies `files.exclude`
 * alone for an `undefined` one. Neither holds `node_modules` or build output, which live
 * in `search.exclude`, so the pattern joins the two settings.
 *
 * @param scope - The resource the settings are read for.
 * @returns A brace pattern of the enabled excludes, or `undefined` when there are none.
 */
export function buildExcludeGlob(scope: vscode.Uri): string | undefined {
	const patterns = new Set<string>();
	for (const section of ["files", "search"]) {
		const excludes = vscode.workspace.getConfiguration(section, scope).get<Record<string, unknown>>("exclude");
		for (const [pattern, enabled] of Object.entries(excludes ?? {})) {
			if (enabled !== true) {
				continue;
			}
			// A comma outside a brace group would split the pattern in two, and each
			// half would exclude more than the pattern names.
			if (hasBareComma(pattern)) {
				logMessage(`Skipping the exclude pattern ${pattern}: a comma outside a brace group.`, "warn");
				continue;
			}
			patterns.add(pattern);
		}
	}
	if (patterns.size === 0) {
		return undefined;
	}
	return `{${[...patterns].join(",")}}`;
}

/** True when `pattern` holds a comma that no brace group encloses. */
function hasBareComma(pattern: string): boolean {
	let depth = 0;
	for (const character of pattern) {
		if (character === "{") depth += 1;
		else if (character === "}") depth -= 1;
		else if (character === "," && depth <= 0) return true;
	}
	return false;
}

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
 *  - if the folder root has a populated `_extensions/`, only that root is returned;
 *  - else, paths matched by the folder's `.quartoignore` are discarded;
 *  - if the folder root itself contains `_quarto.{yml,yaml}`, only that root is returned;
 *  - else, all detected sub-roots are returned;
 *  - if nothing is detected, the folder root is returned as a fallback so the tree view
 *    keeps its empty-state messaging.
 *
 * `token` cancels the file scans. Without it a superseded scan keeps its `ripgrep`
 * process alive, and repeated triggers collect processes until they exhaust the CPU.
 * A cancelled scan returns whatever it had, so the caller must discard the result when
 * its token was cancelled.
 */
export async function discoverQuartoProjectRoots(
	workspaceFolders: readonly vscode.WorkspaceFolder[],
	token?: vscode.CancellationToken,
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

		// Quarto resolves `_extensions/` by walking up from the input file, so a populated
		// `_extensions/` at the folder root already serves every document below it. It is the
		// primary host: no sub-folder is offered as a separate install or update target.
		// The `true` and `subFolders` scans reach the same conclusion on their own; probing
		// here makes the rule hold for `openEditors` too, and skips the scan entirely.
		if (await directoryHasInstalledExtension(vscode.Uri.file(getExtensionsDir(folderPath)))) {
			results.push(buildRoot(folder, folderPath));
			continue;
		}

		const ignorePatterns = readQuartoIgnore(folderPath);
		const discovered =
			setting === "openEditors"
				? await findOpenEditorProjectDirs(folder, token)
				: await findSubFolderProjectDirs(folder, setting === true, token);

		const candidates = new Set<string>();
		for (const dir of discovered) {
			if (isQuartoIgnored(ignorePatterns, toRelativePosixPath(folderPath, dir))) {
				logMessage(`Skipping ${dir}: matched by ${QUARTOIGNORE_FILENAME} in ${folderPath}.`, "debug");
				continue;
			}
			candidates.add(dir);
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

function buildRoot(folder: vscode.WorkspaceFolder, fsPath: string): QuartoProjectRoot {
	if (fsPath === folder.uri.fsPath) {
		return { fsPath, workspaceFolder: folder, label: folder.name };
	}
	return { fsPath, workspaceFolder: folder, label: `${folder.name}/${toRelativePosixPath(folder.uri.fsPath, fsPath)}` };
}

async function findSubFolderProjectDirs(
	folder: vscode.WorkspaceFolder,
	recursive: boolean,
	token?: vscode.CancellationToken,
): Promise<string[]> {
	const folderPath = folder.uri.fsPath;
	const quartoGlob = recursive ? QUARTO_PROJECT_GLOB : QUARTO_PROJECT_DIRECT_GLOB;
	const manifestGlob = recursive ? EXTENSION_MANIFEST_GLOB : EXTENSION_MANIFEST_DIRECT_GLOB;
	try {
		// In direct-only mode the workspace root cannot be matched by the depth-1 glob,
		// so probe it explicitly: the smart-merge in `discoverQuartoProjectRoots` collapses
		// to the workspace folder when it is among the candidates.
		const exclude = buildExcludeGlob(folder.uri);
		const [hasRootMarker, quartoUris, manifestUris] = await Promise.all([
			recursive ? Promise.resolve(false) : directoryHasProjectMarker(folderPath),
			vscode.workspace.findFiles(new vscode.RelativePattern(folder, quartoGlob), exclude, MAX_SCAN_RESULTS, token),
			vscode.workspace.findFiles(new vscode.RelativePattern(folder, manifestGlob), exclude, MAX_SCAN_RESULTS, token),
		]);
		if (quartoUris.length >= MAX_SCAN_RESULTS || manifestUris.length >= MAX_SCAN_RESULTS) {
			logMessage(
				`Scan of ${folderPath} reached the ${MAX_SCAN_RESULTS} match limit; some projects are missing.`,
				"warn",
			);
		}
		const dirs: string[] = [];
		if (hasRootMarker) dirs.push(folderPath);
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

async function findOpenEditorProjectDirs(
	folder: vscode.WorkspaceFolder,
	token?: vscode.CancellationToken,
): Promise<string[]> {
	const folderPath = folder.uri.fsPath;
	const dirs = new Set<string>();
	// Open documents share their ancestors, and probing one directory reads it from
	// disk, so the answers are held for the whole pass.
	const markers = new Map<string, boolean>();
	for (const document of vscode.workspace.textDocuments) {
		if (token?.isCancellationRequested) {
			break;
		}
		if (document.uri.scheme !== "file" || document.isUntitled) {
			continue;
		}
		const documentPath = document.uri.fsPath;
		if (!isInside(folderPath, documentPath)) {
			continue;
		}
		const projectDir = await ascendForProjectFile(folderPath, path.dirname(documentPath), markers);
		if (projectDir) {
			dirs.add(projectDir);
		}
	}
	return [...dirs];
}

/**
 * Walks `start` upward (inclusive) until a Quarto project marker is found or the workspace
 * folder boundary is reached. Returns the deepest directory containing a marker.
 * `markers` holds the answer for each directory the pass already probed.
 */
async function ascendForProjectFile(
	folderPath: string,
	start: string,
	markers: Map<string, boolean>,
): Promise<string | undefined> {
	let current = start;
	while (isInside(folderPath, current)) {
		let hasMarker = markers.get(current);
		if (hasMarker === undefined) {
			hasMarker = await directoryHasProjectMarker(current);
			markers.set(current, hasMarker);
		}
		if (hasMarker) {
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

/** Whether a URI names a file that is there. */
export async function isFile(uri: vscode.Uri): Promise<boolean> {
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
