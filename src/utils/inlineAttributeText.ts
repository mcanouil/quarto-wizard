import { isPandocAttributeContext } from "./elementAttributeParser";
import {
	findFencedBlocks,
	getFenceGuardRanges,
	getInlineCodeSpanRanges,
	getYamlFrontMatterRange,
	isInCodeBlockRange,
	type FencedBlock,
	type TextRange,
} from "./yamlPosition";

/**
 * Describes a span of unnecessary whitespace around an `=` sign
 * that should be removed.
 */
export interface SpaceAroundEquals {
	/** Start offset in the source text. */
	start: number;
	/** End offset (exclusive) in the source text. */
	end: number;
	/** The corrected text that should replace the range. */
	replacement: string;
}

/**
 * Find all occurrences of spaces around `=` in key-value assignments
 * within the given text.
 *
 * Tracks quoted strings (single and double, with backslash escaping)
 * so that `=` signs inside quoted values are not flagged.
 *
 * Returns one entry per assignment where spaces exist on either or
 * both sides of the `=`.
 */
export function findSpacesAroundEquals(text: string): SpaceAroundEquals[] {
	const results: SpaceAroundEquals[] = [];
	let i = 0;

	while (i < text.length) {
		const ch = text[i];

		// Skip quoted strings.
		if (ch === '"' || ch === "'") {
			i = skipQuotedString(text, i);
			continue;
		}

		if (ch !== "=") {
			i++;
			continue;
		}

		// We found an `=` outside of quotes.
		// Look backward for trailing spaces after an identifier.
		let spacesBefore = 0;
		let j = i - 1;
		while (j >= 0 && text[j] === " ") {
			spacesBefore++;
			j--;
		}

		// The character before the spaces must be a word character
		// (part of an identifier) for this to be a key-value assignment.
		if (j < 0 || !/[\w-]/.test(text[j])) {
			i++;
			continue;
		}

		// Look forward for leading spaces before the value.
		let spacesAfter = 0;
		let k = i + 1;
		while (k < text.length && text[k] === " ") {
			spacesAfter++;
			k++;
		}

		// There must be a value character after the spaces (or a quote).
		if (k >= text.length) {
			i++;
			continue;
		}

		if (spacesBefore === 0 && spacesAfter === 0) {
			i++;
			continue;
		}

		// Build the identifier preceding the spaces.
		const idEnd = j + 1;
		let idStart = idEnd;
		while (idStart > 0 && /[\w-]/.test(text[idStart - 1])) {
			idStart--;
		}
		const identifier = text.slice(idStart, idEnd);

		// The replacement collapses spaces: `identifier=`.
		// We include the identifier and `=` but not the value so that
		// the replacement range is self-contained.
		const rangeStart = idStart;
		const rangeEnd = k;
		const replacement = `${identifier}=`;

		results.push({ start: rangeStart, end: rangeEnd, replacement });

		i = k;
	}

	return results;
}

/**
 * Describes a `key=` assignment with no value following the `=`.
 */
export interface EmptyValueAssignment {
	/** The attribute name preceding the `=`. */
	key: string;
	/** Start offset in the source text (beginning of the identifier). */
	start: number;
	/** End offset (exclusive), one past the `=` sign. */
	end: number;
	/** The corrected text: `key=""`. */
	replacement: string;
}

/**
 * Find all occurrences of `key=` (with no value after `=`) in the given text.
 *
 * Tracks quoted strings so that `=` inside quoted values is not flagged.
 * Does not overlap with `findSpacesAroundEquals`, which skips `=` with no
 * value after it.
 *
 * Note: this function does not special-case `}` because `extractBlocks`
 * already strips delimiters before passing content here.
 *
 * Returns one entry per assignment where `=` has no value following it.
 */
export function findEmptyValueAssignments(text: string): EmptyValueAssignment[] {
	const results: EmptyValueAssignment[] = [];
	let i = 0;

	while (i < text.length) {
		const ch = text[i];

		// Skip quoted strings.
		if (ch === '"' || ch === "'") {
			i = skipQuotedString(text, i);
			continue;
		}

		if (ch !== "=") {
			i++;
			continue;
		}

		// We found an `=` outside of quotes.
		// Look backward past optional whitespace to find an identifier.
		let j = i - 1;
		while (j >= 0 && /[ \t]/.test(text[j])) {
			j--;
		}

		// The character before the whitespace must be a word character.
		if (j < 0 || !/[\w-]/.test(text[j])) {
			i++;
			continue;
		}

		// Look forward: skip any whitespace after `=`.
		let k = i + 1;
		while (k < text.length && /[ \t]/.test(text[k])) {
			k++;
		}

		// If there IS a non-whitespace character after the `=`, this is not empty.
		if (k < text.length && !/\s/.test(text[k])) {
			i = k;
			continue;
		}

		// Build the identifier.
		const idEnd = j + 1;
		let idStart = idEnd;
		while (idStart > 0 && /[\w-]/.test(text[idStart - 1])) {
			idStart--;
		}
		const identifier = text.slice(idStart, idEnd);

		// Range covers from identifier start through `=` (and any spaces between).
		const rangeEnd = i + 1;
		results.push({
			key: identifier,
			start: idStart,
			end: rangeEnd,
			replacement: `${identifier}=""`,
		});

		i = rangeEnd;
	}

	return results;
}

/**
 * Advance past a quoted string, handling backslash escapes.
 * Returns the index after the closing quote (or end of text).
 */
function skipQuotedString(text: string, start: number): number {
	const quote = text[start];
	let i = start + 1;
	while (i < text.length) {
		if (text[i] === "\\") {
			i += 2;
			continue;
		}
		if (text[i] === quote) {
			return i + 1;
		}
		i++;
	}
	return i;
}

/**
 * Pattern for Pandoc element attribute blocks:
 * - Span: `]{...}`
 * - Code: `` `...`{...} ``
 * - Div: `:::{...}` or `::: {...}`
 * - Header: `# ... {...}`
 */
const ELEMENT_ATTRIBUTE_RE = /\{[^}]*\}/g;

/**
 * Pattern for Quarto shortcode blocks: `{{< ... >}}`
 */
const SHORTCODE_RE = /\{\{<[^>]*>\}\}/g;

export interface BlockMatch {
	content: string;
	contentOffset: number;
	type: "element" | "shortcode";
	/** Absolute offset of the full match start (the opening delimiter). */
	matchStart: number;
}

/**
 * Check whether a match range overlaps any exclusion range.
 *
 * Fenced code blocks use full overlap (start, end, or spanning) because an
 * attribute block can legitimately straddle a fence boundary only when it is
 * not really an attribute.
 *
 * Inline code spans use a stricter rule: only exclude when the match start
 * lies inside an inline span. An attribute that follows a closing run, as in
 * `` `code`{=html} ``, starts outside the span and stays eligible, while the
 * span itself is still skipped.
 */
function overlapsExclusionRanges(
	fencedRanges: readonly TextRange[],
	inlineRanges: readonly TextRange[],
	matchStart: number,
	matchEnd: number,
): boolean {
	if (
		isInCodeBlockRange(fencedRanges, matchStart) ||
		isInCodeBlockRange(fencedRanges, matchEnd) ||
		fencedRanges.some((r) => matchStart < r.start && matchEnd >= r.start)
	) {
		return true;
	}
	return isInCodeBlockRange(inlineRanges, matchStart);
}

/**
 * Extract all attribute blocks and shortcode blocks from document text,
 * excluding matches that fall inside fenced code blocks, the YAML front
 * matter, or inline code spans.
 */
export function extractBlocks(text: string, fencedBlocks?: readonly FencedBlock[]): BlockMatch[] {
	const codeRanges = fencedBlocks ?? findFencedBlocks(text);
	const yamlRange = getYamlFrontMatterRange(text);
	const withYaml = (ranges: readonly TextRange[]): readonly TextRange[] =>
		yamlRange ? [yamlRange, ...ranges] : ranges;
	const fencedRanges = withYaml(codeRanges);
	// The body ranges above keep the `{r}` of a fence header outside the
	// exclusion, so it is still read as an attribute. The backtick scan needs
	// the opening run guarded instead, or the run of one fence pairs with the
	// run of the next and the span swallows the prose between them.
	const inlineRanges = getInlineCodeSpanRanges(text, withYaml(getFenceGuardRanges(codeRanges)));
	const blocks: BlockMatch[] = [];

	for (const match of text.matchAll(ELEMENT_ATTRIBUTE_RE)) {
		if (match.index === undefined) {
			continue;
		}
		// Only treat the brace as an attribute block when it opens a genuine
		// Pandoc attribute context (span, link/image, code, div, header).
		// This excludes braces in math such as `\text{X = Y}` and discards
		// most non-attribute braces before the costlier range overlap check.
		if (isPandocAttributeContext(text, match.index) === null) {
			continue;
		}
		if (overlapsExclusionRanges(fencedRanges, inlineRanges, match.index, match.index + match[0].length - 1)) {
			continue;
		}
		// Content is everything between { and }.
		const content = match[0].slice(1, -1);
		const contentOffset = match.index + 1;
		blocks.push({ content, contentOffset, type: "element", matchStart: match.index });
	}

	for (const match of text.matchAll(SHORTCODE_RE)) {
		if (match.index === undefined) {
			continue;
		}
		if (overlapsExclusionRanges(fencedRanges, inlineRanges, match.index, match.index + match[0].length - 1)) {
			continue;
		}
		// Content is everything between {{< and >}}.
		const content = match[0].slice(3, -3);
		const contentOffset = match.index + 3;
		blocks.push({ content, contentOffset, type: "shortcode", matchStart: match.index });
	}

	return blocks;
}

// ---------------------------------------------------------------------------
// Value-location helpers
// ---------------------------------------------------------------------------

/**
 * Offsets of a key=value pair within block content, relative to the content start.
 */
export interface KeyValueOffset {
	keyStart: number;
	keyEnd: number;
	valueStart: number;
	valueEnd: number;
}

/**
 * Locate a `key=value` or `key="value"` assignment within block content.
 * Walks character by character, skipping quoted strings, to avoid false matches.
 *
 * @returns Offsets relative to content start, or null if the key is not found.
 */
export function findKeyValueOffset(content: string, key: string): KeyValueOffset | null {
	let i = 0;

	while (i < content.length) {
		// Skip whitespace.
		while (i < content.length && /\s/.test(content[i])) {
			i++;
		}

		if (i >= content.length) {
			break;
		}

		// Skip class (.name) and id (#name) prefixes.
		if (content[i] === "." || content[i] === "#") {
			i++;
			while (i < content.length && /[\w-]/.test(content[i])) {
				i++;
			}
			continue;
		}

		// Read a word token.
		const wordStart = i;
		while (i < content.length && /[\w-]/.test(content[i])) {
			i++;
		}

		if (i === wordStart) {
			// Not a word character; skip quoted strings or other characters.
			if (content[i] === '"' || content[i] === "'") {
				i = skipQuotedString(content, i);
			} else {
				i++;
			}
			continue;
		}

		const word = content.slice(wordStart, i);

		// Check for `=`.
		if (i < content.length && content[i] === "=") {
			const eqPos = i;
			i++; // skip =

			// Read value.
			let valueStart: number;
			let valueEnd: number;

			if (i < content.length && content[i] === '"') {
				// Quoted value: include the quotes in the range.
				valueStart = i;
				i++; // skip opening quote
				while (i < content.length && content[i] !== '"') {
					if (content[i] === "\\" && i + 1 < content.length) {
						i++;
					}
					i++;
				}
				if (i < content.length) {
					i++; // skip closing quote
				}
				valueEnd = i;
			} else {
				// Unquoted value.
				valueStart = i;
				while (i < content.length && !/\s/.test(content[i])) {
					i++;
				}
				valueEnd = i;
			}

			if (word === key) {
				return {
					keyStart: wordStart,
					keyEnd: eqPos,
					valueStart,
					valueEnd,
				};
			}
		}
		// Otherwise word without = (positional argument); continue.
	}

	return null;
}

/**
 * Offsets of a positional argument within shortcode content.
 */
export interface ArgumentOffset {
	start: number;
	end: number;
}

/**
 * Locate the Nth positional argument token in shortcode content.
 * Skips the shortcode name (first token) and any key=value pairs.
 *
 * @returns Offsets relative to content start, or null if index is out of range.
 */
export function findArgumentOffset(content: string, argIndex: number): ArgumentOffset | null {
	let i = 0;
	let positionalCount = 0;
	let isFirst = true;

	while (i < content.length) {
		// Skip whitespace.
		while (i < content.length && /\s/.test(content[i])) {
			i++;
		}

		if (i >= content.length) {
			break;
		}

		// Read a token.
		const tokenStart = i;

		if (content[i] === '"') {
			// Quoted token.
			i++; // skip opening quote
			while (i < content.length && content[i] !== '"') {
				if (content[i] === "\\" && i + 1 < content.length) {
					i++;
				}
				i++;
			}
			if (i < content.length) {
				i++; // skip closing quote
			}
		} else {
			// Unquoted token: read until whitespace.
			while (i < content.length && !/\s/.test(content[i])) {
				if (content[i] === "=" && i > tokenStart) {
					// This is a key=value; skip the value part.
					i++; // skip =
					if (i < content.length && content[i] === '"') {
						i++;
						while (i < content.length && content[i] !== '"') {
							if (content[i] === "\\" && i + 1 < content.length) {
								i++;
							}
							i++;
						}
						if (i < content.length) {
							i++;
						}
					} else {
						while (i < content.length && !/\s/.test(content[i])) {
							i++;
						}
					}
					break;
				}
				i++;
			}
		}

		const tokenEnd = i;
		const token = content.slice(tokenStart, tokenEnd);

		// The first token is the shortcode name; skip it.
		if (isFirst) {
			isFirst = false;
			continue;
		}

		// Skip key=value tokens (they contain = after the first char).
		if (token.includes("=")) {
			continue;
		}

		// This is a positional argument.
		if (positionalCount === argIndex) {
			return { start: tokenStart, end: tokenEnd };
		}
		positionalCount++;
	}

	return null;
}

// ---------------------------------------------------------------------------
// Bare-word extraction helpers
// ---------------------------------------------------------------------------

/**
 * A bare word token (not `.class`, `#id`, or `key=value`) with its
 * offset within the content string.
 */
export interface BareWord {
	word: string;
	start: number;
	end: number;
}

/**
 * Extract all bare word tokens from element attribute content.
 *
 * Bare words are tokens that are not class prefixes (`.name`), id
 * prefixes (`#name`), or key-value assignments (`key=value`).
 */
export function extractBareWords(content: string): BareWord[] {
	const results: BareWord[] = [];
	let i = 0;

	while (i < content.length) {
		// Skip whitespace.
		while (i < content.length && /\s/.test(content[i])) {
			i++;
		}

		if (i >= content.length) {
			break;
		}

		// Skip class (.name) and id (#name) prefixes, but only when
		// followed by at least one word character.
		if ((content[i] === "." || content[i] === "#") && i + 1 < content.length && /[\w]/.test(content[i + 1])) {
			i++;
			while (i < content.length && /[\w-]/.test(content[i])) {
				i++;
			}
			continue;
		}

		// Skip quoted strings.
		if (content[i] === '"' || content[i] === "'") {
			i = skipQuotedString(content, i);
			continue;
		}

		// Read a word token.
		const wordStart = i;
		while (i < content.length && /[\w-]/.test(content[i])) {
			i++;
		}

		if (i === wordStart) {
			// Non-word, non-quote character (e.g. `=`); skip it.
			i++;
			continue;
		}

		const word = content.slice(wordStart, i);

		// Bare hyphens are not valid attribute names; discard them.
		if (!/\w/.test(word)) {
			continue;
		}

		// Check for `=` following the word (key=value or key=).
		if (i < content.length && content[i] === "=") {
			// This is a key=value or key= assignment; skip past the value.
			i++; // skip =
			if (i < content.length && (content[i] === '"' || content[i] === "'")) {
				i = skipQuotedString(content, i);
			} else {
				while (i < content.length && !/\s/.test(content[i])) {
					i++;
				}
			}
			continue;
		}

		results.push({ word, start: wordStart, end: i });
	}

	return results;
}
