/**
 * The options that name a file, and where their values sit in the document.
 *
 * The preview reads these paths already. This reports where each one is
 * written, which is what a link is drawn over and what a diagnostic is put on.
 *
 * Two options name a file, and they are not written in the same places.
 * `file:` is block-only (`typst-render.lua:1788-1794` reads it at no global
 * level), so it is a cell option and nothing else. `preamble:` is read at every
 * level, so it is written in a cell, in the front matter, and in a
 * configuration file.
 *
 * No `vscode` here, the way nothing under `src/utils/typst/` imports it.
 */

import type { AnnotatedNode, AnnotatedYaml, YamlPathSegment } from "../yamlAnnotated";
import { stripBlockquoteMarkers, stripCarriageReturn } from "../yamlPosition";
import { OPTION_LINE, quotedValue, type TypstBlock } from "./typstBlocks";
import { TYPST_RENDER } from "./typstOptions";
import { resolveQuartoPath } from "./typstPaths";

/** One option value that names a file. */
export interface TypstPathOption {
	/** The option that named the path. */
	key: "file" | "preamble";
	/** The path as written, without its quotes. */
	value: string;
	/** Offset of the first character of the value in the document. */
	start: number;
	/** Offset one past the last character of the value. */
	end: number;
}

/** A value read from a line, with the offset it starts at within that line. */
interface Scalar {
	value: string;
	start: number;
}

/**
 * A value with its trailing whitespace and its quotes taken off.
 *
 * The offset moves with the value, because a link over the quotes of a quoted
 * path underlines two characters that are not part of it.
 */
function unquote(raw: string, start: number): Scalar {
	const value = raw.replace(/\s+$/, "");
	const inside = quotedValue(value);
	return inside === undefined ? { value, start } : { value: inside, start: start + 1 };
}

/**
 * Whether an entry of a `preamble:` names a file.
 *
 * `resolvePreamble` reads an entry ending in `.typ` and treats every other one
 * as inline Typst code, so only the first kind has a file to point at. A
 * `file:` carries no such test: the filter reads whatever it names.
 */
function namesFile(key: TypstPathOption["key"], value: string): boolean {
	return value !== "" && (key === "file" || value.endsWith(".typ"));
}

/**
 * The quote depth of a block, measured on its opening fence.
 *
 * The same rule `blockBody` applies: a marker beyond the depth of the fence is
 * content, so stripping without the limit would read `> > //| file: x` in a
 * quoted block as an option line when the block sees a line of Typst.
 */
function quoteDepth(text: string, fenceStart: number): number {
	const newline = text.indexOf("\n", fenceStart);
	const line = text.slice(fenceStart, newline === -1 ? text.length : newline);
	return stripBlockquoteMarkers(stripCarriageReturn(line)).depth;
}

/**
 * The path options of the `//|` run of every cell.
 *
 * The run is read from the document text rather than from `block.body`, which
 * is de-indented and stripped of its blockquote markers: an offset taken in
 * that body does not map back to a position in the document.
 *
 * @param blocks - The blocks of that text, which a caller holding them already
 *   passes rather than paying for the scan a second time.
 */
function cellPathOptions(text: string, blocks: readonly TypstBlock[]): TypstPathOption[] {
	const found: TypstPathOption[] = [];

	for (const block of blocks) {
		// Only a cell carries options. In the other two kinds a `//|` line is an
		// ordinary Typst comment.
		if (block.kind !== "cell") {
			continue;
		}

		const depth = quoteDepth(text, block.fenceStart);
		let lineStart = block.bodyStart;
		while (lineStart < block.bodyEnd) {
			const newline = text.indexOf("\n", lineStart);
			const lineEnd = newline === -1 || newline > block.bodyEnd ? block.bodyEnd : newline;
			const line = stripCarriageReturn(text.slice(lineStart, lineEnd));
			const { content } = stripBlockquoteMarkers(line, depth);
			const match = OPTION_LINE.exec(content);
			// The run ends at the first line that is not an option, which is where
			// `parseOptions` stops as well. A `//|` line below the code is a warning
			// upstream and never an option.
			if (match === null) {
				break;
			}

			const key = match[1];
			if (key === "file" || key === "preamble") {
				// The value capture runs to the end of the line, so it is the tail of
				// the content and its offset follows from its length. The blockquote
				// markers are counted back in, because they are part of the document.
				const prefix = line.length - content.length;
				const raw = unquote(match[2], prefix + content.length - match[2].length);
				if (namesFile(key, raw.value)) {
					found.push({
						key,
						value: raw.value,
						start: lineStart + raw.start,
						end: lineStart + raw.start + raw.value.length,
					});
				}
			}

			lineStart = lineEnd + 1;
		}
	}

	return found;
}

/**
 * The paths a `preamble:` is written at, in the order a reader meets them.
 *
 * `typst-render.lua:1642` reads the mapping under `extensions:` and falls back
 * to a bare top-level key, and no other level exists, so these two are the whole
 * list rather than a pattern to search for.
 */
const PREAMBLE_PATHS: readonly YamlPathSegment[][] = [
	[TYPST_RENDER, "preamble"],
	["extensions", TYPST_RENDER, "preamble"],
];

/**
 * The `preamble:` of every `typst-render` mapping in the YAML of a document.
 *
 * Read from the annotated parse, which already knows where each value is
 * written. The reader this replaces walked the lines itself and had to re-earn
 * quoting, a block sequence, a flow sequence and a trailing comment, each of
 * which the parse answers on its own.
 *
 * The value is taken from the document text and not from the built value,
 * because it is the path as it is written that a link is drawn over, and because
 * a document whose keys are duplicated still has positions to draw on.
 *
 * @param text - The document text.
 * @param annotated - The parse of the YAML of that document.
 */
function yamlPathOptions(text: string, annotated: AnnotatedYaml): TypstPathOption[] {
	const found: TypstPathOption[] = [];

	const take = (node: AnnotatedNode | undefined): void => {
		if (node?.range === undefined) {
			return;
		}
		const value = text.slice(node.range.start, node.range.end);
		if (namesFile("preamble", value)) {
			found.push({ key: "preamble", value, start: node.range.start, end: node.range.end });
		}
	};

	for (const base of PREAMBLE_PATHS) {
		const node = annotated.nodeAt(base);
		if (node === undefined) {
			continue;
		}
		if (node.kind !== "sequence") {
			take(node);
			continue;
		}
		// A sequence is read by position until it runs out, which is what tells a
		// block sequence and a flow sequence apart: nothing.
		for (let index = 0; ; index++) {
			const entry = annotated.nodeAt([...base, index]);
			if (entry === undefined) {
				break;
			}
			take(entry);
		}
	}

	return found;
}

/**
 * Every option of a document that names a file, in document order.
 *
 * @param text - The document text.
 * @param languageId - The VS Code language identifier, which decides where the
 *   YAML of the document is and whether it holds cells at all.
 * @param readBlocks - The blocks of that text. Taken as a thunk, because a YAML
 *   file holds no cell and asks for none, and this module cannot read the cache
 *   that a caller holding a document reads.
 * @param readYaml - The annotated parse of the YAML of that text, taken as a
 *   thunk for the same reason.
 */
export function findTypstPathOptions(
	text: string,
	languageId: string,
	readBlocks: () => readonly TypstBlock[],
	readYaml: () => AnnotatedYaml | undefined,
): TypstPathOption[] {
	const cells = languageId === "yaml" ? [] : cellPathOptions(text, readBlocks());
	const annotated = readYaml();
	const yamlOptions = annotated === undefined ? [] : yamlPathOptions(text, annotated);
	return [...yamlOptions, ...cells].sort((left, right) => left.start - right.start);
}

/** Where the file holding an option sits, and what kind of file it is. */
export interface TypstPathContext {
	/** The directory of the file that holds the option. */
	directory?: string;
	/** The project root that owns that file, when one does. */
	projectRoot?: string;
	/**
	 * Whether the file is a configuration file rather than a document.
	 *
	 * A configuration file is read by every document below it, and the filter
	 * resolves a relative path against the directory of the document it is
	 * rendering. So the file itself does not decide where such a path leads.
	 */
	configuration: boolean;
}

/** Where an option leads, and whether this file is enough to say so. */
export interface TypstPathTarget {
	/** The absolute path, or undefined when nothing here resolves it. */
	path?: string;
	/**
	 * Whether a file that is not there can be reported against this document.
	 *
	 * False for a relative path in a configuration file, where the path is
	 * resolved against each document that reads it: the resolved path is a guess
	 * good enough to follow and not good enough to warn about.
	 */
	reportable: boolean;
}

/**
 * The file an option names, `_modules/paths.lua:34-48`.
 *
 * A leading `/` means the project root, and every other path is relative to the
 * directory passed in. This is the rule `preamble:` and `file:` follow, and not
 * the one `root:`, `font-path:` and `package-path:` follow.
 */
export function resolveTypstPathOption(value: string, context: TypstPathContext): TypstPathTarget {
	const resolved = resolveQuartoPath(value, context.directory, context.projectRoot);
	if (resolved === undefined) {
		return { reportable: false };
	}
	return { path: resolved, reportable: !context.configuration || value.startsWith("/") };
}
