import * as vscode from "vscode";
import { DEFAULT_TIMEOUT_MS } from "./typstCompiler";

/**
 * Everything the Typst preview reads from configuration.
 *
 * One home for one section. The readers lived in two files once, split by which
 * part of the feature read them rather than by what they mean, and the split
 * grew two clamps doing the same job within a day. A new setting now has one
 * obvious place to go.
 *
 * Every setting is resource scoped, so a multi-root workspace holds one answer
 * per folder, and the document is what says which folder that is.
 */

/** The section every setting of this feature lives under. */
const SECTION = "quartoWizard.typstPreview";

/**
 * Where a preview is shown.
 *
 * There is no surface that draws inside the document. An image after the block
 * would have to grow the height of its line, and the editor takes line height
 * from `IModelDecorationOptions.lineHeight`, which the extension API does not
 * expose at any version. A decoration attachment is laid out inside a line of
 * fixed height, so a tall one paints over the lines below it rather than moving
 * them. The API that would do it is `createWebviewTextEditorInset`, proposed in
 * microsoft/vscode#85682, on the backlog since 2019 and refused to a published
 * extension at run time.
 */
const SURFACES = ["panel", "hover", "off"] as const;

/** Derived from the list, so the two cannot drift apart in silence. */
export type TypstPreviewSurface = (typeof SURFACES)[number];

/** The defaults and bounds `package.json` declares, which it cannot enforce. */
const DEFAULT_SURFACE: TypstPreviewSurface = "panel";
const DEFAULT_MAX_HEIGHT = 200;
const MIN_MAX_HEIGHT = 20;
const MAX_MAX_HEIGHT = 4000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 300000;
const MIN_DEBOUNCE_MS = 0;
const MAX_DEBOUNCE_MS = 5000;

/** The document change delay `package.json` declares. */
export const DEFAULT_DEBOUNCE_MS = 300;

function section(document?: vscode.TextDocument): vscode.WorkspaceConfiguration {
	return vscode.workspace.getConfiguration(SECTION, document?.uri);
}

/** A number setting held inside its bounds, whatever the setting holds. */
function boundedNumber(value: unknown, fallback: number, lowest: number, highest: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.min(highest, Math.max(lowest, value));
}

/**
 * A usable surface, whatever the setting holds.
 *
 * Exported for its tests. `package.json` declares the enum, a hand-edited
 * `settings.json` ignores it, and a settings file written against an older
 * version can still name a surface that no longer exists.
 */
export function previewSurface(value: unknown): TypstPreviewSurface {
	return SURFACES.includes(value as TypstPreviewSurface) ? (value as TypstPreviewSurface) : DEFAULT_SURFACE;
}

/**
 * A usable image height, whatever the setting holds.
 *
 * Exported for its tests. Zero or a negative value would scale every image to
 * nothing, which reads as a surface that renders no image at all.
 */
export function previewMaxHeight(value: unknown): number {
	return boundedNumber(value, DEFAULT_MAX_HEIGHT, MIN_MAX_HEIGHT, MAX_MAX_HEIGHT);
}

/**
 * A usable colour setting, whatever the setting holds.
 *
 * Exported for its tests. A value that is not a string reaches the header and
 * is trimmed there, which throws where nothing catches it, and the panel opens
 * and then stays empty.
 */
export function previewColour(value: unknown): string {
	return typeof value === "string" ? value : "auto";
}

/**
 * A usable compile timeout, whatever the setting holds.
 *
 * Exported for its tests. The bounds in `package.json` only guide the settings
 * user interface, so a hand-edited `settings.json` reaches `setTimeout`
 * unchecked, and `0` there fails every preview before Typst has read anything.
 */
export function previewTimeoutMs(value: unknown): number {
	return boundedNumber(value, DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
}

/**
 * A usable document change delay, whatever the setting holds.
 *
 * Exported for its tests. Zero is allowed and means a compile per keystroke,
 * which a fast machine can carry, and the upper bound stops a mistyped value
 * from looking like a preview that never updates.
 */
export function previewDebounceMs(value: unknown): number {
	return boundedNumber(value, DEFAULT_DEBOUNCE_MS, MIN_DEBOUNCE_MS, MAX_DEBOUNCE_MS);
}

/**
 * Whether a code lens is wanted, whatever the setting holds.
 *
 * Exported for its tests. A cast would let a hand-edited `settings.json` turn
 * the lens back on with the string "false", which is truthy, and this module
 * exists so that no setting is read without that check.
 */
export function previewCodeLens(value: unknown): boolean {
	return typeof value === "boolean" ? value : true;
}

/** What a surface asks about the document it is rendering. */
export interface TypstSurfaceSettings {
	surface: TypstPreviewSurface;
	maxHeight: number;
	codeLens: boolean;
}

/**
 * Everything the surfaces read about one document, in one lookup.
 *
 * Read together because every surface needs the surface value beside its own,
 * and because one injection point is what a test replaces rather than one per
 * setting.
 */
export function surfaceSettings(document: vscode.TextDocument): TypstSurfaceSettings {
	const config = section(document);
	return {
		surface: previewSurface(config.get("surface")),
		maxHeight: previewMaxHeight(config.get<number>("maxHeight", DEFAULT_MAX_HEIGHT)),
		codeLens: previewCodeLens(config.get("codeLens")),
	};
}

/**
 * The surface one document asks for.
 *
 * Takes an optional document because the active editor is what decides whether
 * a hover is offered at all, and there may not be one.
 */
export function surfaceOf(document: vscode.TextDocument | undefined): TypstPreviewSurface {
	return previewSurface(section(document).get("surface"));
}

/** What compiling one document needs. */
export interface TypstCompileSettings {
	foreground: string;
	background: string;
	timeoutMs: number;
}

export function compileSettings(document: vscode.TextDocument): TypstCompileSettings {
	const config = section(document);
	return {
		foreground: previewColour(config.get("foreground")),
		background: previewColour(config.get("background")),
		timeoutMs: previewTimeoutMs(config.get<number>("timeoutMs", DEFAULT_TIMEOUT_MS)),
	};
}

/** How long an edit waits before the preview follows it. */
export function documentDelayOf(document: vscode.TextDocument): number {
	return previewDebounceMs(section(document).get<number>("debounceMs", DEFAULT_DEBOUNCE_MS));
}
