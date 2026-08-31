import * as vscode from "vscode";
import { blockAtOffset } from "../../utils/typst/typstBlocks";
import { clampSvg, svgDataUri } from "../../utils/typst/typstSvg";
import type { TypstPreviewController, TypstPreviewResult } from "./typstPreviewController";
import { maxHeightOf, surfaceOf, type TypstPreviewSurface, type TypstSurfaceSettings } from "./typstPreviewSettings";

/**
 * The image of a block, shown when the pointer rests on it.
 *
 * The surface that costs the least while nothing is being read: no panel, no
 * decoration, and no image on screen until the reader asks for one by pointing
 * at a block.
 */

/**
 * How much image a hover carries.
 *
 * A base64 string is a third larger than the image, and the whole of it is
 * rendered inside a tooltip that appears and disappears with the pointer. A
 * dense page of glyph outlines takes long enough to decode that the hover
 * arrives after the pointer has moved on, so above this the reader is sent to
 * the panel, which renders once and stays.
 */
const IMAGE_LIMIT_BYTES = 256 * 1024;

/** What is said while the compile that will answer the next hover is running. */
const COMPILING = "Compiling the Typst block...";

export class TypstPreviewHover implements vscode.HoverProvider {
	private readonly surfaceOf: (document: vscode.TextDocument) => TypstPreviewSurface;
	private readonly maxHeightOf: (document: vscode.TextDocument) => number;

	constructor(
		private readonly controller: TypstPreviewController,
		settings: TypstSurfaceSettings = {},
	) {
		this.surfaceOf = settings.surfaceOf ?? surfaceOf;
		this.maxHeightOf = settings.maxHeightOf ?? maxHeightOf;
	}

	/**
	 * The image of the block under the pointer, without ever awaiting a compile.
	 *
	 * VS Code takes a hover away after about half a second, so awaiting a compile
	 * would show the reader nothing at all. The compile is started and the answer
	 * is given now: it lands in the cache, and the next hover over the same block
	 * is instant.
	 */
	provideHover(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken,
	): vscode.Hover | undefined {
		if (this.surfaceOf(document) !== "hover" || token.isCancellationRequested) {
			return undefined;
		}
		const blocks = this.controller.blocksOf(document);
		const block = blockAtOffset(blocks, document.offsetAt(position));
		if (block === undefined) {
			return undefined;
		}
		// The whole block, so the hover stays up while the pointer moves inside it.
		const range = new vscode.Range(document.positionAt(block.fenceStart), document.positionAt(block.bodyEnd));

		const shown = this.controller.current();
		const isShown =
			shown !== undefined &&
			shown.uri.toString() === document.uri.toString() &&
			shown.blockIndex === blocks.indexOf(block);
		if (isShown) {
			return new vscode.Hover(this.describe(shown, document), range);
		}

		this.controller.preview(document, position);
		return new vscode.Hover(new vscode.MarkdownString(COMPILING), range);
	}

	/** One preview as markdown, which is an image, a failure, or both. */
	private describe(result: TypstPreviewResult, document: vscode.TextDocument): vscode.MarkdownString {
		const markdown = new vscode.MarkdownString();
		if (result.svg !== undefined) {
			// A hover cannot size an image, so the root element is scaled instead and
			// the `viewBox` is left alone, which keeps the drawing filling it.
			const clamped = clampSvg(result.svg, this.maxHeightOf(document));
			if (clamped.length > IMAGE_LIMIT_BYTES) {
				markdown.appendText(
					"The compiled image is too large for a hover. Run Quarto Wizard: Preview Typst Block to see it in the panel.",
				);
			} else {
				markdown.appendMarkdown(`![The compiled Typst block.](${svgDataUri(clamped)})`);
			}
		}
		if (result.error !== undefined) {
			if (markdown.value.length > 0) {
				markdown.appendMarkdown("\n\n");
			}
			// Written as text and not as markdown: a Typst message carries backticks,
			// underscores and asterisks, and rendering them would change what it says.
			markdown.appendText(result.error);
		}
		if (markdown.value.length === 0) {
			markdown.appendText(COMPILING);
		}
		return markdown;
	}
}
