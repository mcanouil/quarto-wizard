/**
 * Utilities for resolving YAML key paths from cursor positions.
 *
 * These functions map a line/column in a YAML (or Quarto .qmd) document
 * to a structured key path by tracking indentation levels.
 */

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
