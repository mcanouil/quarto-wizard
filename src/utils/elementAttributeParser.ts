/**
 * Lightweight parser for Pandoc element attribute syntax:
 * - Spans:      [text]{.class attr=value}
 * - Links:      [text](url){.class attr=value}
 * - Images:     ![alt](url){.class attr=value}
 * - Divs:       ::: {.class attr=value}
 * - Code spans: `code`{.class attr=value}
 *
 * Determines cursor context within an attribute block to drive completions and hovers.
 */

/**
 * The Pandoc element type surrounding an attribute block.
 */
export type PandocElementType = "Div" | "Span" | "Code" | "Header";

/**
 * Cursor context within an element attribute block.
 * - "attributeKey": cursor is in an attribute name position (before =).
 * - "attributeValue": cursor is in an attribute value position (after =).
 */
export type ElementAttributeCursorContext = "attributeKey" | "attributeValue";

/**
 * Result of parsing element attributes at a given cursor position.
 */
export interface ElementAttributeParseResult {
	/** CSS classes extracted from `.class` syntax. */
	classes: string[];
	/** IDs extracted from `#id` syntax. */
	ids: string[];
	/** Named attributes parsed so far. */
	attributes: Record<string, string>;
	/** Where the cursor sits within the attribute block. */
	cursorContext: ElementAttributeCursorContext;
	/** When cursorContext is "attributeValue", the attribute key being assigned. */
	currentAttributeKey?: string;
	/** Partial word at cursor for filtering completions. */
	currentWord?: string;
	/** The Pandoc structural element type (Div, Span, Code, or Header). */
	elementType: PandocElementType;
}

/**
 * Bounds of an attribute block in the text.
 */
export interface AttributeBounds {
	/** Offset of the opening `{`. */
	start: number;
	/** Offset just past the closing `}`. */
	end: number;
	/** The Pandoc structural element type. */
	elementType: PandocElementType;
}

/**
 * Find the bounds of a Pandoc attribute block surrounding the given offset.
 *
 * Validates that the `{` is preceded by `]` (span), `)` (link/image),
 * `:::` with optional spaces (div), or `` ` `` (code span), confirming a
 * Pandoc attribute context rather than YAML.
 *
 * @param text - The full document text.
 * @param offset - The cursor offset within the text.
 * @returns The start and end offsets, or null if the cursor is not inside an attribute block.
 */
export function getAttributeBounds(text: string, offset: number): AttributeBounds | null {
	// Search backwards for `{` that is not inside a string
	let openBrace = -1;
	let depth = 0;

	for (let i = Math.min(offset, text.length) - 1; i >= 0; i--) {
		const ch = text[i];

		if (ch === "}") {
			depth++;
		} else if (ch === "{") {
			if (depth > 0) {
				depth--;
			} else {
				openBrace = i;
				break;
			}
		} else if (ch === "\n" && i < offset - 1) {
			// Attribute blocks on a different line from the cursor are not relevant,
			// unless the { is on the same line. Check if we have crossed a line boundary
			// without finding { -- but divs can be multiline so we continue searching.
		}
	}

	if (openBrace === -1) {
		return null;
	}

	// Validate the context before the `{`
	const elementType = isPandocAttributeContext(text, openBrace);
	if (!elementType) {
		return null;
	}

	// Search forward for the matching `}`
	const closeBrace = findClosingBrace(text, openBrace);

	if (closeBrace === -1) {
		// Unclosed attribute block: treat end as end of the line or text
		const lineEnd = text.indexOf("\n", offset);
		const end = lineEnd === -1 ? text.length : lineEnd;

		// Cursor must be between open brace and end
		if (offset <= openBrace || offset > end) {
			return null;
		}
		return { start: openBrace, end, elementType };
	}

	// Cursor must be inside the braces (after `{`, before or at `}`)
	if (offset <= openBrace || offset > closeBrace) {
		return null;
	}

	return { start: openBrace, end: closeBrace, elementType };
}

/**
 * Determine the Pandoc element type for a `{` at the given position.
 *
 * Valid contexts:
 * - `]` immediately before `{` (Span)
 * - `)` immediately before `{` (Span) — link/image: `[text](url){` or `![alt](url){`
 * - `` ` `` immediately before `{` (Code)
 * - `:::` with optional spaces before `{` (Div)
 * - `# Heading text ` before `{` at line start (Header)
 *
 * @returns The element type, or null if the brace is not in a Pandoc attribute context.
 */
function isPandocAttributeContext(text: string, bracePos: number): PandocElementType | null {
	if (bracePos === 0) {
		return null;
	}

	const charBefore = text[bracePos - 1];

	// Span: ]{...}
	if (charBefore === "]") {
		return "Span";
	}

	// Link / Image: [text](url){...} or ![alt](url){...}
	if (charBefore === ")") {
		return "Span";
	}

	// Code span: `{...}
	if (charBefore === "`") {
		return "Code";
	}

	// Find the start of the line containing the brace.
	const lineStart = text.lastIndexOf("\n", bracePos - 1) + 1;

	// Header: # Heading text {... or ## Heading text {... (up to 6 #)
	const lineBeforeBrace = text.slice(lineStart, bracePos);
	if (/^#{1,6}\s+.*\s$/.test(lineBeforeBrace)) {
		return "Header";
	}

	// Div: ::: {... or :::{...
	// Look backwards from the brace, skipping optional spaces, for :::
	let i = bracePos - 1;
	while (i >= 0 && text[i] === " ") {
		i--;
	}

	// Need at least 3 colons
	let colonCount = 0;
	while (i >= 0 && text[i] === ":") {
		colonCount++;
		i--;
	}

	if (colonCount >= 3) {
		// Verify that the colons are at the start of a line or start of text
		if (i < 0 || text[i] === "\n") {
			return "Div";
		}
	}

	return null;
}

/**
 * Find the closing `}` for an attribute block starting at the given offset.
 *
 * @param text - The full document text.
 * @param openBrace - The offset of the opening `{`.
 * @returns The offset just past the closing `}`, or -1 if not found.
 */
function findClosingBrace(text: string, openBrace: number): number {
	let i = openBrace + 1;

	while (i < text.length) {
		const ch = text[i];

		if (ch === "}") {
			return i + 1;
		}

		// Handle quoted strings to avoid matching } inside quotes
		if (ch === '"') {
			i++;
			while (i < text.length && text[i] !== '"') {
				if (text[i] === "\\" && i + 1 < text.length) {
					i++; // skip escaped character
				}
				i++;
			}
		}

		// Attribute blocks should not span multiple lines in practice
		if (ch === "\n") {
			return -1;
		}

		i++;
	}

	return -1;
}

/**
 * Parse element attributes surrounding the cursor and determine the cursor context.
 *
 * @param text - The full document text.
 * @param offset - The cursor offset within the text.
 * @returns The parse result, or null if the cursor is not inside an attribute block.
 */
export function parseAttributeAtPosition(text: string, offset: number): ElementAttributeParseResult | null {
	const bounds = getAttributeBounds(text, offset);
	if (!bounds) {
		return null;
	}

	// Extract content between `{` and the cursor
	const contentStart = bounds.start + 1;
	const beforeCursor = text.slice(contentStart, offset);

	const tokenised = tokeniseAttributes(beforeCursor);
	return { ...tokenised, elementType: bounds.elementType };
}

/**
 * Intermediate result from tokenising, before `elementType` is known.
 */
interface TokeniseResult {
	classes: string[];
	ids: string[];
	attributes: Record<string, string>;
	cursorContext: ElementAttributeCursorContext;
	currentAttributeKey?: string;
	currentWord?: string;
}

/**
 * Tokenise attribute content before the cursor to determine context.
 */
function tokeniseAttributes(beforeCursor: string): TokeniseResult {
	const classes: string[] = [];
	const ids: string[] = [];
	const attributes: Record<string, string> = {};
	let cursorContext: ElementAttributeCursorContext = "attributeKey";
	let currentAttributeKey: string | undefined;
	let currentWord: string | undefined;

	const trimmed = beforeCursor.trimStart();

	if (trimmed.length === 0) {
		return { classes, ids, attributes, cursorContext: "attributeKey" };
	}

	const tokens = tokeniseAttributeString(trimmed);
	const endsWithWhitespace = /\s$/.test(beforeCursor);

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		const isLast = i === tokens.length - 1;

		switch (token.type) {
			case "class":
				classes.push(token.value);
				break;

			case "id":
				ids.push(token.value);
				break;

			case "keyValue":
				attributes[token.key!] = token.value;
				if (isLast && !endsWithWhitespace) {
					cursorContext = "attributeValue";
					currentAttributeKey = token.key;
				}
				break;

			case "keyOnly":
				if (isLast) {
					cursorContext = "attributeValue";
					currentAttributeKey = token.value;
				} else {
					attributes[token.value] = "";
				}
				break;

			case "word":
				if (isLast && !endsWithWhitespace) {
					cursorContext = "attributeKey";
					currentWord = token.value;
				}
				break;
		}
	}

	if (endsWithWhitespace && tokens.length > 0) {
		const lastToken = tokens[tokens.length - 1];
		if (lastToken.type !== "keyOnly") {
			cursorContext = "attributeKey";
			currentAttributeKey = undefined;
			currentWord = undefined;
		}
	}

	const result: TokeniseResult = { classes, ids, attributes, cursorContext };

	if (currentAttributeKey !== undefined) {
		result.currentAttributeKey = currentAttributeKey;
	}

	if (currentWord !== undefined) {
		result.currentWord = currentWord;
	}

	return result;
}

interface AttributeToken {
	type: "class" | "id" | "keyValue" | "keyOnly" | "word";
	value: string;
	key?: string;
}

/**
 * Split attribute content into tokens, respecting quoted values and class/id prefixes.
 */
function tokeniseAttributeString(input: string): AttributeToken[] {
	const tokens: AttributeToken[] = [];
	let i = 0;

	while (i < input.length) {
		// Skip whitespace
		while (i < input.length && /\s/.test(input[i])) {
			i++;
		}

		if (i >= input.length) {
			break;
		}

		// Class: .className
		if (input[i] === ".") {
			i++;
			let className = "";
			while (i < input.length && /[a-zA-Z0-9_-]/.test(input[i])) {
				className += input[i];
				i++;
			}
			tokens.push({ type: "class", value: className });
			continue;
		}

		// ID: #idName
		if (input[i] === "#") {
			i++;
			let idName = "";
			while (i < input.length && /[a-zA-Z0-9_-]/.test(input[i])) {
				idName += input[i];
				i++;
			}
			tokens.push({ type: "id", value: idName });
			continue;
		}

		// Key-value pair or plain word
		let token = "";
		let key: string | undefined;

		while (i < input.length && !/\s/.test(input[i])) {
			if (input[i] === "=" && key === undefined) {
				key = token;
				token = "";
				i++;
				// Check if value is quoted
				if (i < input.length && input[i] === '"') {
					i++; // skip opening quote
					while (i < input.length && input[i] !== '"') {
						if (input[i] === "\\" && i + 1 < input.length) {
							token += input[i + 1];
							i += 2;
						} else {
							token += input[i];
							i++;
						}
					}
					if (i < input.length) {
						i++; // skip closing quote
					}
					break;
				}
			} else {
				token += input[i];
				i++;
			}
		}

		if (key !== undefined) {
			if (token.length > 0) {
				tokens.push({ type: "keyValue", value: token, key });
			} else {
				tokens.push({ type: "keyOnly", value: key });
			}
		} else if (token.length > 0) {
			tokens.push({ type: "word", value: token });
		}
	}

	return tokens;
}
