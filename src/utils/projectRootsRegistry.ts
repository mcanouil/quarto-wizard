import * as vscode from "vscode";
import { discoverQuartoProjectRoots, isInside, type QuartoProjectRoot } from "./quartoProjectDiscovery";

/**
 * Singleton registry of discovered Quarto project roots. Shared source of
 * truth between the Extensions tree view and the schema-driven providers
 * (YAML completion/hover/diagnostics, shortcode, element attributes,
 * snippets).
 */

let currentRoots: readonly QuartoProjectRoot[] = [];
let initialised = false;
let inFlight: Promise<readonly QuartoProjectRoot[]> | undefined;

/**
 * Returns the cached snapshot, running discovery once if needed.
 * Concurrent callers share a single in-flight promise.
 */
export async function ensureProjectRoots(): Promise<readonly QuartoProjectRoot[]> {
	if (initialised) {
		return currentRoots;
	}
	if (inFlight) {
		return inFlight;
	}
	const folders = vscode.workspace.workspaceFolders ?? [];
	inFlight = discoverQuartoProjectRoots(folders)
		.then((roots) => {
			currentRoots = roots;
			initialised = true;
			return currentRoots;
		})
		.finally(() => {
			inFlight = undefined;
		});
	return inFlight;
}

/**
 * Overwrites the cached snapshot and cancels any in-flight discovery so
 * a concurrent `ensureProjectRoots` cannot race-overwrite this snapshot.
 */
export function setProjectRoots(roots: readonly QuartoProjectRoot[]): void {
	currentRoots = roots;
	initialised = true;
	inFlight = undefined;
}

/**
 * Drops the cached snapshot. The next `ensureProjectRoots` call re-runs
 * discovery.
 */
export function invalidateProjectRoots(): void {
	currentRoots = [];
	initialised = false;
	inFlight = undefined;
}

/**
 * Returns the deepest discovered project root that contains
 * `documentUri`. Returns undefined for non-file URIs or documents
 * outside every known root.
 */
export async function findOwningProjectRoot(documentUri: vscode.Uri): Promise<string | undefined> {
	if (documentUri.scheme !== "file") {
		return undefined;
	}
	const roots = await ensureProjectRoots();
	return pickDeepestOwningRoot(roots, documentUri.fsPath);
}

/**
 * Synchronous best-effort lookup against the current snapshot. Returns
 * undefined when the snapshot is empty or the path is outside every
 * root.
 */
export function findOwningProjectRootSync(documentFsPath: string): string | undefined {
	return pickDeepestOwningRoot(currentRoots, documentFsPath);
}

function pickDeepestOwningRoot(roots: readonly QuartoProjectRoot[], fsPath: string): string | undefined {
	let best: string | undefined;
	let bestLength = -1;
	for (const root of roots) {
		if (!isInside(root.fsPath, fsPath)) {
			continue;
		}
		if (root.fsPath.length > bestLength) {
			best = root.fsPath;
			bestLength = root.fsPath.length;
		}
	}
	return best;
}
