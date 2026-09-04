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
	/** The keys already written beside the cursor, for a surface that deduplicates. */
	keys: Set<string>;
	/** The column the key of the path is written at, which a child is indented past. */
	keyColumn: number;
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
 * @param annotated - The parse of the YAML of that document, which is undefined
 *   for a document that does not parse. A key being typed usually leaves one
 *   that does not, so the key branch below does not need it.
 * @returns The cursor, or undefined when the document holds no YAML there and
 *   nothing can be offered.
 */
export function yamlCursorAt(
	document: vscode.TextDocument,
	position: vscode.Position,
	text: string,
	annotated: AnnotatedYaml | undefined,
): YamlCursor | undefined {
	const line = document.lineAt(position.line).text;
	const colon = line.indexOf(":");
	const offset = document.offsetAt(position);
	const under = annotated?.pathAt(offset);
	// The character before the cursor as well as the one under it, because a
	// quoted scalar is reported without its quotes, so a cursor sitting just past
	// the closing quote of a key is still on that key. A separator colon is never
	// read this way: it is the last character a key range covers, so a cursor
	// typed straight onto it would read as being on the key, and the colon is a
	// completion trigger, which makes that the position a value is asked for at.
	const previous = line[position.character - 1];
	const before = offset > 0 && previous !== ":" ? annotated?.pathAt(offset - 1) : undefined;
	// The line says whether the cursor is past a colon, because a half-typed key
	// is written where a value would be and the parse cannot tell the two apart.
	// The parse overrules it when the cursor is on a key it already knows, which
	// is what a colon written inside a quoted key looks like.
	const onKnownKey = under?.on === "key" || before?.on === "key";
	const isValuePosition = KEY_LINE.test(line) && position.character > colon && !onKnownKey;

	if (isValuePosition) {
		// The parse says where the key of this line is. The value under the cursor
		// answers first, and the key answers when the value has not been written
		// yet.
		//
		// This needs the document to parse, where the key branch below does not. A
		// key is patched into the document to make it parse, and a value cannot be:
		// the break is on another line, and the value being written has to be read
		// where it is written. A document that does not parse is one Quarto would
		// refuse, so nothing is offered.
		const onKey = annotated?.pathAt(document.offsetAt(position.with(undefined, colon)) - 1);
		const found = under ?? onKey;
		if (annotated === undefined || found === undefined) {
			return undefined;
		}
		const keyRange = annotated.nodeAt(found.path)?.keyRange;
		// The column of the key and not the count of its leading spaces, so that a
		// line indented with a tab still nests its children correctly.
		const keyStart = keyRange === undefined ? undefined : document.positionAt(keyRange.start).character;
		const keyEnd = keyRange === undefined ? undefined : document.positionAt(keyRange.end).character;
		// The separator is the first colon after the key and not the first colon of
		// the line, which a quoted key holding one otherwise takes.
		const separator = keyEnd === undefined ? colon : line.indexOf(":", keyEnd);
		return {
			path: found.path,
			keys: annotated.keysAt(found.path),
			keyColumn: keyStart ?? 0,
			colon: separator === -1 ? colon : separator,
			isValuePosition,
		};
	}

	// Nothing at the cursor is written yet, so a key is written there and the
	// document is parsed with it. The path of that key, without the key itself,
	// is the mapping the cursor sits in. The region is only read here, because
	// the patched text has to be the text the parse was built from.
	const region = yamlRegionOf(text, document.languageId);
	if (region === undefined) {
		return undefined;
	}
	const found = sentinelPath(region.text, offset - region.base, position.character);
	return found === undefined ? undefined : { ...found, keyColumn: 0, colon, isValuePosition };
}
