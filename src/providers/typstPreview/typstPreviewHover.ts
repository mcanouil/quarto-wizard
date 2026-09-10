import * as vscode from "vscode";
import { blockAtOffset } from "../../utils/typst/typstBlocks";
import { pngDataUri, pngSize, rasterPpi } from "../../utils/typst/typstRaster";
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
 * This bounds the data URI, not the image it encodes: base64 inflates the raw
 * bytes by a third, and the URI, not the image, is what the hover renders. A
 * page dense enough to outrun this even as a raster of the size shown takes
 * long enough to decode that the hover arrives after the pointer has moved on,
 * so the reader is sent to the panel, which renders once and stays.
 */
const IMAGE_LIMIT_BYTES = 256 * 1024;

/**
 * How many raster pixels one point of the shown image is compiled from.
 *
 * A dense display draws more than one pixel per point, and an extension is not
 * told how many, so two is the assumption. A raster compiled at the height it
 * is shown at would be soft on such a display.
 */
const PIXELS_PER_POINT = 2;

/** Points to the inch, which is what a resolution is counted in. */
const POINTS_PER_INCH = 72;

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
		if (!settings.surfaces.has("hover") || token.isCancellationRequested) {
			return undefined;
		}
		const blocks = this.controller.blocksOf(document);
		const block = blockAtOffset(blocks, document.offsetAt(position));
		if (block === undefined) {
			return undefined;
		}
		// The whole block, so the hover stays up while the pointer moves inside it.
		const range = new vscode.Range(document.positionAt(block.fenceStart), document.positionAt(block.unitEnd));

		const blockIndex = blocks.indexOf(block);
		// The version is part of the identity, not decoration. Nothing recompiles in
		// the background while the hover is the only surface, so a result that
		// matches on place alone can describe text that has since been edited.
		// A raster, because the image travels inside a data URI and the length of
		// that URI is what decides whether it renders at all. The held result
		// answers only when it holds one: the panel compiles a vector, and a
		// vector is not something this surface can show.
		const plain = PIXELS_PER_POINT * POINTS_PER_INCH;
		const held = this.showing(document, blockIndex);
		const result =
			held ?? (await this.controller.previewRaster(document, position, plain)) ?? this.showing(document, blockIndex);

		// The pointer left while Typst ran, so the reader is looking somewhere else.
		// The compile still finished and is held, which is what makes the hover they
		// come back to instant.
		if (result === undefined || token.isCancellationRequested) {
			return undefined;
		}
		if (result.png === undefined && result.error === undefined) {
			return undefined;
		}
		const raster = await this.raster(document, position, settings.maxHeight, result);
		if (token.isCancellationRequested) {
			return undefined;
		}
		// Bytes that carry no size are not an image, so a result holding only those
		// has nothing to show and nothing to say.
		if (raster === undefined && result.error === undefined) {
			return undefined;
		}
		return new vscode.Hover(this.describe(result, raster), range);
	}

	/**
	 * The image, centred and sized, as the one part of a hover that allows HTML.
	 *
	 * A hover widget is wider than the image it carries. It keeps room for its
	 * own copy button, and VS Code merges the hovers of every provider that
	 * answers for a position into one widget, so the width follows the widest of
	 * them. An image left where it falls sits against the left edge of all that.
	 *
	 * The height is written out because a raster carries a fixed number of pixels
	 * and markdown cannot scale one. Twice the height shown is compiled and half
	 * of it asked for back, so the image is sharp on a dense display and still
	 * obeys the setting.
	 */
	private image(png: Buffer, shownHeight: number): vscode.MarkdownString {
		const markdown = new vscode.MarkdownString();
		const uri = pngDataUri(png);
		if (uri.length > IMAGE_LIMIT_BYTES) {
			markdown.appendText(
				"The compiled image is too large for a hover. Run Quarto Wizard: Preview Typst Block to see it in the panel.",
			);
			return markdown;
		}
		markdown.supportHtml = true;
		const image = `<img src="${uri}" alt="The compiled Typst block." height="${Math.round(shownHeight)}">`;
		markdown.appendMarkdown(`<div align="center">\n\n${image}\n\n</div>`);
		return markdown;
	}

	/**
	 * The raster of one block, at the resolution the hover shows it at.
	 *
	 * Compiled once at the plain resolution, which answers for every page the
	 * hover shows whole. A page taller than that is scaled down before a reader
	 * sees it, so it is compiled again at the resolution it is actually shown at,
	 * rather than carrying pixels the hover throws away in a URI that has to
	 * carry every one of them.
	 */
	private async raster(
		document: vscode.TextDocument,
		position: vscode.Position,
		maxHeight: number,
		first: TypstPreviewResult,
	): Promise<{ png: Buffer; shownHeight: number } | undefined> {
		if (first.png === undefined) {
			return undefined;
		}
		const size = pngSize(first.png);
		if (size === undefined) {
			return undefined;
		}
		// The pixels alone do not say how large the page is. A held raster can be
		// the scaled one from a taller page, and reading it at the plain resolution
		// would report the height of the hover that scaled it as the page.
		const pageHeight = (size.height * POINTS_PER_INCH) / (first.ppi ?? PIXELS_PER_POINT * POINTS_PER_INCH);
		if (pageHeight <= maxHeight) {
			return { png: first.png, shownHeight: pageHeight };
		}
		const scaled = await this.controller.previewRaster(document, position, rasterPpi(pageHeight, maxHeight));
		// Read the same way the first pass is. A scaled compile that a newer
		// request superseded answers with nothing, and the page still has to be
		// shown at the height the hover shows it at.
		const usable = scaled?.png !== undefined && pngSize(scaled.png) !== undefined ? scaled.png : first.png;
		return { png: usable, shownHeight: maxHeight };
	}

	/**
	 * The held preview, when it describes this block of this document version.
	 *
	 * Asked twice: before compiling, because the block on screen needs no compile,
	 * and after, because a theme change or a watched file can supersede the
	 * hover's own request while the pointer still rests. Without the second ask
	 * that race renders no hover at all, and VS Code does not come back to a
	 * provider until the pointer moves.
	 */
	private showing(document: vscode.TextDocument, blockIndex: number): TypstPreviewResult | undefined {
		const shown = this.controller.current();
		return shown !== undefined &&
			shown.png !== undefined &&
			shown.uri.toString() === document.uri.toString() &&
			shown.blockIndex === blockIndex &&
			shown.version === document.version
			? shown
			: undefined;
	}

	/**
	 * One preview as markdown, which is an image, a failure, or both.
	 *
	 * An image and a message never travel in one part. The image allows HTML,
	 * because that is what centres it, and a compiler message is arbitrary text
	 * that a string allowing HTML must never carry: a message holding angle
	 * brackets would reach the reader as markup rather than as what Typst said.
	 */
	private describe(
		result: TypstPreviewResult,
		raster: { png: Buffer; shownHeight: number } | undefined,
	): vscode.MarkdownString[] {
		const parts: vscode.MarkdownString[] = [];
		if (raster !== undefined) {
			parts.push(this.image(raster.png, raster.shownHeight));
		}
		if (result.error !== undefined) {
			const message = new vscode.MarkdownString();
			// Written as text and not as markdown: a Typst message carries backticks,
			// underscores and asterisks, and rendering them would change what it says.
			message.appendText(result.error);
			parts.push(message);
		}
		return parts;
	}
}
