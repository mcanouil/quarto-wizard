/**
 * Lightweight parser for Quarto shortcode syntax: {{< name arg1 key="value" >}}
 *
 * Determines cursor context within a shortcode to drive completions.
 */

/**
 * Cursor context within a shortcode.
 * - "name": cursor is where the shortcode name should be (right after {{<).
 * - "argument": cursor is in a positional argument position.
 * - "attributeKey": cursor is in an attribute name position (before =).
 * - "attributeValue": cursor is in an attribute value position (after =).
 */
export type CursorContext = "name" | "argument" | "attributeKey" | "attributeValue";

/**
 * Result of parsing a shortcode at a given cursor position.
 */
export interface ShortcodeParseResult {
	/** The shortcode name, or null if the cursor is at the name position. */
	name: string | null;
	/** Positional arguments parsed so far. */
	arguments: string[];
	/** Named attributes parsed so far. */
	attributes: Record<string, string>;
	/** Where the cursor sits within the shortcode. */
	cursorContext: CursorContext;
	/** When cursorContext is "attributeValue", the attribute key being assigned. */
	currentAttributeKey?: string;
}

/**
 * Bounds of a shortcode in the text.
 */
export interface ShortcodeBounds {
	/** Start offset of the opening {{< delimiter. */
	start: number;
	/** End offset (exclusive) of the closing >}} delimiter. */
	end: number;
}

/**
 * Find the bounds of the shortcode surrounding the given offset.
 *
 * @param text - The full document text.
 * @param offset - The cursor offset within the text.
 * @returns The start and end offsets, or null if the cursor is not inside a shortcode.
 */
export function getShortcodeBounds(text: string, offset: number): ShortcodeBounds | null {
	// Search backwards for {{< from the cursor position.
	// We need to find the nearest {{< that is not already closed before the offset.
	let start = -1;
	for (let i = Math.min(offset, text.length) - 1; i >= 1; i--) {
		if (text[i - 1] === "{" && text[i] === "{") {
			// Check for {{< (the < can be right after {{ or after whitespace, but standard is {{<)
			const afterBraces = text.indexOf("<", i + 1);
			if (afterBraces === i + 1) {
				// Verify there is no >}} between this {{< and the offset
				const closeIdx = findClose(text, i - 1);
				if (closeIdx !== -1 && closeIdx < offset) {
					continue; // This shortcode is already closed before our cursor
				}
				start = i - 1;
				break;
			}
		}
	}

	if (start === -1) {
		return null;
	}

	// Search forwards for >}} from the opening
	const end = findClose(text, start);
	if (end === -1) {
		// Unclosed shortcode: treat end as end of the line or text
		const lineEnd = text.indexOf("\n", offset);
		return { start, end: lineEnd === -1 ? text.length : lineEnd };
	}

	// The cursor must be between start and end
	if (offset < start || offset > end) {
		return null;
	}

	return { start, end };
}

/**
 * Find the closing >}} for a shortcode starting at the given offset.
 *
 * @param text - The full document text.
 * @param openStart - The offset of the opening {{.
 * @returns The offset just past the closing }}, or -1 if not found.
 */
function findClose(text: string, openStart: number): number {
	// Search for >}} after the opening {{<
	let i = openStart + 3; // skip past {{<
	while (i < text.length) {
		if (text[i] === ">" && i + 2 < text.length && text[i + 1] === "}" && text[i + 2] === "}") {
			return i + 3;
		}
		// Handle quoted strings to avoid matching >}} inside quotes
		if (text[i] === '"') {
			i++;
			while (i < text.length && text[i] !== '"') {
				if (text[i] === "\\" && i + 1 < text.length) {
					i++; // skip escaped character
				}
				i++;
			}
		}
		i++;
	}
	return -1;
}

/**
 * Check whether the given offset is inside a shortcode.
 *
 * @param text - The full document text.
 * @param offset - The cursor offset within the text.
 * @returns True if the offset is inside a {{< ... >}} construct.
 */
export function isInsideShortcode(text: string, offset: number): boolean {
	return getShortcodeBounds(text, offset) !== null;
}

/**
 * Parse the shortcode surrounding the cursor and determine the cursor context.
 *
 * @param text - The full document text.
 * @param offset - The cursor offset within the text.
 * @returns The parse result, or null if the cursor is not inside a shortcode.
 */
export function parseShortcodeAtPosition(text: string, offset: number): ShortcodeParseResult | null {
	const bounds = getShortcodeBounds(text, offset);
	if (!bounds) {
		return null;
	}

	// Extract the content between {{< and the cursor
	const contentStart = bounds.start + 3; // skip {{<
	const beforeCursor = text.slice(contentStart, offset);

	// Tokenise everything before the cursor
	return tokenise(beforeCursor);
}

/**
 * Tokenise the content before the cursor to determine context.
 */
function tokenise(beforeCursor: string): ShortcodeParseResult {
	const args: string[] = [];
	const attrs: Record<string, string> = {};

	// Strip leading whitespace
	const trimmed = beforeCursor.replace(/^\s+/, "");

	if (trimmed.length === 0) {
		return {
			name: null,
			arguments: args,
			attributes: attrs,
			cursorContext: "name",
		};
	}

	const tokens = tokeniseString(trimmed);

	if (tokens.length === 0) {
		return {
			name: null,
			arguments: args,
			attributes: attrs,
			cursorContext: "name",
		};
	}

	// The first token is the shortcode name
	const name = tokens[0].value;
	const endsWithWhitespace = /\s$/.test(beforeCursor);

	// If we only have the name token and no trailing whitespace, we are still typing the name
	if (tokens.length === 1 && !endsWithWhitespace) {
		return {
			name: name,
			arguments: args,
			attributes: attrs,
			cursorContext: "name",
		};
	}

	// Process remaining tokens
	let cursorContext: CursorContext = "attributeKey";
	let currentAttributeKey: string | undefined;

	for (let i = 1; i < tokens.length; i++) {
		const token = tokens[i];

		if (token.type === "keyValue") {
			attrs[token.key!] = token.value;
		} else if (token.type === "keyOnly") {
			// A token ending with = means we are about to type a value
			if (i === tokens.length - 1 && !endsWithWhitespace) {
				cursorContext = "attributeValue";
				currentAttributeKey = token.value;
			} else {
				attrs[token.value] = "";
			}
		} else {
			// Positional argument or attribute name
			// If it contains =, it is a partial key=value
			if (token.value.includes("=")) {
				const eqIdx = token.value.indexOf("=");
				const key = token.value.slice(0, eqIdx);
				const val = token.value.slice(eqIdx + 1);
				if (i === tokens.length - 1 && !endsWithWhitespace) {
					cursorContext = "attributeValue";
					currentAttributeKey = key;
					attrs[key] = val;
				} else {
					attrs[key] = val;
				}
			} else {
				args.push(token.value);
			}
		}
	}

	// If the last token was a complete key=value and there is trailing whitespace,
	// we are ready for a new attribute key
	if (endsWithWhitespace) {
		cursorContext = "attributeKey";
		currentAttributeKey = undefined;
	}

	// If we ended mid-token (no trailing whitespace) and the last token is a plain word,
	// it could be a partial attribute key
	if (!endsWithWhitespace && tokens.length > 1) {
		const lastToken = tokens[tokens.length - 1];
		if (lastToken.type === "word" && !lastToken.value.includes("=")) {
			cursorContext = "attributeKey";
		}
	}

	const result: ShortcodeParseResult = {
		name,
		arguments: args,
		attributes: attrs,
		cursorContext,
	};

	if (currentAttributeKey !== undefined) {
		result.currentAttributeKey = currentAttributeKey;
	}

	return result;
}

interface Token {
	type: "word" | "keyValue" | "keyOnly";
	value: string;
	key?: string;
}

/**
 * Split the shortcode content into tokens, respecting quoted values.
 */
function tokeniseString(input: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;

	while (i < input.length) {
		// Skip whitespace
		while (i < input.length && /\s/.test(input[i])) {
			i++;
		}

		if (i >= input.length) {
			break;
		}

		// Read a token
		let token = "";
		let key: string | undefined;

		if (input[i] === '"') {
			// Quoted string (standalone or as part of key="value")
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
			tokens.push({ type: "word", value: token });
		} else {
			// Unquoted token: read until whitespace
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
			} else {
				tokens.push({ type: "word", value: token });
			}
		}
	}

	return tokens;
}
