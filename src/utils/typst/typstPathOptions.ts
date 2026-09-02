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

import { getYamlIndentLevel, getYamlKeyPath, stripBlockquoteMarkers, stripCarriageReturn } from "../yamlPosition";
import { findTypstBlocks, OPTION_LINE, quotedValue } from "./typstBlocks";
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
 */
function cellPathOptions(text: string): TypstPathOption[] {
	const found: TypstPathOption[] = [];

	for (const block of findTypstBlocks(text)) {
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

/** Whether a key path names the `typst-render` mapping of a level. */
function isExtensionPath(path: readonly string[]): boolean {
	if (path.length === 1) {
		return path[0] === TYPST_RENDER;
	}
	return path.length === 2 && path[0] === "extensions" && path[1] === TYPST_RENDER;
}

/** Whether a key path names the `preamble:` of a level. */
function isPreamblePath(path: readonly string[]): boolean {
	return path.length > 1 && path[path.length - 1] === "preamble" && isExtensionPath(path.slice(0, -1));
}

/**
 * A YAML value with its trailing comment taken off.
 *
 * A `#` is a comment only when whitespace comes before it, which is the YAML
 * rule, and never inside a quoted value.
 */
function yamlScalar(raw: string, start: number): Scalar {
	const quoted = unquote(raw, start);
	// The quotes matched, so the whole value is inside them and a `#` is part of
	// it. They did not match either when there are none and when a comment
	// follows the closing one, and taking the comment off answers both.
	if (quoted.start !== start) {
		return quoted;
	}
	const value = quoted.value.replace(/\s+#.*$/, "");
	// A line that carries a comment and nothing else writes no value, which is
	// what a key followed by a block sequence looks like.
	return unquote(value.startsWith("#") ? "" : value, start);
}

/** A `preamble:` key, with everything written after the colon. */
const PREAMBLE_KEY = /^(\s*)preamble:\s*(.*)$/;

/**
 * One entry of a block sequence.
 *
 * The dash is followed by whitespace of any width, which is one space in most
 * documents and more in a document whose entries are aligned. The value capture
 * runs to the end of the line, so its offset follows from its length whatever
 * that width is.
 */
const SEQUENCE_ENTRY = /^(\s*)-\s+(.+)$/;

/**
 * The entries of a flow sequence, `preamble: [_one.typ, _two.typ]`, or
 * undefined when the value is not one.
 *
 * A flow sequence is a list the same way a block sequence is, and a reader that
 * takes it for one value finds no path in it and says nothing at all.
 */
function flowEntries(scalar: Scalar): Scalar[] | undefined {
	const flow = /^\[(.*)\]$/.exec(scalar.value);
	if (flow === null) {
		return undefined;
	}
	const entries: Scalar[] = [];
	// Past the opening bracket, then past each entry and the comma after it.
	let start = scalar.start + 1;
	for (const part of flow[1].split(",")) {
		const lead = part.length - part.trimStart().length;
		entries.push(unquote(part.trimStart(), start + lead));
		start += part.length + 1;
	}
	return entries;
}

/**
 * The `preamble:` of every `typst-render` mapping in the YAML of a document.
 *
 * The whole document for a configuration file, and the front matter alone for a
 * Quarto document: `getYamlKeyPath` answers with an empty path below the front
 * matter, so a `preamble:` written in prose is never read as one.
 *
 * The key path is resolved for a `preamble:` line and for nothing else. The
 * entries below one are recognised by their indent instead, because resolving
 * the path of every sequence entry walks the document again for each of them,
 * and a website configuration carries hundreds.
 */
function yamlPathOptions(text: string, languageId: string): TypstPathOption[] {
	const found: TypstPathOption[] = [];
	const lines = text.split("\n");
	// The indent of a `preamble:` whose entries are written below it, and
	// undefined when the reader is not inside one.
	let sequenceOf: number | undefined;
	let lineStart = 0;

	for (let index = 0; index < lines.length; index++) {
		const line = stripCarriageReturn(lines[index]);
		const trimmed = line.trim();
		// A blank line and a comment line sit inside the block they interrupt, so
		// neither ends a sequence.
		if (trimmed === "" || trimmed.startsWith("#")) {
			lineStart += lines[index].length + 1;
			continue;
		}

		const indent = getYamlIndentLevel(line);
		const entry = SEQUENCE_ENTRY.exec(line);
		// A block sequence is written at the indent of its key or deeper, so the
		// indent alone does not say where it ends. The first line that is not an
		// entry of it does, and a sibling key is such a line.
		const inSequence = sequenceOf !== undefined && entry !== null && indent >= sequenceOf;
		if (!inSequence) {
			sequenceOf = undefined;
		}

		// The value this line writes, which is the one on a `preamble:` line and
		// the one an entry below it carries.
		let scalar: Scalar | undefined;
		const key = PREAMBLE_KEY.exec(line);
		if (key !== null && isPreamblePath(getYamlKeyPath(lines, index, languageId))) {
			scalar = yamlScalar(key[2], line.length - key[2].length);
			if (scalar.value === "") {
				// Nothing on the line, so the entries are written below it.
				sequenceOf = indent;
				scalar = undefined;
			}
		} else if (inSequence && entry !== null) {
			scalar = yamlScalar(entry[2], line.length - entry[2].length);
		}

		for (const value of scalar === undefined ? [] : (flowEntries(scalar) ?? [scalar])) {
			if (namesFile("preamble", value.value)) {
				found.push({
					key: "preamble",
					value: value.value,
					start: lineStart + value.start,
					end: lineStart + value.start + value.value.length,
				});
			}
		}

		lineStart += lines[index].length + 1;
	}

	return found;
}

/**
 * Every option of a document that names a file, in document order.
 *
 * @param text - The document text.
 * @param languageId - The VS Code language identifier, which decides where the
 *   YAML of the document is and whether it holds cells at all.
 */
export function findTypstPathOptions(text: string, languageId: string): TypstPathOption[] {
	const cells = languageId === "yaml" ? [] : cellPathOptions(text);
	const yamlOptions = yamlPathOptions(text, languageId);
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
