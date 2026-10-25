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

const CELL_INFO = /^\{([A-Za-z0-9_-]+)(?=[\s,}])/;

const OPTION_KEY = /^([A-Za-z0-9_-]+):(?:\s+(.*))?$/;

/**
 * The lower-cased language of an executable cell, or undefined for any other
 * fence. `{=lang}`, `{.lang}` and a bare `lang` are not cells.
 */
export function cellLanguage(info: string): string | undefined {
	const found = CELL_INFO.exec(info.trim());
	return found === null ? undefined : found[1].toLowerCase();
}

/**
 * The leading comment-pipe option lines of a cell, with document offsets.
 *
 * The run ends at the first line that does not start with the language's
 * prefix, optional whitespace, a pipe and an optional space, as in quarto-cli. A prefixed line without a `key:` at its start, such as a
 * YAML list item or an indented continuation, stays in the run and is skipped,
 * as is a key whose value is empty on its line.
 *
 * @returns undefined when the language has no comment prefix.
 */
export function readCellOptions(text: string, block: FencedBlock, language: string): CellOptionLine[] | undefined {
	if (!Object.hasOwn(CELL_COMMENT_PREFIXES, language)) {
		return undefined;
	}
	const prefix = CELL_COMMENT_PREFIXES[language];
	const [open, close] = typeof prefix === "string" ? [prefix, undefined] : prefix;
	const opening = new RegExp(`^${escapeRegExp(open)}\\s*\\| ?`);

	const closing = closingFenceRegExp(block.fence);
	const options: CellOptionLine[] = [];
	let lineStart = block.start;

	while (lineStart < block.end && lineStart < text.length) {
		const newline = text.indexOf("\n", lineStart);
		const lineEnd = newline === -1 ? text.length : newline;
		const line = stripCarriageReturn(text.slice(lineStart, lineEnd));

		const unquoted = stripBlockquoteMarkers(line, block.quoteDepth);
		if (closing.test(unquoted.content)) {
			break;
		}
		const content = removeIndentColumns(unquoted.content, block.indent, unquoted.column);
		const matched = opening.exec(content);
		if (matched === null || (close !== undefined && !content.trimEnd().endsWith(close))) {
			break;
		}

		// Both removals only drop a prefix of the line, so what is left lines up
		// with the end of the original line.
		const contentStart = lineStart + line.length - content.length;
		const afterOpening = matched[0].length;
		const found = OPTION_KEY.exec(content.slice(afterOpening));
		if (found !== null) {
			const keyStart = contentStart + afterOpening + found[0].indexOf(found[1]);
			let raw = found[2] ?? "";
			if (close !== undefined && raw.trimEnd().endsWith(close)) {
				raw = raw.trimEnd().slice(0, -close.length);
			}
			raw = raw.trim();
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

		lineStart = lineEnd + 1;
	}
	return options;
}
