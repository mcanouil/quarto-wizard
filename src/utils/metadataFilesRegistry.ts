import * as path from "node:path";
import * as vscode from "vscode";
import * as yaml from "js-yaml";
import { getErrorMessage } from "@quarto-wizard/core";
import { isInside } from "./quartoProjectDiscovery";
import { logMessage } from "./log";

/**
 * Per-project-root index of YAML files included via Quarto's `metadata-files:`
 * key.  Sources scanned are `_quarto.{yml,yaml}`, `_metadata.{yml,yaml}`, and
 * `.qmd` front-matter.  Inclusion is non-recursive: `metadata-files:` entries
 * inside an already-included file are not followed.
 */

const QUARTO_AND_METADATA_PATTERN = "**/_{quarto,metadata}.{yml,yaml}";

const QUARTO_AND_METADATA_FILENAMES: ReadonlySet<string> = new Set([
	"_quarto.yml",
	"_quarto.yaml",
	"_metadata.yml",
	"_metadata.yaml",
]);

interface RootState {
	/** sourceFsPath -> absolute paths it contributes. */
	contributions: Map<string, Set<string>>;
	initialised: boolean;
	inFlight?: Promise<void>;
}

const rootStates = new Map<string, RootState>();

/** Reverse lookup: included absolute path -> project root that includes it. */
const reverseIndex = new Map<string, string>();

function getOrCreateState(projectRoot: string): RootState {
	let state = rootStates.get(projectRoot);
	if (!state) {
		state = { contributions: new Map(), initialised: false };
		rootStates.set(projectRoot, state);
	}
	return state;
}

function normalisePath(fsPath: string): string {
	return path.normalize(fsPath);
}

function extractMetadataFiles(parsed: unknown, sourceDir: string): string[] {
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return [];
	}
	const value = (parsed as Record<string, unknown>)["metadata-files"];
	if (!Array.isArray(value)) {
		return [];
	}
	const result: string[] = [];
	for (const entry of value) {
		if (typeof entry !== "string" || entry.length === 0) {
			continue;
		}
		const resolved = path.isAbsolute(entry) ? entry : path.resolve(sourceDir, entry);
		result.push(normalisePath(resolved));
	}
	return result;
}

function parseYamlText(text: string): unknown {
	try {
		return yaml.load(text);
	} catch {
		return undefined;
	}
}

/**
 * Extract the YAML front-matter from a `.qmd` document text.  Returns null
 * when no front-matter block is present.
 */
function extractFrontMatter(text: string): string | null {
	const lines = text.split("\n");
	if (lines.length === 0 || lines[0].trim() !== "---") {
		return null;
	}
	for (let i = 1; i < lines.length; i++) {
		if (lines[i].trim() === "---") {
			return lines.slice(1, i).join("\n");
		}
	}
	return null;
}

async function readSourceText(sourceFsPath: string): Promise<string | undefined> {
	// Prefer the in-memory document so unsaved edits drive the registry.
	for (const doc of vscode.workspace.textDocuments) {
		if (doc.uri.scheme === "file" && normalisePath(doc.uri.fsPath) === normalisePath(sourceFsPath)) {
			return doc.getText();
		}
	}
	try {
		const buffer = await vscode.workspace.fs.readFile(vscode.Uri.file(sourceFsPath));
		return Buffer.from(buffer).toString("utf8");
	} catch {
		return undefined;
	}
}

function isQuartoOrMetadataYaml(fsPath: string): boolean {
	return QUARTO_AND_METADATA_FILENAMES.has(path.basename(fsPath));
}

export function isQmdFile(fsPath: string): boolean {
	return fsPath.toLowerCase().endsWith(".qmd");
}

function setsEqual(a: ReadonlySet<string> | undefined, b: ReadonlySet<string>): boolean {
	if (a === undefined) {
		return b.size === 0;
	}
	if (a.size !== b.size) {
		return false;
	}
	for (const value of a) {
		if (!b.has(value)) {
			return false;
		}
	}
	return true;
}

/**
 * Returns true when the source's contributions changed.  Callers use the
 * return value to skip downstream invalidations on no-op updates.
 */
function updateContributions(projectRoot: string, sourceFsPath: string, included: string[]): boolean {
	const state = getOrCreateState(projectRoot);
	const normalisedSource = normalisePath(sourceFsPath);
	const previous = state.contributions.get(normalisedSource);
	const next = new Set<string>(included);

	if (setsEqual(previous, next)) {
		return false;
	}

	if (previous) {
		for (const prev of previous) {
			if (reverseIndex.get(prev) !== projectRoot) {
				continue;
			}
			// Only clear when no other source in the same root still includes it.
			let stillIncluded = false;
			for (const [otherSource, set] of state.contributions) {
				if (otherSource !== normalisedSource && set.has(prev)) {
					stillIncluded = true;
					break;
				}
			}
			if (!stillIncluded) {
				reverseIndex.delete(prev);
			}
		}
	}

	if (next.size === 0) {
		state.contributions.delete(normalisedSource);
		return true;
	}

	state.contributions.set(normalisedSource, next);
	for (const inc of next) {
		// First writer wins; mixing roots is unusual but harmless.
		if (!reverseIndex.has(inc)) {
			reverseIndex.set(inc, projectRoot);
		}
	}
	return true;
}

async function parseAndUpdateSource(projectRoot: string, sourceFsPath: string): Promise<boolean> {
	const text = await readSourceText(sourceFsPath);
	if (text === undefined) {
		return updateContributions(projectRoot, sourceFsPath, []);
	}

	let parsed: unknown;
	if (isQmdFile(sourceFsPath)) {
		const front = extractFrontMatter(text);
		if (!front) {
			return updateContributions(projectRoot, sourceFsPath, []);
		}
		parsed = parseYamlText(front);
	} else {
		parsed = parseYamlText(text);
	}

	const included = extractMetadataFiles(parsed, path.dirname(sourceFsPath));
	return updateContributions(projectRoot, sourceFsPath, included);
}

async function buildForRoot(projectRoot: string): Promise<void> {
	const folderUri = vscode.Uri.file(projectRoot);
	try {
		const uris = await vscode.workspace.findFiles(
			new vscode.RelativePattern(folderUri, QUARTO_AND_METADATA_PATTERN),
			null,
		);

		const sources = new Set<string>();
		for (const uri of uris) {
			if (uri.scheme !== "file") {
				continue;
			}
			sources.add(normalisePath(uri.fsPath));
		}

		// Pick up open .qmd docs inside this root.
		for (const doc of vscode.workspace.textDocuments) {
			if (doc.uri.scheme !== "file" || doc.isUntitled) {
				continue;
			}
			if (!isQmdFile(doc.uri.fsPath)) {
				continue;
			}
			if (!isInside(projectRoot, doc.uri.fsPath)) {
				continue;
			}
			sources.add(normalisePath(doc.uri.fsPath));
		}

		await Promise.all([...sources].map((source) => parseAndUpdateSource(projectRoot, source)));
	} catch (error) {
		logMessage(`Failed to build metadata-files registry for ${projectRoot}: ${getErrorMessage(error)}.`, "warn");
	}
}

/**
 * Returns the absolute paths of all YAML files included via `metadata-files:`
 * from sources within `projectRoot`.  Builds the registry lazily on first
 * access and shares the in-flight promise across concurrent callers.
 */
export async function getMetadataFiles(projectRoot: string): Promise<Set<string>> {
	const normalisedRoot = normalisePath(projectRoot);
	const state = getOrCreateState(normalisedRoot);
	if (state.initialised) {
		return collectIncluded(state);
	}
	if (!state.inFlight) {
		state.inFlight = buildForRoot(normalisedRoot)
			.then(() => {
				state.initialised = true;
			})
			.finally(() => {
				state.inFlight = undefined;
			});
	}
	await state.inFlight;
	return collectIncluded(state);
}

function collectIncluded(state: RootState): Set<string> {
	const result = new Set<string>();
	for (const set of state.contributions.values()) {
		for (const inc of set) {
			result.add(inc);
		}
	}
	return result;
}

/**
 * Refresh the registry for a single source file.  Call on file system
 * watcher events or `.qmd` saves.  When `sourceFsPath` no longer exists or
 * no longer contains `metadata-files:`, its contributions are removed.
 * Returns true when contributions changed so callers can skip downstream
 * invalidations on no-op refreshes.
 */
export async function refreshSource(projectRoot: string, sourceFsPath: string): Promise<boolean> {
	const normalisedRoot = normalisePath(projectRoot);
	const state = getOrCreateState(normalisedRoot);
	// Wait for any in-flight lazy build so its parsed contributions land first;
	// otherwise this targeted refresh and the build can interleave mutations on
	// `state.contributions` for the same source.
	if (state.inFlight) {
		await state.inFlight;
	}
	// Mark as initialised: subsequent getMetadataFiles must not trigger a full rebuild
	// that would race against this targeted refresh.
	state.initialised = true;
	return parseAndUpdateSource(normalisedRoot, sourceFsPath);
}

/**
 * Drop the registry for `projectRoot`, or for all roots when omitted.
 */
export function invalidateMetadataFiles(projectRoot?: string): void {
	if (projectRoot === undefined) {
		for (const [root, state] of rootStates) {
			for (const set of state.contributions.values()) {
				for (const inc of set) {
					if (reverseIndex.get(inc) === root) {
						reverseIndex.delete(inc);
					}
				}
			}
		}
		rootStates.clear();
		return;
	}
	const normalisedRoot = normalisePath(projectRoot);
	const state = rootStates.get(normalisedRoot);
	if (!state) {
		return;
	}
	for (const set of state.contributions.values()) {
		for (const inc of set) {
			if (reverseIndex.get(inc) === normalisedRoot) {
				reverseIndex.delete(inc);
			}
		}
	}
	rootStates.delete(normalisedRoot);
}

/**
 * Synchronous lookup: returns the owning project root when `fsPath` has been
 * registered as a metadata-files target, undefined otherwise.
 */
export function isRegisteredMetadataFile(fsPath: string): string | undefined {
	return reverseIndex.get(normalisePath(fsPath));
}

/**
 * Whether `document` is a Quarto YAML target eligible for schema-driven
 * completion, diagnostics, and hover.  Returns true for `.qmd` documents,
 * canonical `_quarto.*`/`_metadata.*` files, and any YAML registered as a
 * `metadata-files:` target.
 */
export function isRelevantYaml(document: vscode.TextDocument): boolean {
	if (document.languageId === "quarto" || document.fileName.toLowerCase().endsWith(".qmd")) {
		return true;
	}
	if (document.languageId !== "yaml") {
		return false;
	}
	if (isQuartoOrMetadataYaml(document.fileName)) {
		return true;
	}
	if (document.uri.scheme !== "file") {
		return false;
	}
	return isRegisteredMetadataFile(document.uri.fsPath) !== undefined;
}
