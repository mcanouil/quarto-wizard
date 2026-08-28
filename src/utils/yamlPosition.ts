/**
 * Utilities for resolving YAML key paths from cursor positions.
 *
 * These functions map a line/column in a YAML (or Quarto .qmd) document
 * to a structured key path by tracking indentation levels.
 */

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
 * The blockquote markers a line starts with.
 *
 * Each marker takes up to three spaces, a `>`, and one optional space. The run
 * repeats for a nested quote.
 */
const BLOCKQUOTE_MARKERS = /^(?: {0,3}>[ \t]?)+/;

/**
 * A list item marker, which opens a container whose content is indented.
 *
 * The match runs to the first character of the content, so its length is the
 * column that content starts at.
 */
const LIST_ITEM = /^ *([-+*]|\d{1,9}[.)]) +(?=\S)/;

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

/**
 * How many spaces a line starts with.
 *
 * Spaces only, matching `OPENING_FENCE`: a tab counts as four columns, so a tab
 * is never part of a fence indent.
 */
function leadingSpaces(content: string): number {
	let index = 0;
	while (index < content.length && content.charCodeAt(index) === SPACE) {
		index++;
	}
	return index;
}

/** Whether a line holds nothing but whitespace, from a known offset onwards. */
function isBlankFrom(content: string, from: number): boolean {
	for (let index = from; index < content.length; index++) {
		const code = content.charCodeAt(index);
		if (code !== SPACE && code !== TAB) {
			return false;
		}
	}
	return true;
}

/** Drop a trailing carriage return left by a CRLF document. */
export function stripCarriageReturn(line: string): string {
	return line.endsWith("\r") ? line.slice(0, -1) : line;
}

/**
 * An opening code fence, on a line already stripped of blockquote markers.
 *
 * The indent is spaces only. A tab counts as four columns, so a tab-indented
 * fence is inside an indented code block and is not a fence at all.
 */
const OPENING_FENCE = /^( *)(`{3,}|~{3,})(.*)$/;

/** A line with its blockquote markers taken off. */
export interface QuotedLine {
	/** The line without the markers. */
	content: string;
	/** How many markers the line carried, so how deep the quote is. */
	depth: number;
}

/**
 * Take the blockquote markers off a line.
 *
 * A fence inside a blockquote is a real code block for Pandoc, and the markers
 * are structure rather than content, so every fence rule reads the line without
 * them.
 */
export function stripBlockquoteMarkers(line: string): QuotedLine {
	if (!mayBeQuoted(line)) {
		return { content: line, depth: 0 };
	}
	const found = BLOCKQUOTE_MARKERS.exec(line);
	if (found === null) {
		return { content: line, depth: 0 };
	}
	let depth = 0;
	for (let index = 0; index < found[0].length; index++) {
		if (found[0].charCodeAt(index) === GREATER_THAN) {
			depth++;
		}
	}
	return { content: line.slice(found[0].length), depth };
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
	return { indent: found[1].length, fence: found[2], info: found[3] };
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
	// same fence at the margin is literal text. The value is only ever lowered by
	// a line that dedents past it, so an unclosed container makes the reader
	// accept too much rather than lose a real block.
	let containerIndent = 0;

	for (let i = 0; i < lines.length; i++) {
		const rawLine = lines[i];
		const line = stripCarriageReturn(rawLine);
		const lineStart = offset;
		const lineEnd = lineStart + rawLine.length;
		// Advance offset past the newline for the next iteration.
		offset = lineEnd + (i < lines.length - 1 ? 1 : 0);

		const { content, depth } = stripBlockquoteMarkers(line);

		if (inBlock) {
			if (depth >= blockDepth) {
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

		const indent = leadingSpaces(content);
		if (!isBlankFrom(content, indent)) {
			// The marker test comes first, because a list item both opens a
			// container and sits at the indent of the one around it.
			const item = LIST_MARKERS.has(content[indent]) ? LIST_ITEM.exec(content) : null;
			containerIndent = item ? item[0].length : Math.min(containerIndent, indent);
		}

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
