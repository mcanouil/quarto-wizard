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
// Cancels the file scans of the in-flight discovery. Dropping the promise alone
// leaves the scan running, and repeated triggers collect scan processes.
let inFlightCancellation: vscode.CancellationTokenSource | undefined;
// Bumped by `setProjectRoots` and `invalidateProjectRoots` so a queued
// `ensureProjectRoots` continuation from an earlier generation cannot
// overwrite state written after it started.
let generation = 0;

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
	const startedAt = generation;
	const cancellation = new vscode.CancellationTokenSource();
	inFlightCancellation = cancellation;
	inFlight = discoverQuartoProjectRoots(folders, cancellation.token)
		.then((roots) => {
			// A cancelled scan returns a partial result, so only an uncancelled
			// discovery of the current generation may write the snapshot.
			if (generation === startedAt && !cancellation.token.isCancellationRequested) {
				currentRoots = roots;
				initialised = true;
			}
			return currentRoots;
		})
		.finally(() => {
			inFlight = undefined;
			if (inFlightCancellation === cancellation) {
				inFlightCancellation = undefined;
			}
			cancellation.dispose();
		});
	return inFlight;
}

/** Cancels the in-flight discovery so its file scans stop. */
function cancelInFlightDiscovery(): void {
	inFlightCancellation?.cancel();
	inFlightCancellation = undefined;
}

/**
 * Overwrites the cached snapshot and cancels any in-flight discovery so
 * a concurrent `ensureProjectRoots` cannot race-overwrite this snapshot.
 */
export function setProjectRoots(roots: readonly QuartoProjectRoot[]): void {
	cancelInFlightDiscovery();
	currentRoots = roots;
	initialised = true;
	inFlight = undefined;
	generation += 1;
}

/**
 * Drops the cached snapshot. The next `ensureProjectRoots` call re-runs
 * discovery.
 */
export function invalidateProjectRoots(): void {
	cancelInFlightDiscovery();
	currentRoots = [];
	initialised = false;
	inFlight = undefined;
	generation += 1;
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
