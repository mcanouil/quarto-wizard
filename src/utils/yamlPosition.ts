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
export interface OpeningFence {
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
 * Exported so that a reader which derives the info string of a block, such as
 * the Typst block scanner, matches the fence exactly as this module does. Two
 * copies of the rule drift apart in silence.
 *
 * The indent limit is not applied here, because it depends on the container the
 * line sits in, which only a reader walking the whole document knows.
 *
 * @param content - One line, with its blockquote markers already removed.
 */
export function parseOpeningFence(content: string): OpeningFence | undefined {
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
 * Find all fenced code block body regions in the document text.
 *
 * Recognises both backtick (`` ``` ``) and tilde (`~~~`) fences, with
 * any info string (including executable cells like `{r}`, `{python}`).
 *
 * Each range starts _after_ the opening fence line (so the fence header
 * with its `{r}` or `{python}` attributes remains outside the range and
 * is still eligible for attribute completion/hover) and extends through
 * the end of the closing fence line (or end of text for unclosed blocks).
 *
 * @param text - The full document text.
 * @returns An array of ranges sorted by start offset.
 */
export function getCodeBlockRanges(text: string): TextRange[] {
	const ranges: TextRange[] = [];
	const lines = text.split("\n");
	let offset = 0;
	let inBlock = false;
	let blockStart = 0;
	let blockDepth = 0;
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

		if (inBlock) {
			if (depth > blockDepth) {
				// A line quoted more deeply than the block is content. Inside a fenced
				// block the container parsing stops, so the extra marker is text the
				// author wrote, and testing the stripped line for a closing fence
				// would close the block on its own body.
				continue;
			}
			if (depth === blockDepth) {
				// Check for closing fence: same character, at least as many
				// repetitions, optionally followed by whitespace, at the start of the
				// line.
				if (closingFenceRe?.test(content)) {
					ranges.push({ start: blockStart, end: lineEnd });
					inBlock = false;
				}
				continue;
			}
			// The blockquote ended, and the code block inside it ends with it. Lazy
			// continuation carries a paragraph across such a line, never the content
			// of a code block. The line itself is not part of the block, so it falls
			// through and can open the next one. The block ends at the end of the
			// line above, which is one character back from the start of this one.
			ranges.push({ start: blockStart, end: Math.max(blockStart, lineStart - 1) });
			inBlock = false;
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
			inBlock = true;
			blockDepth = depth;
			// Start the range after the opening fence line so that
			// attributes in the header (e.g. {r}, {python}) stay outside.
			blockStart = offset;
			// Compile the closing fence regex once per block.
			closingFenceRe = closingFenceRegExp(opening.fence);
		}
	}

	// Unclosed block extends to end of text.
	if (inBlock) {
		ranges.push({ start: blockStart, end: text.length });
	}

	return ranges;
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
export function getInlineCodeSpanRanges(text: string, fencedRanges: TextRange[]): TextRange[] {
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
function findContainingRange(ranges: TextRange[], offset: number): TextRange | undefined {
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
export function isInCodeBlockRange(ranges: TextRange[], offset: number): boolean {
	return findContainingRange(ranges, offset) !== undefined;
}

/**
 * Find the YAML front-matter range in a Quarto document.
 *
 * The front matter must open with `---` on line 0 and close with another
 * `---` on a subsequent line (mirroring `isInYamlRegion`).  The returned
 * range starts at offset 0 and ends at the last character of the closing
 * delimiter line (the trailing newline is excluded), so that any `{...}`
 * content within is fully enclosed.
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

	const firstLineEnd = firstNewline > 0 && text[firstNewline - 1] === "\r" ? firstNewline - 1 : firstNewline;
	if (text.slice(0, firstLineEnd).trim() !== "---") {
		return undefined;
	}

	let lineStart = firstNewline + 1;
	while (lineStart <= text.length) {
		const nextNewline = text.indexOf("\n", lineStart);
		const lineEnd = nextNewline === -1 ? text.length : nextNewline;
		const trimmedEnd = lineEnd > lineStart && text[lineEnd - 1] === "\r" ? lineEnd - 1 : lineEnd;
		if (text.slice(lineStart, trimmedEnd).trim() === "---") {
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
	const range = getYamlFrontMatterRange(text);
	if (range === undefined) {
		return undefined;
	}
	const bodyStart = text.indexOf("\n") + 1;
	const bodyEnd = text.lastIndexOf("\n", range.end - 1) + 1;
	if (bodyEnd <= bodyStart) {
		return undefined;
	}
	try {
		return yaml.load(text.slice(bodyStart, bodyEnd));
	} catch {
		return undefined;
	}
}

/**
 * Compute the indentation level (number of leading spaces) of a line.
 *
 * @param line - The text of the line.
 * @returns Number of leading spaces.
 */
export function getYamlIndentLevel(line: string): number {
	const match = /^( *)/.exec(line);
	return match ? match[1].length : 0;
}

/**
 * Determine whether a position falls inside a YAML region.
 *
 * For .qmd files the YAML front-matter is delimited by `---` at the very
 * start and end.  For .yml / .yaml files the entire document is YAML.
 *
 * @param lines - All lines of the document.
 * @param lineIndex - Zero-based line number of the cursor.
 * @param languageId - The VS Code language ID (e.g. "yaml", "quarto").
 * @returns True when the cursor is inside a YAML region.
 */
export function isInYamlRegion(lines: string[], lineIndex: number, languageId: string): boolean {
	if (languageId === "yaml") {
		return true;
	}

	// For quarto / qmd files the YAML front matter must start with --- on line 0.
	if (lines.length === 0 || lines[0].trim() !== "---") {
		return false;
	}

	let yamlEnd = -1;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i].trim() === "---") {
			yamlEnd = i;
			break;
		}
	}

	if (yamlEnd === -1) {
		return false;
	}

	return lineIndex > 0 && lineIndex < yamlEnd;
}

/**
 * A frame in the indentation stack used while walking YAML lines.
 */
interface IndentFrame {
	/** Indentation level (number of spaces). */
	indent: number;
	/** Key name at this level. */
	key: string;
}

/**
 * Resolve the YAML key path at a given cursor position.
 *
 * Walks the document from the top down, tracking indentation and key names,
 * to produce a path such as `["extensions", "modal", "size"]`.
 *
 * Only block-style YAML is supported (flow-style `{ }` mappings are not
 * parsed).  List item prefixes (`- `) are consumed but do not contribute
 * a path segment themselves.
 *
 * @param lines - All lines of the document.
 * @param lineIndex - Zero-based line number of the cursor.
 * @param languageId - The VS Code language ID.
 * @param cursorIndent - When provided and the target line is blank, trims
 *   the stack so only frames with indent strictly less than this value
 *   remain.  This makes the path match the cursor's indentation level
 *   rather than the deepest ancestor.
 * @returns The key path as a string array, or an empty array when the
 *          position is outside a YAML region.
 */
export function getYamlKeyPath(
	lines: string[],
	lineIndex: number,
	languageId: string,
	cursorIndent?: number,
): string[] {
	if (!isInYamlRegion(lines, lineIndex, languageId)) {
		return [];
	}

	// Determine the range of YAML lines to scan.
	let startLine = 0;
	if (languageId !== "yaml") {
		// Skip past the opening --- delimiter.
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].trim() === "---") {
				startLine = i + 1;
				break;
			}
		}
	}

	const stack: IndentFrame[] = [];

	for (let i = startLine; i <= lineIndex; i++) {
		const raw = lines[i];

		// Skip blank lines and comments.
		const trimmed = raw.trim();
		if (trimmed === "" || trimmed.startsWith("#") || trimmed === "---") {
			continue;
		}

		let effective = raw;
		let indent = getYamlIndentLevel(effective);

		// Strip list-item prefix so that `- key: value` is treated the same
		// as `key: value` at the same logical depth.
		const listMatch = /^(\s*)- (.*)$/.exec(effective);
		if (listMatch) {
			const prefixSpaces = listMatch[1].length;
			// Treat the key after `- ` as being at indent + 2 (the `- ` width).
			indent = prefixSpaces + 2;
			effective = " ".repeat(indent) + listMatch[2];
		}

		// Pop frames that are at the same or deeper indentation (sibling or deeper).
		while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
			stack.pop();
		}

		// Extract the key from a `key:` or `key: value` pattern.
		const keyMatch = /^\s*([^\s:][^:]*?)\s*:\s*/.exec(effective);
		if (keyMatch) {
			stack.push({ indent, key: keyMatch[1] });
		}
	}

	// When cursorIndent is provided and the target line is blank, trim the
	// stack so the path reflects the cursor's indentation level.
	if (cursorIndent !== undefined) {
		const targetLine = lines[lineIndex];
		if (targetLine.trim() === "") {
			while (stack.length > 0 && stack[stack.length - 1].indent >= cursorIndent) {
				stack.pop();
			}
		}
	}

	return stack.map((frame) => frame.key);
}

/**
 * Collect the set of existing sibling keys at a given parent path.
 *
 * For example, given the YAML:
 * ```yaml
 * extensions:
 *   modal:
 *     size: large
 *     colour: red
 * ```
 * Calling with `parentPath = ["extensions", "modal"]` returns `{"size", "colour"}`.
 * Calling with `parentPath = []` returns root-level keys.
 *
 * @param lines - All lines of the document.
 * @param parentPath - The key path to the parent node. Empty array for root-level keys.
 * @param languageId - The VS Code language ID (e.g. "yaml", "quarto").
 * @returns The set of key names that already exist at the target level.
 */
export function getExistingKeysAtPath(lines: string[], parentPath: string[], languageId: string): Set<string> {
	const result = new Set<string>();

	// Determine the range of YAML lines to scan.
	let startLine = 0;
	if (languageId !== "yaml") {
		// Skip past the opening --- delimiter for .qmd files.
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].trim() === "---") {
				startLine = i + 1;
				break;
			}
		}
	}

	// Find the YAML end boundary for .qmd files.
	let endLine = lines.length;
	if (languageId !== "yaml") {
		for (let i = startLine; i < lines.length; i++) {
			if (lines[i].trim() === "---") {
				endLine = i;
				break;
			}
		}
	}

	// Walk lines to locate the parent path.
	let targetLine = startLine;
	let targetIndent = 0;

	for (const segment of parentPath) {
		let found = false;
		for (let i = targetLine; i < endLine; i++) {
			const trimmed = lines[i].trim();
			if (trimmed === "" || trimmed.startsWith("#")) {
				continue;
			}

			const indent = getYamlIndentLevel(lines[i]);

			// Left the parent scope entirely.
			if (indent < targetIndent) {
				break;
			}

			// Skip deeper lines (children of siblings).
			if (indent > targetIndent) {
				continue;
			}

			const keyMatch = /^\s*([^\s:][^:]*?)\s*:/.exec(lines[i]);
			if (keyMatch && keyMatch[1] === segment) {
				// Found this segment; children are at indent + 2.
				targetLine = i + 1;
				targetIndent = indent + 2;
				found = true;
				break;
			}
		}
		if (!found) {
			return result;
		}
	}

	// Collect direct children at targetIndent.
	for (let i = targetLine; i < endLine; i++) {
		const trimmed = lines[i].trim();
		if (trimmed === "" || trimmed.startsWith("#")) {
			continue;
		}

		const indent = getYamlIndentLevel(lines[i]);

		// A line at shallower indent means we left the parent scope.
		if (indent < targetIndent) {
			break;
		}

		// Skip deeper lines (grandchildren).
		if (indent > targetIndent) {
			continue;
		}

		// Extract the key at the target indentation level.
		const keyMatch = /^\s*([^\s:][^:]*?)\s*:/.exec(lines[i]);
		if (keyMatch) {
			result.add(keyMatch[1]);
		}
	}

	return result;
}
