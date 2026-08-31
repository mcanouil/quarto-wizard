import * as vscode from "vscode";
import { clampSvg, svgDataUri, svgSize } from "../../utils/typst/typstSvg";
import type { TypstPreviewController } from "./typstPreviewController";
import { maxHeightOf, surfaceOf, type TypstPreviewSurface, type TypstSurfaceSettings } from "./typstPreviewSettings";

/**
 * The image of a block, drawn in the editor after its closing fence.
 *
 * The only surface that needs no second window and no pointer, so the block and
 * its image are read together.
 */

/** How the decoration reaches the parts of the world it does not own. */
export interface TypstPreviewDecorationOptions extends TypstSurfaceSettings {
	/**
	 * How one decoration type is built.
	 *
	 * Injected so that a test can hold the types this made and see that the one
	 * it replaced was disposed.
	 */
	createType?: (options: vscode.DecorationRenderOptions) => vscode.TextEditorDecorationType;
}

/** What is painted now, so an unchanged image is not encoded and painted again. */
interface Painted {
	editor: vscode.TextEditor;
	blockIndex: number;
	svg: string;
}

export class TypstPreviewDecoration implements vscode.Disposable {
	private readonly disposables: vscode.Disposable[] = [];
	private readonly surfaceOf: (document: vscode.TextDocument) => TypstPreviewSurface;
	private readonly maxHeightOf: (document: vscode.TextDocument) => number;
	private readonly createType: (options: vscode.DecorationRenderOptions) => vscode.TextEditorDecorationType;
	/**
	 * The one type on screen.
	 *
	 * `createTextEditorDecorationType` bakes the image into the type, so a new
	 * type is needed for every image. Exactly one is kept alive: a leaked type
	 * still paints, so leaking one per keystroke stacks every image a block ever
	 * compiled to down the editor.
	 */
	private live: vscode.TextEditorDecorationType | undefined;
	private painted: Painted | undefined;

	constructor(
		private readonly controller: TypstPreviewController,
		options: TypstPreviewDecorationOptions = {},
	) {
		this.surfaceOf = options.surfaceOf ?? surfaceOf;
		this.maxHeightOf = options.maxHeightOf ?? maxHeightOf;
		this.createType = options.createType ?? ((render) => vscode.window.createTextEditorDecorationType(render));

		this.disposables.push(controller.onDidChangeResult(() => this.render()));
		// A new editor has no decoration of its own, and the preview follows the
		// cursor into it, so what is painted has to be worked out again.
		this.disposables.push(vscode.window.onDidChangeActiveTextEditor(() => this.render()));
		this.disposables.push(
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration("quartoWizard.typstPreview")) {
					this.render();
				}
			}),
		);
	}

	dispose(): void {
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		this.disposables.length = 0;
		this.clear();
	}

	/** Draw the current preview, or take the last one away when none applies. */
	private render(): void {
		const result = this.controller.current();
		if (result?.svg === undefined) {
			this.clear();
			return;
		}
		const editor = vscode.window.visibleTextEditors.find(
			(open) => open.document.uri.toString() === result.uri.toString(),
		);
		if (editor === undefined || this.surfaceOf(editor.document) !== "inline") {
			this.clear();
			return;
		}
		// Found again by its place in the document, because every offset the block
		// carried moves under an edit above it.
		const block = this.controller.blocksOf(editor.document)[result.blockIndex];
		if (block === undefined) {
			this.clear();
			return;
		}

		const svg = clampSvg(result.svg, this.maxHeightOf(editor.document));
		if (
			this.live !== undefined &&
			this.painted?.editor === editor &&
			this.painted.blockIndex === result.blockIndex &&
			this.painted.svg === svg
		) {
			// Nothing moved. Encoding the same image again costs a copy a third larger
			// than the image and a decoration type nobody would see change.
			return;
		}

		const size = svgSize(svg);
		const type = this.createType({
			after: {
				contentIconPath: vscode.Uri.parse(svgDataUri(svg)),
				margin: "0 0 0 1rem",
				// The editor allots no space for a content icon on its own, so the size
				// the image declares is passed through as well.
				...(size === undefined ? {} : { width: `${size.width}pt`, height: `${size.height}pt` }),
			},
		});
		const end = editor.document.positionAt(block.bodyEnd);
		editor.setDecorations(type, [new vscode.Range(end, end)]);
		// Replaced only once the new type is painted. Disposing the old one first
		// takes its image off the line for as long as the assignment takes, which
		// reads as a flicker on every keystroke.
		this.replace(type);
		this.painted = { editor, blockIndex: result.blockIndex, svg };
	}

	/** Take the image away, because none describes what is being looked at. */
	private clear(): void {
		this.replace(undefined);
		this.painted = undefined;
	}

	/** Hold one type, and dispose the one it replaces. */
	private replace(type: vscode.TextEditorDecorationType | undefined): void {
		this.live?.dispose();
		this.live = type;
	}
}
