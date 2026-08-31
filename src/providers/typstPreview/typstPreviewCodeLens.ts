import * as vscode from "vscode";
import { debounce, type DebouncedFunction } from "../../utils/debounce";
import type { TypstBlockKind } from "../../utils/typst/typstBlocks";
import type { TypstPreviewController } from "./typstPreviewController";
import { codeLensOf, surfaceOf, type TypstPreviewSurface, type TypstSurfaceSettings } from "./typstPreviewSettings";

/**
 * A lens above every Typst block, offering to preview that block.
 *
 * It is the one surface that says a block is previewable at all, which is why
 * it has a setting of its own: a lens above every fence of a page of examples
 * is the surface people most often want off.
 */

/** How long after an edit the lenses are asked for again. */
const CHANGE_DEBOUNCE_MS = 300;

/**
 * What the lens above each of the three fence kinds says.
 *
 * The three titles differ deliberately. A plain block, a raw passthrough and an
 * executable cell are spelled almost the same way and behave differently, and
 * one title on all three would hide the difference that matters most.
 */
const TITLES: Record<TypstBlockKind, string> = {
	plain: "Preview Typst block",
	raw: "Preview raw Typst block",
	cell: "Preview Typst cell",
};

export class TypstPreviewCodeLens implements vscode.CodeLensProvider, vscode.Disposable {
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	private readonly disposables: vscode.Disposable[] = [];
	private readonly changeDebounce: DebouncedFunction<() => void>;
	private readonly surfaceOf: (document: vscode.TextDocument) => TypstPreviewSurface;
	private readonly codeLensOf: (document: vscode.TextDocument) => boolean;

	readonly onDidChangeCodeLenses = this.changeEmitter.event;

	constructor(
		private readonly controller: TypstPreviewController,
		settings: TypstSurfaceSettings = {},
	) {
		this.surfaceOf = settings.surfaceOf ?? surfaceOf;
		this.codeLensOf = settings.codeLensOf ?? codeLensOf;
		this.changeDebounce = debounce(() => this.changeEmitter.fire(), CHANGE_DEBOUNCE_MS);

		this.disposables.push(
			// Typing inside a block moves no fence, and typing above one moves every
			// fence below it, so the lenses are asked for again either way. The delay
			// is what keeps that off the keystroke path.
			vscode.workspace.onDidChangeTextDocument((event) => {
				if (event.contentChanges.length > 0 && event.document.languageId === "quarto") {
					this.changeDebounce();
				}
			}),
		);

		this.disposables.push(
			// Turning the lens on or off changes every lens at once, and the reader is
			// waiting for it, so this one is not delayed.
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration("quartoWizard.typstPreview")) {
					this.changeEmitter.fire();
				}
			}),
		);
	}

	provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] {
		if (this.surfaceOf(document) === "off" || !this.codeLensOf(document)) {
			return [];
		}
		const lenses: vscode.CodeLens[] = [];
		for (const block of this.controller.blocksOf(document)) {
			if (token.isCancellationRequested) {
				// A newer version of the document is being scanned already, and half a
				// list is worse than none: it would take the lenses off the blocks it
				// did not reach.
				return [];
			}
			const at = new vscode.Position(block.fenceLine, 0);
			lenses.push(
				new vscode.CodeLens(new vscode.Range(at, at), {
					title: TITLES[block.kind],
					command: "quartoWizard.previewTypstBlock",
					// The lens previews the block it sits above, which is not the block
					// the cursor happens to be in.
					arguments: [document.uri, at],
				}),
			);
		}
		return lenses;
	}

	dispose(): void {
		this.changeDebounce.cancel();
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		this.disposables.length = 0;
		this.changeEmitter.dispose();
	}
}
