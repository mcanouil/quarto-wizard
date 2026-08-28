import {
	getCodeBlockRanges,
	getYamlFrontMatterRange,
	parseOpeningFence,
	closingFenceRegExp,
	stripBlockquoteMarkers,
	stripCarriageReturn,
	removeIndentColumns,
} from "../yamlPosition";

/**
 * The three fence kinds that carry Typst source in a Quarto document.
 *
 * Quarto treats each one differently, and conflating them produces a preview
 * that does not match the render:
 *
 * - `plain` is a ```` ```typst ```` block. Quarto only highlights it, so it is
 *   never executed and its `//|` lines are ordinary Typst comments.
 * - `raw` is a ```` ```{=typst} ```` block. Pandoc passes it through to Typst
 *   output and drops it in every other format.
 * - `cell` is a ```` ```{typst} ```` block, an executable cell owned by the
 *   `typst-render` extension. Only this kind carries options.
 */
export type TypstBlockKind = "plain" | "raw" | "cell";

/** One Typst block found in a document. */
export interface TypstBlock {
	/** Which of the three fence kinds this is. */
	kind: TypstBlockKind;
	/** The block body, without the fences, de-indented to column zero. */
	body: string;
	/**
	 * The body without its leading option run.
	 *
	 * Identical to `body` for `plain` and `raw`, where a `//|` line is an
	 * ordinary Typst comment and must survive verbatim.
	 */
	code: string;
	/** The `//|` options, empty for every kind but `cell`. */
	options: Record<string, string | boolean>;
	/** Offset of the first character of the body. */
	bodyStart: number;
	/** Offset one past the last character of the body. */
	bodyEnd: number;
	/** Offset of the first character of the opening fence line. */
	fenceStart: number;
	/** Zero-based line number of the opening fence. */
	fenceLine: number;
	/** Indent of the opening fence, measured after any blockquote markers. */
	indent: number;
}

/**
 * The opening fence line that precedes a code block body.
 *
 * `getCodeBlockRanges` starts each range after the opening fence line, so the
 * info string has to be recovered by walking back. When the opening fence is
 * the last line and the document has no trailing newline, the range is empty
 * and starts at the end of the text, which is why the newline test comes first.
 */
function fenceLineRange(text: string, bodyStart: number): { start: number; end: number } {
	const end = bodyStart > 0 && text[bodyStart - 1] === "\n" ? bodyStart - 1 : bodyStart;
	return { start: text.lastIndexOf("\n", end - 1) + 1, end };
}

/** The kind an info string declares, or undefined when it is not Typst. */
function classifyInfoString(info: string): TypstBlockKind | undefined {
	const trimmed = info.trim();
	if (trimmed === "{=typst}") {
		return "raw";
	}
	if (trimmed === "{typst}") {
		return "cell";
	}
	if (trimmed === "typst" || /^\{\.typst(\s[^}]*)?\}$/.test(trimmed)) {
		return "plain";
	}
	return undefined;
}

/**
 * The body of a block, without its closing fence, its blockquote markers or the
 * fence indent.
 *
 * Typst is whitespace sensitive and knows nothing about Markdown, so neither an
 * indent nor a quote marker may survive into the compiled source.
 */
function blockBody(
	text: string,
	bodyStart: number,
	bodyEnd: number,
	fence: string,
	indent: number,
	quoteDepth: number,
): string {
	// Chosen once. How deep the block sits is a property of the fence, not of
	// each line, so testing it per line says the same thing many times and
	// invites the two uses below to drift apart.
	//
	// At most the depth of the fence is removed. A marker beyond that is content:
	// one quote deep, the line `> > #x` reaches Typst as the text `> #x`.
	const unquote =
		quoteDepth > 0 ? (line: string) => stripBlockquoteMarkers(line, quoteDepth).content : (line: string) => line;

	// Cut at the start of the closing fence line rather than dropping that line
	// after a split, which would take the newline of the line above with it and
	// glue the last body line to whatever follows it.
	const slice = text.slice(bodyStart, bodyEnd);
	const lastNewline = slice.lastIndexOf("\n");
	const closing = closingFenceRegExp(fence);
	const lastLine = stripCarriageReturn(slice.slice(lastNewline + 1));
	const body = closing.test(unquote(lastLine)) ? slice.slice(0, lastNewline + 1) : slice;

	// The indent comes off by column, because the fence owns a number of columns
	// and not a number of characters. A carriage return is part of the line
	// ending on a CRLF document, and is left alone.
	return body
		.split("\n")
		.map((line) => removeIndentColumns(unquote(line), indent))
		.join("\n");
}

/**
 * The Lua key pattern at `_modules/code-cell.lua:89`, in JavaScript.
 *
 * That pattern anchors at the line start, skips leading whitespace, takes the
 * comment-pipe prefix, then a key of `%w` and hyphen, a colon, and a value of
 * one or more characters, with whitespace allowed on both sides.
 *
 * `%w` is alphanumeric and carries no underscore, so an underscore key does not
 * match and ends the option run. The value needs one character, so a key with
 * nothing after its colon does not match either, while the same line with one
 * trailing space does: the pattern backtracks, the value becomes that space,
 * and the trim which follows leaves an empty string.
 */
const OPTION_LINE = /^\s*\/\/\|\s*([A-Za-z0-9-]+):\s*(.+)$/;

/**
 * The Lua guard at `_modules/code-cell.lua:110`, which warns about an option
 * line that came after the code.
 *
 * It is deliberately not the same rule as the key pattern above, because the
 * two are not the same in Lua either: the guard ends with a colon and one
 * whitespace character, while the key pattern accepts a colon with nothing
 * after it. So a line spelled without that space parses as an option at the top
 * of a block and is passed over in silence lower down. That is upstream
 * behaviour, and it is reproduced rather than corrected.
 */
const LATE_OPTION_LINE = /^\s*\/\/\|\s*[A-Za-z0-9-]+:\s/;

/** One parsed value, following `code-cell.lua:95-102`. */
function optionValue(raw: string): string | boolean {
	if (raw === "true") {
		return true;
	}
	if (raw === "false") {
		return false;
	}
	const quoted = /^"(.*)"$/.exec(raw) ?? /^'(.*)'$/.exec(raw);
	return quoted === null ? raw : quoted[1];
}

/**
 * The leading `//|` run of a cell body, and the code that follows it.
 *
 * A port of `cell.parse_options` at `_modules/code-cell.lua:84-122`, kept
 * bug-compatible except for the line split. Lua iterates `[^\r\n]*`, which
 * yields an empty line between each pair on a CRLF document and so ends the run
 * after the first option. That is unreachable in a render, because Pandoc does
 * not recognise a fenced block in a CRLF document at all, so reproducing it
 * would only break the preview of a file an author can legitimately write.
 */
function parseOptions(body: string): { options: Record<string, string | boolean>; code: string } {
	const options: Record<string, string | boolean> = {};
	const lines = body.split(/\r?\n/);
	let index = 0;

	for (; index < lines.length; index++) {
		const match = OPTION_LINE.exec(lines[index]);
		if (match === null) {
			break;
		}
		// Lua trims after the capture, not inside the pattern, and the order
		// matters: a value of one space captures as a space and trims to empty.
		options[match[1]] = optionValue(match[2].trim());
	}

	// Slice the body at the end of the option run rather than joining the
	// remaining lines. Joining would write one line ending everywhere and leave
	// `code` normalised while `body` kept its own, so an offset taken in one
	// would drift against the other by a character a line.
	//
	// The Lua reader warns about a late option line and keeps it as code. Nothing
	// in this module reports to the user, so the line is kept here too and the
	// warning belongs to whichever surface renders the block.
	let offset = 0;
	for (let consumed = 0; consumed < index; consumed++) {
		const newline = body.indexOf("\n", offset);
		offset = newline === -1 ? body.length : newline + 1;
	}
	return { options, code: body.slice(offset) };
}

/** Whether a body carries an option line after its code, which Lua warns about. */
export function hasLateOptionLine(block: TypstBlock): boolean {
	return block.kind === "cell" && block.code.split(/\r?\n/).some((line) => LATE_OPTION_LINE.test(line));
}

/**
 * Every Typst block in a document, in document order.
 *
 * Block scanning reuses `getCodeBlockRanges`, which already handles CRLF, an
 * indented fence, an unclosed block, and the CommonMark rule that a backtick
 * info string carries no bare backtick. It also means a fence nested inside a
 * longer fence, as in a Markdown demonstration block, is part of that outer
 * block and is never reported here.
 */
export function findTypstBlocks(text: string): TypstBlock[] {
	// Scan below the front matter rather than dropping its ranges afterwards. A
	// block scalar can hold a line that looks like a fence, and that opens a
	// block which only closes on a bare fence line, so it swallows the opening
	// fence of the first real block and takes it out of the results entirely.
	const frontMatter = getYamlFrontMatterRange(text);
	const from = frontMatter?.end ?? 0;
	const source = from === 0 ? text : text.slice(from);

	const blocks: TypstBlock[] = [];
	// The ranges come back sorted, so the line number of each fence continues
	// from the last one. Counting from the start of the document for every block
	// would walk the whole prefix again each time, and a page of examples can
	// carry ninety fences.
	let counted = 0;
	let line = 0;
	for (let index = 0; index < from; index++) {
		if (text[index] === "\n") {
			line++;
		}
	}

	for (const range of getCodeBlockRanges(source)) {
		const fence = fenceLineRange(source, range.start);
		const fenceLineText = stripBlockquoteMarkers(stripCarriageReturn(source.slice(fence.start, fence.end)));
		const opening = parseOpeningFence(fenceLineText.content);
		if (opening === undefined) {
			continue;
		}

		const kind = classifyInfoString(opening.info);
		if (kind === undefined) {
			continue;
		}

		for (; counted < fence.start; counted++) {
			if (source[counted] === "\n") {
				line++;
			}
		}

		const body = blockBody(source, range.start, range.end, opening.fence, opening.indent, fenceLineText.depth);
		// Only a cell carries options. For the other two kinds a `//|` line is an
		// ordinary Typst comment, so the body passes through untouched.
		const parsed = kind === "cell" ? parseOptions(body) : { options: {}, code: body };

		blocks.push({
			kind,
			body,
			code: parsed.code,
			options: parsed.options,
			// Offsets are reported against the document, not against the slice.
			bodyStart: range.start + from,
			bodyEnd: range.end + from,
			fenceStart: fence.start + from,
			fenceLine: line,
			indent: opening.indent,
		});
	}

	return blocks;
}

/**
 * The Typst block that holds an offset, or undefined when none does.
 *
 * The opening fence line counts as part of its block. A reader who puts the
 * cursor on the fence means that block, and the body range starts after it.
 */
export function typstBlockAt(text: string, offset: number): TypstBlock | undefined {
	return findTypstBlocks(text).find((block) => offset >= block.fenceStart && offset <= block.bodyEnd);
}

/**
 * Every raw block before a target, in document order.
 *
 * Pandoc emits raw blocks into the Typst output in order, so an earlier one can
 * bind a name the target uses. Only a raw block reaches that output: a cell is
 * compiled to an image by the filter, and a plain block is never executed, so
 * neither can put a binding in scope.
 */
export function precedingRawBlocks(blocks: TypstBlock[], target: TypstBlock): TypstBlock[] {
	return blocks.filter((block) => block.kind === "raw" && block.bodyStart < target.bodyStart);
}
