import * as vscode from "vscode";
import {
	EXTENSIONS_DIR,
	discoverProjectDirs,
	isQuartoIgnored,
	readQuartoIgnore,
	type EmbeddingParent,
} from "@quarto-wizard/core";

export { isInside } from "@quarto-wizard/core";
import { logMessage } from "./log";

/**
 * Glob pattern matching Quarto project marker files at any depth within a workspace folder.
 */
export const QUARTO_PROJECT_GLOB = "**/_quarto.{yml,yaml}";

/**
 * Glob pattern matching installed extension manifests at any depth, embedded ones included.
 * A new or deleted manifest can add or remove a Quarto root.
 */
export const EXTENSION_MANIFEST_GLOB = `**/${EXTENSIONS_DIR}/**/_extension.{yml,yaml}`;

/**
 * Upper bound on the matches one scan returns.
 * A project that holds more matching files than this is far outside the shape the
 * providers serve, so the cap stops a runaway walk instead of the scan.
 */
export const MAX_SCAN_RESULTS = 5000;

/**
 * Collects the enabled exclude patterns of the editor.
 *
 * `files.exclude` holds neither `node_modules` nor build output, which live in
 * `search.exclude`, so the patterns join the two settings.
 *
 * @param scope - The resource the settings are read for.
 * @returns The enabled patterns, each one once.
 */
export function collectExcludePatterns(scope: vscode.Uri): string[] {
	const patterns = new Set<string>();
	for (const section of ["files", "search"]) {
		const excludes = vscode.workspace.getConfiguration(section, scope).get<Record<string, unknown>>("exclude");
		for (const [pattern, enabled] of Object.entries(excludes ?? {})) {
			if (enabled === true) {
				patterns.add(pattern);
			}
		}
	}
	return [...patterns];
}

/**
 * Builds the exclude pattern for a file scan from the exclude settings of the editor.
 *
 * `findFiles` applies no exclude at all for a `null` argument, and applies `files.exclude`
 * alone for an `undefined` one, so the pattern joins the two settings.
 *
 * @param scope - The resource the settings are read for.
 * @returns A brace pattern of the enabled excludes, or `undefined` when there are none.
 */
export function buildExcludeGlob(scope: vscode.Uri): string | undefined {
	const patterns: string[] = [];
	for (const pattern of collectExcludePatterns(scope)) {
		// A comma outside a brace group would split the pattern in two, and each
		// half would exclude more than the pattern names.
		if (hasBareComma(pattern)) {
			logMessage(`Skipping the exclude pattern ${pattern}: a comma outside a brace group.`, "warn");
			continue;
		}
		patterns.push(pattern);
	}
	if (patterns.length === 0) {
		return undefined;
	}
	return `{${patterns.join(",")}}`;
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
 * The fields that every discovered root carries.
 */
interface ProjectRootBase {
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
	/**
	 * POSIX path relative to the workspace folder, `.` for the workspace folder itself.
	 */
	relativePath: string;
	/**
	 * Whether the `.quartoignore` of the workspace folder matches the root.
	 */
	quartoIgnored: boolean;
}

/**
 * A Quarto project: it can own a document and receive an install.
 */
export interface OwningProjectRoot extends ProjectRootBase {
	kind: "project";
	readOnly: false;
}

/**
 * An extension that embeds other extensions.
 * It shows in the views, but never owns a document and never receives an install.
 */
export interface EmbeddedExtensionRoot extends ProjectRootBase {
	kind: "embedded";
	embeddedIn: EmbeddingParent;
	/**
	 * True when the parent was installed from a source.
	 * Its extensions ship with it, so they are never updated, and nothing installs into it.
	 */
	readOnly: boolean;
}

/**
 * A discovered Quarto project root.
 */
export type QuartoProjectRoot = OwningProjectRoot | EmbeddedExtensionRoot;

/** Whether a root can own a document or receive an install. */
export function isOwningRoot(root: QuartoProjectRoot): root is OwningProjectRoot {
	return root.kind === "project";
}

/**
 * Discovers Quarto project roots across the given workspace folders.
 *
 * Every folder down to the fixed depth of the core walk is returned, the workspace
 * folder and its sub-folders alike, with the extensions that embed other extensions.
 * Paths that the `.quartoignore` of the workspace folder matches are kept and marked.
 * When nothing is detected in a workspace folder, the folder itself is returned, so the
 * tree view keeps its empty-state messaging.
 *
 * `token` stops the walk. A cancelled discovery returns the roots of the folders it
 * finished, so the caller must discard the result when its token was cancelled.
 */
export async function discoverQuartoProjectRoots(
	workspaceFolders: readonly vscode.WorkspaceFolder[],
	token?: vscode.CancellationToken,
): Promise<QuartoProjectRoot[]> {
	const results: QuartoProjectRoot[] = [];
	for (const folder of workspaceFolders) {
		if (token?.isCancellationRequested) {
			break;
		}
		const folderPath = folder.uri.fsPath;
		const discovered = discoverProjectDirs(folderPath, {
			excludePatterns: collectExcludePatterns(folder.uri),
		});
		if (token?.isCancellationRequested) {
			break;
		}
		if (discovered.length === 0) {
			results.push(buildRoot(folder, folderPath, ".", false));
			continue;
		}
		const ignorePatterns = readQuartoIgnore(folderPath);
		const roots = discovered.map((project) =>
			buildRoot(
				folder,
				project.directory,
				project.relativePath,
				isQuartoIgnored(ignorePatterns, project.relativePath),
				project.embeddedIn,
			),
		);
		results.push(...roots.sort(compareRelativePaths));
	}
	return results;
}

/** Orders roots by relative path, with the workspace folder first. */
function compareRelativePaths(a: QuartoProjectRoot, b: QuartoProjectRoot): number {
	if (a.relativePath === b.relativePath) return 0;
	if (a.relativePath === ".") return -1;
	if (b.relativePath === ".") return 1;
	return a.relativePath < b.relativePath ? -1 : 1;
}

function buildRoot(
	folder: vscode.WorkspaceFolder,
	fsPath: string,
	relativePath: string,
	quartoIgnored: boolean,
	embeddedIn?: EmbeddingParent,
): QuartoProjectRoot {
	const label = relativePath === "." ? folder.name : `${folder.name}/${relativePath}`;
	const base = { fsPath, workspaceFolder: folder, label, relativePath, quartoIgnored };
	if (embeddedIn) {
		return { ...base, kind: "embedded", embeddedIn, readOnly: embeddedIn.source !== undefined };
	}
	return { ...base, kind: "project", readOnly: false };
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
