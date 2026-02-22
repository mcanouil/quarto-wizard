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
	let fenceChar = "";
	let fenceLength = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const lineStart = offset;
		const lineEnd = lineStart + line.length;
		// Advance offset past the newline for the next iteration.
		offset = lineEnd + (i < lines.length - 1 ? 1 : 0);

		if (inBlock) {
			// Check for closing fence: same character, at least as many repetitions,
			// optionally followed by whitespace, at the start of the line.
			const closeMatch = new RegExp(`^${fenceChar}{${fenceLength},}\\s*$`).exec(line);
			if (closeMatch) {
				ranges.push({ start: blockStart, end: lineEnd });
				inBlock = false;
			}
			continue;
		}

		// Check for opening fence at the start of the line.
		const openMatch = /^(`{3,}|~{3,})(.*)$/.exec(line);
		if (openMatch) {
			// The info string must not contain backticks when using backtick fences.
			if (openMatch[1][0] === "`" && openMatch[2].includes("`")) {
				continue;
			}
			inBlock = true;
			// Start the range after the opening fence line so that
			// attributes in the header (e.g. {r}, {python}) stay outside.
			blockStart = offset;
			fenceChar = openMatch[1][0];
			fenceLength = openMatch[1].length;
		}
	}

	// Unclosed block extends to end of text.
	if (inBlock) {
		ranges.push({ start: blockStart, end: text.length });
	}

	return ranges;
}

/**
 * Check whether an offset falls inside any of the given code block ranges.
 *
 * @param ranges - Sorted array of code block ranges.
 * @param offset - The offset to test.
 * @returns True if the offset is inside a code block.
 */
export function isInCodeBlockRange(ranges: TextRange[], offset: number): boolean {
	for (const range of ranges) {
		if (offset >= range.start && offset < range.end) {
			return true;
		}
		if (range.start > offset) {
			break;
		}
	}
	return false;
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
