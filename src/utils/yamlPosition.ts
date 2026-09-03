/**
 * Utilities for resolving YAML key paths from cursor positions.
 *
 * These functions map a line/column in a YAML (or Quarto .qmd) document
 * to a structured key path by tracking indentation levels.
 */

import * as yaml from "js-yaml";

/**
 * A half-open text range: [start, end).
 */
export interface TextRange {
	/** Inclusive start offset. */
	start: number;
	/** Exclusive end offset. */
	end: number;
}

/**
 * Check whether a fence info string contains a backtick outside of any
 * quoted context.  Pandoc attribute syntax allows backticks inside
 * single- or double-quoted values (e.g.
 * `code-summary="Show \`fn()\` usage"`), so a naive `includes` check
 * would incorrectly reject valid Quarto fence headers.
 *
 * @param infoString - The portion of the fence line after the opening
 *   backticks/tildes (i.e. the info string).
 * @returns `true` if any backtick appears outside single or double quotes.
 */
export function hasUnquotedBacktick(infoString: string): boolean {
	let inDouble = false;
	let inSingle = false;
	for (const ch of infoString) {
		if (ch === '"' && !inSingle) {
			inDouble = !inDouble;
		} else if (ch === "'" && !inDouble) {
			inSingle = !inSingle;
		} else if (ch === "`" && !inDouble && !inSingle) {
			return true;
		}
	}
	return false;
}

/**
 * How far a fence may be indented past its container before it is not a fence.
 *
 * CommonMark gives four spaces to an indented code block, so a fence at that
 * indent is literal text. The limit is measured from the content column of the
 * open container, because a fence inside a list item is indented to that item.
 */
const MAX_FENCE_INDENT = 3;

/**
 * One blockquote marker: up to three spaces, a `>`, and one optional space.
 *
 * Matched one at a time rather than as a run, because a reader sometimes has to
 * remove a fixed number of them and leave the rest as content.
 */
const BLOCKQUOTE_MARKER = /^ {0,3}>[ \t]?/;

/**
 * A list item marker, which opens a container whose content is indented.
 *
 * The match runs to the first character of the content, so its length gives the
 * column that content starts at. An item with nothing on its line is still an
 * item, and its content column is one past the marker, which is why the marker
 * is captured separately: trailing whitespace after it is not content.
 */
const LIST_ITEM = /^( *)([-+*]|\d{1,9}[.)])(?:[ \t]+(?=\S)|[ \t]*$)/;

/** Space, tab, `>`, and the marker characters a list item can start with. */
const SPACE = 32;
const TAB = 9;
const GREATER_THAN = 62;
const LIST_MARKERS = new Set(["-", "+", "*", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);

/**
 * Whether a line can carry a blockquote marker at all.
 *
 * A marker takes at most three spaces and then a `>`, so four characters settle
 * it. This runs on every line of every document, including every line inside
 * every code block, which is why it is worth answering without a match object.
 */
function mayBeQuoted(line: string): boolean {
	for (let index = 0; index < 4 && index < line.length; index++) {
		const code = line.charCodeAt(index);
		if (code === GREATER_THAN) {
			return true;
		}
		if (code !== SPACE) {
			return false;
		}
	}
	return false;
}

/** How far a tab advances: to the next multiple of four, per CommonMark. */
const TAB_WIDTH = 4;

/**
 * The index of the first character that is neither a space nor a tab.
 *
 * Equal to the length of the line when it holds nothing else, which is what
 * makes it the blank test as well.
 */
function firstNonWhitespace(content: string): number {
	let index = 0;
	while (index < content.length) {
		const code = content.charCodeAt(index);
		if (code !== SPACE && code !== TAB) {
			return index;
		}
		index++;
	}
	return index;
}

/**
 * The same line with a number of columns of indent taken off the front.
 *
 * Columns and not characters, because the fence indent is measured in columns:
 * removing that many characters from a line indented with a tab would take the
 * tab and three spaces where the fence owns only the tab.
 *
 * A tab that straddles the boundary is replaced by the spaces it contributes
 * past it, which is how CommonMark splits one.
 */
export function removeIndentColumns(line: string, indent: number): string {
	let column = 0;
	let index = 0;
	while (index < line.length && column < indent) {
		const code = line.charCodeAt(index);
		if (code === SPACE) {
			column++;
		} else if (code === TAB) {
			const advance = TAB_WIDTH - (column % TAB_WIDTH);
			if (column + advance > indent) {
				return " ".repeat(column + advance - indent) + line.slice(index + 1);
			}
			column += advance;
		} else {
			break;
		}
		index++;
	}
	return line.slice(index);
}

/**
 * The column an index sits at, counting a tab to the next tab stop.
 *
 * Indentation is compared in columns rather than characters, because one tab
 * and four spaces put the following text in the same place.
 */
function columnAt(content: string, index: number): number {
	let column = 0;
	for (let i = 0; i < index; i++) {
		column += content.charCodeAt(i) === TAB ? TAB_WIDTH - (column % TAB_WIDTH) : 1;
	}
	return column;
}

/** Drop a trailing carriage return left by a CRLF document. */
export function stripCarriageReturn(line: string): string {
	return line.endsWith("\r") ? line.slice(0, -1) : line;
}

/**
 * An opening code fence, on a line already stripped of blockquote markers.
 *
 * The indent is measured in columns and not in characters, because a tab
 * advances to the next multiple of four. A tab at the margin therefore opens an
 * indented code block, while the same tab inside a list item is one column of
 * indent and leaves the fence live.
 */
const OPENING_FENCE = /^([ \t]*)(`{3,}|~{3,})(.*)$/;

/** A line with its blockquote markers taken off. */
export interface QuotedLine {
	/** The line without the markers that were removed. */
	content: string;
	/** How many markers were removed. */
	depth: number;
}

/**
 * Take the blockquote markers off a line.
 *
 * A fence inside a blockquote is a real code block for Pandoc, and the markers
 * are structure rather than content, so every fence rule reads the line without
 * them.
 *
 * @param limit - How many markers to remove at most. A reader inside a quoted
 *   block passes the depth of that block, because a marker beyond it belongs to
 *   the content: at one quote deep, `> > #x` is the text `> #x`.
 */
export function stripBlockquoteMarkers(line: string, limit = Number.POSITIVE_INFINITY): QuotedLine {
	if (limit <= 0 || !mayBeQuoted(line)) {
		return { content: line, depth: 0 };
	}
	let content = line;
	let depth = 0;
	while (depth < limit) {
		const found = BLOCKQUOTE_MARKER.exec(content);
		if (found === null) {
			break;
		}
		content = content.slice(found[0].length);
		depth++;
	}
	return { content, depth };
}

/** An opening fence, as read from one line. */
interface OpeningFence {
	/** The indent of the fence, measured after any blockquote markers. */
	indent: number;
	/** The run of the fence, which a closing fence must match or exceed. */
	fence: string;
	/** The info string that follows the run. */
	info: string;
}

/**
 * Read an opening fence from a line, or report that the line is not one.
 *
 * The indent limit is not applied here, because it depends on the container the
 * line sits in, which only a reader walking the whole document knows.
 *
 * @param content - One line, with its blockquote markers already removed.
 */
function parseOpeningFence(content: string): OpeningFence | undefined {
	const found = OPENING_FENCE.exec(content);
	if (found === null) {
		return undefined;
	}
	// The info string of a backtick fence carries no bare backtick, per
	// CommonMark. A backtick inside a quoted attribute value is a Quarto
	// extension and is allowed.
	if (found[2][0] === "`" && hasUnquotedBacktick(found[3])) {
		return undefined;
	}
	return { indent: columnAt(found[1], found[1].length), fence: found[2], info: found[3] };
}

/**
 * The closing fence that ends a block opened by the given run.
 *
 * A fence closes on the same character, repeated at least as many times, alone
 * on its line. The character is always a backtick or a tilde, and neither is a
 * regular expression metacharacter.
 *
 * @param fence - The run of the opening fence, as captured by `OPENING_FENCE`.
 */
export function closingFenceRegExp(fence: string): RegExp {
	return new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`);
}

/**
 * One fenced code block, with everything the scan read on the way past it.
 *
 * The body range is the `TextRange` the offset readers consume, and the rest is
 * what a reader would otherwise have to recover by matching the fence line a
 * second time.
 */
export interface FencedBlock extends TextRange {
	/** The indent of the opening fence, in columns, after any blockquote markers. */
	indent: number;
	/** The run of the opening fence, which a closing fence must match or exceed. */
	fence: string;
	/** The info string that follows the run, untrimmed. */
	info: string;
	/** How many blockquote markers the opening fence line carries. */
	quoteDepth: number;
	/** Offset of the first character of the opening fence line. */
	fenceStart: number;
	/** Zero-based line number of the opening fence. */
	fenceLine: number;
}

/**
 * Find all fenced code blocks in the document text.
 *
 * Recognises both backtick (`` ``` ``) and tilde (`~~~`) fences, with
 * any info string (including executable cells like `{r}`, `{python}`).
 *
 * Each body range starts _after_ the opening fence line (so the fence header
 * with its `{r}` or `{python}` attributes remains outside the range and
 * is still eligible for attribute completion/hover) and extends through
 * the end of the closing fence line (or end of text for unclosed blocks).
 *
 * The indent, the fence run, the info string and the blockquote depth are
 * reported because the scan reads all four to decide where the block ends. A
 * reader that needs them and is given only offsets has to match the fence line
 * again, and a second copy of the fence rules drifts apart in silence.
 *
 * @param text - The full document text.
 * @returns An array of blocks sorted by body start offset.
 */
export function findFencedBlocks(text: string): FencedBlock[] {
	const blocks: FencedBlock[] = [];
	const lines = text.split("\n");
	let offset = 0;
	// The block whose closing fence the scan is looking for. At most one is open
	// at a time, because a fence inside a block is content, so each is pushed in
	// the order it opened.
	let open: FencedBlock | undefined;
	let closingFenceRe: RegExp | undefined;
	// The content column of the innermost open container, as far as one scan can
	// tell. A fence is measured against this and not against the document,
	// because a fence indented four spaces inside a list item is live while the
	// same fence at the margin is literal text.
	//
	// This is an approximation of container parsing and not the real thing. It
	// is lowered only by a line that both starts a block and dedents past it, so
	// it errs towards accepting a fence rather than losing one. The known gap
	// runs the other way: a tab stop is counted from the start of the quoted
	// content rather than from the start of the line, so a tab-indented fence
	// inside a blockquote is charged four columns instead of the two it takes,
	// and is not read as a fence.
	let containerIndent = 0;
	// Whether the line above was blank, which is what makes the line below it
	// the start of a block rather than a continuation of the one above.
	let previousBlank = true;

	for (let i = 0; i < lines.length; i++) {
		const rawLine = lines[i];
		const line = stripCarriageReturn(rawLine);
		const lineStart = offset;
		const lineEnd = lineStart + rawLine.length;
		// Advance offset past the newline for the next iteration.
		offset = lineEnd + (i < lines.length - 1 ? 1 : 0);

		const { content, depth } = stripBlockquoteMarkers(line);

		if (open) {
			if (depth > open.quoteDepth) {
				// A line quoted more deeply than the block is content. Inside a fenced
				// block the container parsing stops, so the extra marker is text the
				// author wrote, and testing the stripped line for a closing fence
				// would close the block on its own body.
				continue;
			}
			if (depth === open.quoteDepth) {
				// Check for closing fence: same character, at least as many
				// repetitions, optionally followed by whitespace, at the start of the
				// line.
				if (closingFenceRe?.test(content)) {
					open.end = lineEnd;
					blocks.push(open);
					open = undefined;
				}
				continue;
			}
			// The blockquote ended, and the code block inside it ends with it. Lazy
			// continuation carries a paragraph across such a line, never the content
			// of a code block. The line itself is not part of the block, so it falls
			// through and can open the next one. The block ends at the end of the
			// line above, which is one character back from the start of this one.
			open.end = Math.max(open.start, lineStart - 1);
			blocks.push(open);
			open = undefined;
		}

		const contentStart = firstNonWhitespace(content);
		if (contentStart < content.length) {
			// The marker test comes first, because a list item both opens a
			// container and sits at the indent of the one around it.
			const item = LIST_MARKERS.has(content[contentStart]) ? LIST_ITEM.exec(content) : null;
			if (item !== null) {
				// An item with nothing after its marker matched to the end of the
				// line, and its content starts in the column after the marker rather
				// than after the whitespace that follows it.
				const empty = item[0].length === content.length;
				const markerEnd = item[1].length + item[2].length;
				containerIndent = empty ? columnAt(content, markerEnd) + 1 : columnAt(content, item[0].length);
			} else if (previousBlank) {
				// Only a line that starts a block can close a container. A line that
				// continues the paragraph of an open item is written at the margin as
				// often as not, and lowering the allowance for it would lose a fence
				// the item still holds open.
				containerIndent = Math.min(containerIndent, columnAt(content, contentStart));
			}
		}
		previousBlank = contentStart === content.length;

		const opening = parseOpeningFence(content);
		if (opening && opening.indent <= containerIndent + MAX_FENCE_INDENT) {
			open = {
				indent: opening.indent,
				fence: opening.fence,
				info: opening.info,
				quoteDepth: depth,
				fenceStart: lineStart,
				fenceLine: i,
				// Start the range after the opening fence line so that
				// attributes in the header (e.g. {r}, {python}) stay outside.
				start: offset,
				// Replaced when the block closes, and left here for the unclosed
				// block that ends the text with nothing in it.
				end: offset,
			};
			// Compile the closing fence regex once per block.
			closingFenceRe = closingFenceRegExp(opening.fence);
		}
	}

	// Unclosed block extends to end of text.
	if (open) {
		open.end = text.length;
		blocks.push(open);
	}

	return blocks;
}

/**
 * Find all fenced code block body regions in the document text.
 *
 * A narrowing of `findFencedBlocks` for the readers that need only the offsets,
 * which is every reader that skips over code rather than reading it. The blocks
 * themselves are returned, because a `FencedBlock` is a `TextRange`, so nothing
 * is copied on a path that runs on every keystroke. No reader writes to a range.
 *
 * @param text - The full document text.
 * @returns An array of ranges sorted by start offset.
 */
export function getCodeBlockRanges(text: string): TextRange[] {
	return findFencedBlocks(text);
}

/**
 * Find all inline code span regions in the document text.
 *
 * Inline code spans are delimited by matching backtick runs of equal length
 * (CommonMark §6.1).  A backtick run is a maximal sequence of backtick
 * characters; the opening run defines the closing run length.  Backslashes
 * do not escape backticks for code-span purposes.
 *
 * The returned ranges include the opening and closing backtick runs so a
 * `{...}` attribute that immediately follows the closing backticks (e.g.
 * `` `code`{=html} ``) remains outside the range and is still extracted as
 * a real attribute.
 *
 * Positions inside fenced code blocks are skipped because backticks there
 * have no inline-span semantics.
 *
 * @param text - The full document text.
 * @param fencedRanges - Pre-computed fenced code block ranges to skip.
 * @returns An array of ranges sorted by start offset.
 */
export function getInlineCodeSpanRanges(text: string, fencedRanges: readonly TextRange[]): TextRange[] {
	const ranges: TextRange[] = [];
	const len = text.length;
	let i = 0;

	while (i < len) {
		const fenced = findContainingRange(fencedRanges, i);
		if (fenced) {
			i = fenced.end;
			continue;
		}

		if (text[i] !== "`") {
			i++;
			continue;
		}

		const openStart = i;
		while (i < len && text[i] === "`") {
			i++;
		}
		const runLen = i - openStart;

		// Search forward for a closing run of the same length.  When no
		// matching run is found, `i` already points past the opening run
		// and the outer loop resumes scanning from there.
		let j = i;
		while (j < len) {
			const innerFenced = findContainingRange(fencedRanges, j);
			if (innerFenced) {
				j = innerFenced.end;
				continue;
			}
			if (text[j] !== "`") {
				j++;
				continue;
			}
			const closeStart = j;
			while (j < len && text[j] === "`") {
				j++;
			}
			if (j - closeStart === runLen) {
				ranges.push({ start: openStart, end: j });
				i = j;
				break;
			}
		}
	}

	return ranges;
}

/**
 * Find the first range that contains the given offset, or undefined.
 */
function findContainingRange(ranges: readonly TextRange[], offset: number): TextRange | undefined {
	for (const range of ranges) {
		if (offset >= range.start && offset < range.end) {
			return range;
		}
		if (range.start > offset) {
			return undefined;
		}
	}
	return undefined;
}

/**
 * Check whether an offset falls inside any of the given code block ranges.
 *
 * @param ranges - Sorted array of code block ranges.
 * @param offset - The offset to test.
 * @returns True if the offset is inside a code block.
 */
export function isInCodeBlockRange(ranges: readonly TextRange[], offset: number): boolean {
	return findContainingRange(ranges, offset) !== undefined;
}

/**
 * Whether the second line of a document lets front matter open.
 *
 * Pandoc reads `---` followed by a blank line, or by a second delimiter, as two
 * thematic breaks rather than as front matter.  `getYamlFrontMatterRange` applies this
 * rule, and every reader of the front matter is built on it, so one document
 * never gets two answers about where its front matter is.
 *
 * @param secondLine - The second line of the document, with or without its
 *   carriage return.
 * @returns True when front matter can open on the line above.
 */
function opensFrontMatter(secondLine: string): boolean {
	const content = secondLine.trim();
	return content.length > 0 && content !== "---";
}

/**
 * Find the YAML front-matter range in a Quarto document.
 *
 * The front matter must open with `---` on line 0 and close with another
 * `---` on a subsequent line.  The returned
 * range starts at offset 0 and ends at the last character of the closing
 * delimiter line (the trailing newline is excluded), so that any `{...}`
 * content within is fully enclosed.
 *
 * A document of fewer than three lines has no front matter, and neither has one
 * whose second line is blank or is itself a delimiter.  Pandoc reads the two
 * `---` lines of `---\n\n---` as thematic breaks, so a range there would hide
 * every block a reader writes between them.
 *
 * @param text - The full document text.
 * @returns The front-matter range, or `undefined` when no closed front
 *   matter is present.
 */
export function getYamlFrontMatterRange(text: string): TextRange | undefined {
	const firstNewline = text.indexOf("\n");
	if (firstNewline === -1) {
		return undefined;
	}

	// `trim` removes a trailing carriage return, so a CRLF document needs no
	// line ending of its own here or in the closing scan below.
	if (text.slice(0, firstNewline).trim() !== "---") {
		return undefined;
	}

	const secondNewline = text.indexOf("\n", firstNewline + 1);
	if (secondNewline === -1) {
		return undefined;
	}
	if (!opensFrontMatter(text.slice(firstNewline + 1, secondNewline))) {
		return undefined;
	}

	// The second line is neither blank nor a delimiter, so the closing scan
	// starts below it rather than reading that line a second time.
	let lineStart = secondNewline + 1;
	while (lineStart <= text.length) {
		const nextNewline = text.indexOf("\n", lineStart);
		const lineEnd = nextNewline === -1 ? text.length : nextNewline;
		if (text.slice(lineStart, lineEnd).trim() === "---") {
			return { start: 0, end: lineEnd };
		}
		if (nextNewline === -1) {
			break;
		}
		lineStart = nextNewline + 1;
	}

	return undefined;
}

/**
 * Parse the YAML front matter of a Quarto document.
 *
 * Built on `getYamlFrontMatterRange` so that the metadata a reader sees and the
 * blocks a scanner finds agree on where the front matter ends.  A rule of its
 * own here would close on any line starting `---`, while the scanner needs a
 * line that trims to exactly `---`, and the two would disagree on the same
 * document.
 *
 * @param text - The full document text.
 * @returns The parsed mapping, or `undefined` when the document has no closed
 *   front matter, when it is empty, or when it does not parse.
 */
export function parseFrontMatter(text: string): unknown {
	const body = frontMatterBody(text);
	if (body === undefined) {
		return undefined;
	}
	try {
		return yaml.load(text.slice(body.start, body.end));
	} catch {
		return undefined;
	}
}

/**
 * The YAML of the front matter, without either delimiter line.
 *
 * Built on `getYamlFrontMatterRange` so that the metadata a reader sees and the
 * blocks a scanner finds agree on where the front matter ends.  Every reader
 * that needs the YAML itself rather than the whole delimited region takes it
 * from here, so no second reading of the two delimiters exists.
 *
 * @param text - The full document text.
 * @returns The range of the body, or `undefined` when the document has no closed
 *   front matter or the front matter is empty.
 */
export function frontMatterBody(text: string): TextRange | undefined {
	const range = getYamlFrontMatterRange(text);
	if (range === undefined) {
		return undefined;
	}
	const start = text.indexOf("\n") + 1;
	const end = text.lastIndexOf("\n", range.end - 1) + 1;
	return end <= start ? undefined : { start, end };
}
