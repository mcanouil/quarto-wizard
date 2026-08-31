import * as vscode from "vscode";
import { blockAtOffset } from "../../utils/typst/typstBlocks";
import { clampSvg, svgDataUri } from "../../utils/typst/typstSvg";
import type { TypstPreviewController, TypstPreviewResult } from "./typstPreviewController";
import { surfaceSettings, type TypstSurfaceSettings } from "./typstPreviewSettings";

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

export class TypstPreviewHover implements vscode.HoverProvider {
	constructor(
		private readonly controller: TypstPreviewController,
		private readonly settingsOf: (document: vscode.TextDocument) => TypstSurfaceSettings = surfaceSettings,
	) {}

	/**
	 * The image of the block under the pointer.
	 *
	 * The compile is awaited. The hover widget has no timeout of its own: it puts
	 * up a loading message after three times the hover delay and updates itself
	 * when a late result arrives, so waiting costs nothing and answering early
	 * would leave every block needing a second hover to read.
	 *
	 * The block already on screen answers without waiting at all, and a block
	 * compiled before answers from the cache, so only the first sight of a block
	 * ever waits.
	 */
	async provideHover(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken,
	): Promise<vscode.Hover | undefined> {
		const settings = this.settingsOf(document);
		if (settings.surface !== "hover" || token.isCancellationRequested) {
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
		const result = isShown ? shown : await this.controller.preview(document, position);

		// The pointer left while Typst ran, so the reader is looking somewhere else.
		// The compile still finished and is held, which is what makes the hover they
		// come back to instant.
		if (result === undefined || token.isCancellationRequested) {
			return undefined;
		}
		if (result.svg === undefined && result.error === undefined) {
			return undefined;
		}
		return new vscode.Hover(this.describe(result, settings.maxHeight), range);
	}

	/** One preview as markdown, which is an image, a failure, or both. */
	private describe(result: TypstPreviewResult, maxHeight: number): vscode.MarkdownString {
		const markdown = new vscode.MarkdownString();
		if (result.svg !== undefined) {
			// A hover cannot size an image, so the root element is scaled instead and
			// the `viewBox` is left alone, which keeps the drawing filling it.
			const clamped = clampSvg(result.svg, maxHeight);
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
		return markdown;
	}
}
