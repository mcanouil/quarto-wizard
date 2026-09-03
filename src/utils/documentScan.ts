/**
 * What the fence readers of one document version built, held once.
 *
 * Several readers answer the same keystroke, and each one scanned the whole
 * document to do it: a completion, a hover and a diagnostic pass all ask what
 * the fenced blocks of the document are, and the Typst surfaces ask again by
 * their own rules. The scan is a function of the text alone, so the document
 * version is the whole key.
 *
 * One entry is enough, because the document being typed in is the one every
 * reader asks about. A second document asking forgets the first, which costs
 * that document one scan and keeps the cache a single object.
 *
 * The entry holds the two scans side by side. They read the same text by
 * different rules, so neither is derived from the other, and a reader asking
 * for one must not forget what another reader already built.
 *
 * **The arrays are shared, so no reader may write to one.** `getCodeBlockRanges`
 * narrows the blocks of `findFencedBlocks` rather than copying them, so the same
 * objects reach the offset readers and the Typst reader. A reader that needs a
 * list of its own builds one.
 */

import type * as vscode from "vscode";
import { findTypstBlocks, type TypstBlock } from "./typst/typstBlocks";
import { findFencedBlocks, type FencedBlock, type TextRange } from "./yamlPosition";

/** The scans of one document version, each built when it is first asked for. */
interface DocumentScan {
	readonly key: string;
	readonly version: number;
	fenced?: FencedBlock[];
	typst?: TypstBlock[];
}

let held: DocumentScan | undefined;

/**
 * The entry of one document version, empty when nothing has read it yet.
 *
 * @param document - The document being read.
 */
function scanOf(document: vscode.TextDocument): DocumentScan {
	const key = document.uri.toString();
	if (held?.key === key && held.version === document.version) {
		return held;
	}
	held = { key, version: document.version };
	return held;
}

/**
 * The fenced code block bodies of a document.
 *
 * The text is taken as a thunk, because a hit needs none of it. `getText()`
 * copies the whole document, and the readers here run on every keystroke.
 *
 * @param document - The document being read.
 * @param readText - The full text of that document.
 * @returns The ranges of `getCodeBlockRanges`, which the caller must not write to.
 */
export function getDocumentCodeBlockRanges(document: vscode.TextDocument, readText: () => string): TextRange[] {
	const scan = scanOf(document);
	scan.fenced ??= findFencedBlocks(readText());
	return scan.fenced;
}

/**
 * The Typst blocks of a document.
 *
 * @param document - The document being read.
 * @param readText - The full text of that document.
 * @returns The blocks of `findTypstBlocks`, which the caller must not write to.
 */
export function getDocumentTypstBlocks(document: vscode.TextDocument, readText: () => string): TypstBlock[] {
	const scan = scanOf(document);
	scan.typst ??= findTypstBlocks(readText());
	return scan.typst;
}
