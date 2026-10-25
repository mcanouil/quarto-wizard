import { quotedValue } from "./typst/typstBlocks";
import {
	closingFenceRegExp,
	removeIndentColumns,
	stripBlockquoteMarkers,
	stripCarriageReturn,
	type FencedBlock,
	type TextRange,
} from "./yamlPosition";

/**
 * The comment tokens that introduce a comment-pipe option, by cell language.
 *
 * Copied from `kLangCommentChars` in quarto-cli
 * (`src/core/lib/partition-cell-options.ts`), plus Typst and Mermaid. A pair is
 * an opening and a closing token, as in `/*| label: a *\/`.
 */
export const CELL_COMMENT_PREFIXES: Readonly<Record<string, string | readonly [string, string]>> = {
	r: "#",
	python: "#",
	julia: "#",
	scala: "//",
	matlab: "%",
	csharp: "//",
	fsharp: "//",
	c: ["/*", "*/"],
	css: ["/*", "*/"],
	sas: ["*", ";"],
	powershell: "#",
	bash: "#",
	sql: "--",
	mysql: "--",
	psql: "--",
	lua: "--",
	cpp: "//",
	cc: "//",
	stan: "#",
	octave: "#",
	fortran: "!",
	fortran95: "!",
	awk: "#",
	gawk: "#",
	stata: "*",
	java: "//",
	groovy: "//",
	kotlin: "//",
	sed: "#",
	perl: "#",
	prql: "#",
	ruby: "#",
	tikz: "%",
	js: "//",
	d3: "//",
	node: "//",
	sass: "//",
	scss: "//",
	coffee: "#",
	go: "//",
	asy: "//",
	haskell: "--",
	dot: "//",
	ojs: "//",
	apl: "⍝",
	ocaml: ["(*", "*)"],
	q: "/",
	rust: "//",
	typst: "//",
	mermaid: "%%",
};

/** One `key: value` comment-pipe line of a cell. Ranges are document offsets. */
export interface CellOptionLine {
	key: string;
	/** The value without its surrounding quotes, or undefined when the line has none. */
	value: string | undefined;
	keyRange: TextRange;
	/** The value as written, quotes included, or undefined when the line has none. */
	valueRange: TextRange | undefined;
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The comment characters Quarto uses for a language that has none of its own. */
const DEFAULT_COMMENT_PREFIX = "#";

const openingRegExps = new Map<string, RegExp>();

function openingRegExp(open: string): RegExp {
	let opening = openingRegExps.get(open);
	if (opening === undefined) {
		opening = new RegExp(`^${escapeRegExp(open)}\\s*\\| ?`);
		openingRegExps.set(open, opening);
	}
	return opening;
}

const CELL_INFO = /^\{([A-Za-z0-9_-]+)(?=[\s,}])/;

const OPTION_KEY = /^([A-Za-z0-9_-]+):(?:\s+(.*))?$/;

/**
 * The value without a trailing YAML comment, as Quarto's YAML parse reads it.
 * A `#` that starts the value or follows whitespace opens the comment.
 * A quoted value ends at its closing quote, so a `#` inside the quotes stays.
 */
function withoutYamlComment(raw: string): string {
	let from = 0;
	if (raw.startsWith('"') || raw.startsWith("'")) {
		const closing = raw.indexOf(raw[0], 1);
		if (closing < 0) {
			return raw;
		}
		from = closing + 1;
	}
	const comment = /(^|\s)#/.exec(raw.slice(from));
	return comment === null ? raw : raw.slice(0, from + comment.index).trimEnd();
}

/**
 * The lower-cased language of an executable cell, or undefined for any other
 * fence. `{=lang}`, `{.lang}` and a bare `lang` are not cells.
 */
export function cellLanguage(info: string): string | undefined {
	const found = CELL_INFO.exec(info.trim());
	return found === null ? undefined : found[1].toLowerCase();
}

interface RunLine {
	lineStart: number;
	lineEnd: number;
	/** Offset of the first character after the prefix, the pipe and the optional space. */
	afterOpening: number;
	/** The line from the prefix on, with blockquote markers and indent removed. */
	content: string;
	/** Offset of the first character of `content`. */
	contentStart: number;
	/** The closing token of a paired prefix, such as `*\/`. */
	close: string | undefined;
	/** What follows the opening, up to the end of the line. */
	rest: string;
}

/**
 * The prefixed lines at the start of a cell, up to the first line that is not
 * an option line. The run ends at the first line that does not start with the
 * language's prefix, optional whitespace, a pipe and an optional space, as in
 * quarto-cli.
 */
function* cellOptionRun(text: string, block: FencedBlock, language: string): Generator<RunLine> {
	const prefix = Object.hasOwn(CELL_COMMENT_PREFIXES, language)
		? CELL_COMMENT_PREFIXES[language]
		: DEFAULT_COMMENT_PREFIX;
	const [open, close] = typeof prefix === "string" ? [prefix, undefined] : prefix;
	const opening = openingRegExp(open);

	const closing = closingFenceRegExp(block.fence);
	let lineStart = block.start;

	while (lineStart < block.end && lineStart < text.length) {
		const newline = text.indexOf("\n", lineStart);
		const lineEnd = newline === -1 ? text.length : newline;
		const line = stripCarriageReturn(text.slice(lineStart, lineEnd));

		const unquoted = stripBlockquoteMarkers(line, block.quoteDepth);
		if (closing.test(unquoted.content)) {
			return;
		}
		const content = removeIndentColumns(unquoted.content, block.indent, unquoted.column);
		const matched = opening.exec(content);
		if (matched === null || (close !== undefined && !content.trimEnd().endsWith(close))) {
			return;
		}

		// Offsets are taken from the end of the line. A tab that straddles the
		// indent leaves synthetic leading spaces in `content`, and such a line
		// never matches the opening pattern, so it never reaches this point.
		const contentStart = lineStart + line.length - content.length;
		const afterOpening = matched[0].length;
		yield {
			lineStart,
			lineEnd: lineStart + line.length,
			afterOpening,
			content,
			contentStart,
			close,
			rest: content.slice(afterOpening),
		};

		lineStart = lineEnd + 1;
	}
}

/**
 * Where an offset sits on an option line of a cell, or undefined when the
 * offset is outside the leading option run or before the end of the prefix.
 *
 * @returns `typed`, the text between the prefix and the offset, and `start`,
 * the offset at which that text begins.
 */
export function cellOptionLineAt(
	text: string,
	block: FencedBlock,
	language: string,
	offset: number,
): { typed: string; start: number } | undefined {
	for (const run of cellOptionRun(text, block, language)) {
		if (offset < run.lineStart || offset > run.lineEnd) {
			continue;
		}
		const start = run.contentStart + run.afterOpening;
		if (offset < start) {
			return undefined;
		}
		return { typed: run.content.slice(run.afterOpening, offset - run.contentStart), start };
	}
	return undefined;
}

/**
 * The leading comment-pipe option lines of a cell, with document offsets.
 *
 * A prefixed line without a `key:` at its start, such as a YAML list item or an
 * indented continuation, stays in the run and is skipped, as is a key whose
 * value is empty on its line.
 */
export function readCellOptions(text: string, block: FencedBlock, language: string): CellOptionLine[] {
	const options: CellOptionLine[] = [];
	for (const { contentStart, afterOpening, close, rest } of cellOptionRun(text, block, language)) {
		const found = OPTION_KEY.exec(rest);
		if (found === null) {
			continue;
		}
		const keyStart = contentStart + afterOpening + found[0].indexOf(found[1]);
		let raw = found[2] ?? "";
		if (close !== undefined && raw.trimEnd().endsWith(close)) {
			raw = raw.trimEnd().slice(0, -close.length);
		}
		raw = withoutYamlComment(raw.trim());
		let value: string | undefined;
		let valueRange: TextRange | undefined;
		if (raw !== "") {
			const valueStart =
				contentStart + afterOpening + found[0].length - (found[2] ?? "").length + (found[2] ?? "").indexOf(raw);
			value = quotedValue(raw) ?? raw;
			valueRange = { start: valueStart, end: valueStart + raw.length };
		}
		options.push({
			key: found[1],
			value,
			keyRange: { start: keyStart, end: keyStart + found[1].length },
			valueRange,
		});
	}
	return options;
}
