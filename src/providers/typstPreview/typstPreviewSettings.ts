import * as vscode from "vscode";

/**
 * The settings that decide which surface renders a preview, and how large.
 *
 * They sit apart from the controller because all four surfaces read them, and
 * a reader placed in any one of them would make the other three import that
 * surface to reach it.
 */

/** Where a preview is shown. */
export type TypstPreviewSurface = "panel" | "inline" | "hover" | "off";

/** The values `package.json` declares, repeated here because it cannot enforce them. */
const SURFACES: readonly string[] = ["panel", "inline", "hover", "off"];

/** The surface `package.json` declares as the default. */
export const DEFAULT_SURFACE: TypstPreviewSurface = "panel";

/** The image height `package.json` declares as the default, in Typst points. */
export const DEFAULT_MAX_HEIGHT = 200;

/** The bounds `package.json` declares, repeated for the same reason. */
const MIN_MAX_HEIGHT = 20;
const MAX_MAX_HEIGHT = 4000;

/**
 * A usable surface, whatever the setting holds.
 *
 * Exported for its tests. `package.json` declares the enum, and a hand-edited
 * `settings.json` ignores it, so a value no surface answers to would leave every
 * surface silent with nothing said about why.
 */
export function previewSurface(value: unknown): TypstPreviewSurface {
	return typeof value === "string" && SURFACES.includes(value) ? (value as TypstPreviewSurface) : DEFAULT_SURFACE;
}

/**
 * A usable image height, whatever the setting holds.
 *
 * Exported for its tests. Zero or a negative value would scale every image to
 * nothing, which reads as a surface that renders no image at all.
 */
export function previewMaxHeight(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return DEFAULT_MAX_HEIGHT;
	}
	return Math.min(MAX_MAX_HEIGHT, Math.max(MIN_MAX_HEIGHT, value));
}

/**
 * The surface one document asks for.
 *
 * The settings are resource scoped, so a multi-root workspace can hold a
 * different answer per folder, and the document is what says which folder that
 * is. Every surface asks about the document it is rendering rather than about
 * the workspace, so a folder set to `off` stays off while another shows a
 * preview.
 */
export function surfaceOf(document: vscode.TextDocument | undefined): TypstPreviewSurface {
	const config = vscode.workspace.getConfiguration("quartoWizard.typstPreview", document?.uri);
	return previewSurface(config.get("surface"));
}

/** The greatest image height one document asks for, in Typst points. */
export function maxHeightOf(document: vscode.TextDocument): number {
	const config = vscode.workspace.getConfiguration("quartoWizard.typstPreview", document.uri);
	return previewMaxHeight(config.get<number>("maxHeight", DEFAULT_MAX_HEIGHT));
}

/** Whether one document asks for a code lens above each of its Typst blocks. */
export function codeLensOf(document: vscode.TextDocument): boolean {
	const config = vscode.workspace.getConfiguration("quartoWizard.typstPreview", document.uri);
	return config.get<boolean>("codeLens", true);
}

/** How a surface reads the settings, which is what a test replaces. */
export interface TypstSurfaceSettings {
	/** What one document asks to see. */
	surfaceOf?: (document: vscode.TextDocument) => TypstPreviewSurface;
	/** The greatest image height one document asks for. */
	maxHeightOf?: (document: vscode.TextDocument) => number;
	/** Whether one document asks for a code lens. */
	codeLensOf?: (document: vscode.TextDocument) => boolean;
}
