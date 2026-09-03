/**
 * Where a cursor sits in the YAML of a document, for the surfaces that complete
 * a key or a value.
 *
 * A completion is asked for while the document is being written, so the cursor
 * is often at a place the document does not describe yet: a blank line under a
 * key, or the middle of a half-typed key. The rule this replaces answered that
 * with a `cursorIndent` argument that trimmed an indentation stack by hand, and
 * that argument was a second rule about indentation living beside the first.
 *
 * There is one rule here instead. Whether the cursor is after the colon of its
 * own line is a question about the line, and it is answered from the line.
 * Everything else is a question about the document, and it is answered from the
 * parse.
 */

import * as vscode from "vscode";
import { sentinelPath, yamlRegionOf, type AnnotatedYaml, type YamlPathSegment } from "./yamlAnnotated";

/** A key and the start of its value, on one line. */
const KEY_LINE = /^\s*(?:- )?([^\s:][^:]*?)\s*:/;

/** What a completion needs to know about the cursor. */
export interface YamlCursor {
	/**
	 * The path a completion resolves against.
	 *
	 * The path of the key on the line when the cursor is after its colon, and the
	 * path of the mapping the cursor sits inside otherwise. A cursor that is
	 * writing a key belongs to the mapping that will hold it, so what is offered
	 * there is the keys of that mapping.
	 */
	path: YamlPathSegment[];
	/** Where the colon of the line is, which is where a value completion replaces from. */
	colon: number;
	/** Whether the cursor is after the colon of a key on its own line. */
	isValuePosition: boolean;
}

/**
 * Read the cursor against the parse of the document.
 *
 * @param document - The document being completed.
 * @param position - Where the cursor is.
 * @param text - The full text of the document, which every caller already holds.
 * @param annotated - The parse of the YAML of that document.
 * @returns The cursor, or undefined when the document holds no YAML there and
 *   nothing can be offered.
 */
export function yamlCursorAt(
	document: vscode.TextDocument,
	position: vscode.Position,
	text: string,
	annotated: AnnotatedYaml,
): YamlCursor | undefined {
	const line = document.lineAt(position.line).text;
	const colon = line.indexOf(":");
	const isValuePosition = KEY_LINE.test(line) && position.character > colon;
	const offset = document.offsetAt(position);

	if (isValuePosition) {
		// The key of this line is written, so the parse says where it is. The value
		// under the cursor answers first, and the key answers when the value has
		// not been written yet.
		const onValue = annotated.pathAt(offset);
		const onKey = annotated.pathAt(document.offsetAt(position.with(undefined, colon)) - 1);
		const found = onValue ?? onKey;
		return found === undefined ? undefined : { path: found.path, colon, isValuePosition };
	}

	// Nothing at the cursor is written yet, so a key is written there and the
	// document is parsed with it. The path of that key, without the key itself,
	// is the mapping the cursor sits in. The region is only read here, because
	// the patched text has to be the text the parse was built from.
	const region = yamlRegionOf(text, document.languageId);
	if (region === undefined) {
		return undefined;
	}
	const path = sentinelPath(region.text, offset - region.base, position.character);
	return path === undefined ? undefined : { path, colon, isValuePosition };
}
