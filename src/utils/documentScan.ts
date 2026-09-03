/**
 * What the fence readers of one document version built, held once per document.
 *
 * Several readers answer the same keystroke, and each one scanned the whole
 * document to do it: a completion, a hover and a diagnostic pass all ask what
 * the fenced blocks of the document are, and the Typst surfaces ask again by
 * their own rules. A scan is a function of the text alone, so the document
 * version is the whole key.
 *
 * One entry per document and not one entry in all. Two sweeps read every open
 * document in turn, and two editors side by side alternate, so a single entry
 * would be evicted by the next document and rebuilt for the one before it.
 *
 * The key is the document itself and not its URI. The editor holds one document
 * object per open document, so identity says what a URI cannot: an untitled name
 * is handed out again once the document holding it is closed, and the document
 * taking that name starts at version one with different text. A weak key also
 * releases the entry with the document, which matters because a block body is a
 * slice of the text and a slice keeps the string it was cut from.
 *
 * Each entry holds the two scans side by side. They read the same text by
 * different rules, so neither is derived from the other, and a reader asking
 * for one must not forget what another reader already built.
 *
 * The arrays are shared and are handed out `readonly`, because `findFencedBlocks`
 * is narrowed rather than copied and the same objects reach the offset readers
 * and the Typst reader. A reader that needs a list of its own builds one.
 */

import type * as vscode from "vscode";
import { findTypstBlocks, type TypstBlock } from "./typst/typstBlocks";
import { findFencedBlocks, type FencedBlock, type TextRange } from "./yamlPosition";

/** The scans of one document version, each built when it is first asked for. */
interface DocumentScan {
	version: number;
	fenced?: readonly FencedBlock[];
	typst?: readonly TypstBlock[];
}

const held = new WeakMap<vscode.TextDocument, DocumentScan>();

/**
 * The entry of one document version, empty when nothing has read it yet.
 *
 * @param document - The document being read.
 */
function scanOf(document: vscode.TextDocument): DocumentScan {
	const entry = held.get(document);
	if (entry?.version === document.version) {
		return entry;
	}
	const fresh: DocumentScan = { version: document.version };
	held.set(document, fresh);
	return fresh;
}

/**
 * The fenced code block bodies of a document.
 *
 * @param document - The document being read.
 * @param text - The full text of that document.
 * @returns The ranges of `getCodeBlockRanges`.
 */
export function getDocumentCodeBlockRanges(document: vscode.TextDocument, text: string): readonly TextRange[] {
	const scan = scanOf(document);
	scan.fenced ??= findFencedBlocks(text);
	return scan.fenced;
}

/**
 * The Typst blocks of a document.
 *
 * The text is taken as a thunk here and not there, because a surface asking on
 * its hot path holds a document and no text, and `getText()` copies the whole
 * document to answer from a list that was already built.
 *
 * @param document - The document being read.
 * @param readText - The full text of that document.
 * @returns The blocks of `findTypstBlocks`.
 */
export function getDocumentTypstBlocks(document: vscode.TextDocument, readText: () => string): readonly TypstBlock[] {
	const scan = scanOf(document);
	scan.typst ??= findTypstBlocks(readText());
	return scan.typst;
}
