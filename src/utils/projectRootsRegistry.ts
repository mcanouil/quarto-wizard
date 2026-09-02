import * as vscode from "vscode";
import { discoverQuartoProjectRoots, isInside, type QuartoProjectRoot } from "./quartoProjectDiscovery";

/**
 * Singleton registry of discovered Quarto project roots. Shared source of
 * truth between the Extensions tree view and the schema-driven providers
 * (YAML completion/hover/diagnostics, shortcode, element attributes,
 * snippets).
 */

/**
 * How many times a waiting caller follows a superseded discovery to the one that
 * replaced it. A trigger storm cannot hold the caller for ever.
 */
const MAX_DISCOVERY_ATTEMPTS = 5;

let currentRoots: readonly QuartoProjectRoot[] = [];
let initialised = false;
let inFlight: Promise<readonly QuartoProjectRoot[] | undefined> | undefined;
// Cancels the file scans of the in-flight discovery, so a superseded discovery
// cannot write the snapshot and cannot leave its scan running. Dropping the
// promise alone leaves the scan alive, and repeated triggers collect scans.
let inFlightCancellation: vscode.CancellationTokenSource | undefined;

/**
 * Returns the cached snapshot, running discovery once if needed.
 * Concurrent callers share a single in-flight promise.
 */
export async function ensureProjectRoots(): Promise<readonly QuartoProjectRoot[]> {
	if (initialised) {
		return currentRoots;
	}
	// Join the discovery that is already running. A second one would cancel it,
	// and both callers would then hold an empty snapshot.
	let pending = inFlight ?? refreshProjectRoots();
	for (let attempt = 0; attempt < MAX_DISCOVERY_ATTEMPTS; attempt += 1) {
		const roots = await pending;
		if (roots) {
			return roots;
		}
		if (initialised) {
			return currentRoots;
		}
		// A superseded discovery reports nothing, so follow the discovery that
		// replaced it. When nothing replaced it the snapshot is the answer, and
		// starting another scan here would fight the refresh that comes next.
		const successor = inFlight;
		if (!successor) {
			break;
		}
		pending = successor;
	}
	return currentRoots;
}

/**
 * Runs discovery and writes the snapshot. Cancels the discovery this call
 * supersedes, so only one set of file scans is ever running.
 *
 * @returns The discovered roots, or `undefined` when a newer call superseded
 *          this one, which leaves the snapshot to that newer call.
 */
export function refreshProjectRoots(): Promise<readonly QuartoProjectRoot[] | undefined> {
	cancelInFlightDiscovery();
	const cancellation = new vscode.CancellationTokenSource();
	inFlightCancellation = cancellation;
	const discovery = runDiscovery(cancellation).finally(() => {
		// A superseded discovery settles after the newer one started, so it clears
		// only the state that is still its own.
		if (inFlight === discovery) {
			inFlight = undefined;
		}
		if (inFlightCancellation === cancellation) {
			inFlightCancellation = undefined;
		}
		cancellation.dispose();
	});
	inFlight = discovery;
	return discovery;
}

async function runDiscovery(
	cancellation: vscode.CancellationTokenSource,
): Promise<readonly QuartoProjectRoot[] | undefined> {
	const folders = vscode.workspace.workspaceFolders ?? [];
	const roots = await discoverQuartoProjectRoots(folders, cancellation.token);
	if (cancellation.token.isCancellationRequested) {
		return undefined;
	}
	currentRoots = roots;
	initialised = true;
	return roots;
}

/** Cancels the in-flight discovery so its file scans stop. */
function cancelInFlightDiscovery(): void {
	inFlightCancellation?.cancel();
	inFlightCancellation = undefined;
}

/**
 * Overwrites the cached snapshot and cancels any in-flight discovery so
 * a concurrent `ensureProjectRoots` cannot race-overwrite this snapshot.
 *
 * Seeds the registry for a test. Production code reaches the snapshot through
 * {@link ensureProjectRoots} and {@link refreshProjectRoots}.
 */
export function setProjectRoots(roots: readonly QuartoProjectRoot[]): void {
	cancelInFlightDiscovery();
	currentRoots = roots;
	initialised = true;
	inFlight = undefined;
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
