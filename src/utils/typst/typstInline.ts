import { findFencedBlocks, getInlineCodeSpanRanges, getYamlFrontMatterRange } from "../yamlPosition";
import type { TypstUnit, TypstUnitKind } from "./typstBlocks";

/**
 * The Typst carried by an inline code span.
 *
 * The `typst-render` filter walks Pandoc `Code` inlines beside `CodeBlock`
 * elements, so an inline cell renders to an image and the editor has to say so.
 *
 * The rule is the filter's own, at `cell.is_inline_code`: the class `typst` and
 * the text prefix `{typst}` are the same executable cell. That is not the block
 * rule, where a `.typst` fence is a plain block Quarto only highlights, and the
 * difference is deliberate upstream.
 *
 * There is no inline `plain` kind for that reason. An inline span is a cell or
 * a raw passthrough, and nothing else.
 */

/** An attribute that follows the closing backtick run, on the same line. */
const ATTRIBUTE = /^\{[^}\n]*\}/;

/** The prefix form, whose info sits inside the span, `cell.inline_code_text`. */
const PREFIX = /^\{typst\}[ \t]?/;

/**
 * The prefix form matched against raw document text rather than the
 * line-ending-converted text `PREFIX` reads.
 *
 * The separator after `{typst}` is one document unit: a space, a tab, or one
 * line ending, and a `\r\n` is two document characters read as that one unit.
 * `\r\n` has to come before the lone `\r` alternative, or the alternation
 * would take the `\r` on its own and leave the `\n` to be read as code.
 */
const PREFIX_RAW = /^\{typst\}(?:[ \t]|\r\n|\r|\n)?/;

/** The raw-passthrough form, whitespace inside the braces aside. */
const RAW_ATTRIBUTE = /^\{\s*=typst\s*\}$/;

/**
 * Whether an attribute carries the class the filter matches on.
 *
 * A quoted value can hold the text `.typst` bounded by whitespace or a brace,
 * for example `{alt="see .typst here"}`, which would otherwise read as the
 * class. Quoted values are stripped before the scan, so only an actual class
 * token can match.
 */
function hasTypstClass(attribute: string): boolean {
	const withoutQuotedValues = attribute.replace(/"[^"]*"|'[^']*'/g, "");
	return /(^|[\s{])\.typst(?=[\s}])/.test(withoutQuotedValues);
}

/**
 * The content of a span, converted the way Pandoc hands it to the filter.
 *
 * CommonMark converts every line ending inside a code span to one space
 * before the span's content exists at all, so a body written across two
 * lines compiles as one line, and `code` has to match what actually renders.
 * Only then does one leading and one trailing literal space come off, and
 * only a space: a tab was never a line ending and survives, because the
 * conversion above has already spent every line ending by the time this rule
 * runs.
 *
 * The raw document length consumed at each end comes back beside the text,
 * because a converted `\r\n` is one character shorter than the two document
 * characters it replaced, and every offset this module reports has to stay a
 * document offset regardless of what the conversion did to the text.
 */
function spanContent(raw: string): { text: string; leading: number; trailing: number } {
	const normalised = raw.replace(/\r\n|\r|\n/g, " ");
	const strip = normalised[0] === " " && normalised[normalised.length - 1] === " " && normalised.trim() !== "";
	if (!strip) {
		return { text: normalised, leading: 0, trailing: 0 };
	}
	return {
		text: normalised.slice(1, -1),
		leading: raw.startsWith("\r\n") ? 2 : 1,
		trailing: raw.endsWith("\r\n") ? 2 : 1,
	};
}

/**
 * Every inline Typst unit of a document, in document order.
 *
 * The spans come from `getInlineCodeSpanRanges`, which follows the CommonMark
 * rule for a code span, skips the fenced regions it is given, and ends its range
 * at the closing backtick run. The attribute is outside that range on purpose,
 * which is what lets this read it.
 */
export function findTypstInlines(text: string): TypstUnit[] {
	// Scan below the front matter, as the fence scan does. A block scalar can hold
	// a line that looks like a span, and a title holding backticks is common.
	const frontMatter = getYamlFrontMatterRange(text);
	const from = frontMatter?.end ?? 0;
	const source = from === 0 ? text : text.slice(from);

	let firstLine = 0;
	for (let index = 0; index < from; index++) {
		if (text[index] === "\n") {
			firstLine++;
		}
	}

	// `findFencedBlocks` reports the body range, which starts after the opening
	// fence line so a reader of the info string finds it outside the range. That
	// leaves the opening backtick run itself unguarded, and two fences of the
	// same length let that run pair with the next fence's opening run, so the
	// range given here has to reach back to `fenceStart` instead.
	const fences = findFencedBlocks(source).map((block) => ({ start: block.fenceStart, end: block.end }));

	const units: TypstUnit[] = [];
	// The spans arrive sorted, so the line of each one is counted onward from the
	// last one read rather than from the start of the source every time.
	let lastIndex = 0;
	let lastLine = firstLine;
	for (const span of getInlineCodeSpanRanges(source, fences)) {
		const run = /^`+/.exec(source.slice(span.start, span.end))?.[0].length ?? 0;
		const raw = source.slice(span.start + run, span.end - run);
		const attributeMatch = ATTRIBUTE.exec(source.slice(span.end));
		const attribute = attributeMatch?.[0] ?? "";

		const content = spanContent(raw);
		const kind = classify(content.text, attribute);
		if (kind === undefined) {
			continue;
		}

		const prefix = attribute === "" ? (PREFIX.exec(content.text)?.[0].length ?? 0) : 0;
		const body = content.text.slice(prefix);

		// Every offset this module reports counts document characters, and `body`
		// counts the characters the filter reads, so the two lengths differ by
		// every line ending the conversion collapsed. `prefix` is in the second
		// unit, right for slicing `body` out of `content.text`, wrong for adding to
		// a document offset. Matched again here, against the raw text with the
		// CommonMark ends already removed, so the length is in document units and
		// needs no further correction.
		const rawContent = raw.slice(content.leading, raw.length - content.trailing);
		const rawPrefix = attribute === "" ? (PREFIX_RAW.exec(rawContent)?.[0].length ?? 0) : 0;

		const bodyStart = span.start + run + content.leading + rawPrefix + from;
		const bodyEnd = span.end - run - content.trailing + from;

		for (let index = lastIndex; index < span.start; index++) {
			if (source[index] === "\n") {
				lastLine++;
			}
		}
		lastIndex = span.start;
		const line = lastLine;

		units.push({
			scope: "inline",
			kind,
			body,
			// A span carries no option run, so the two are the same text.
			code: body,
			options: {},
			bodyStart,
			// Not `bodyStart + body.length`: an embedded CRLF converts to one space
			// in `body` and so is one character shorter than the document text it
			// replaced, and this offset has to stay a document offset regardless.
			bodyEnd,
			unitEnd: span.end + attribute.length + from,
			fenceStart: span.start + from,
			fenceLine: line,
			indent: 0,
		});
	}

	return units;
}

/**
 * The kind a span declares, or undefined when it is not Typst.
 *
 * Upstream, `cell.is_inline_code` tests the class first and reaches the text
 * prefix only when that test fails, so `` `{typst} #x`{.python} `` is read as
 * not an inline cell even though its text carries the prefix: the class test
 * alone decides it, because it is reached first and an element carrying
 * `.python` fails it. This module follows that order, an attribute before a
 * prefix, so the same span is skipped here too. The reasoning is a reading of
 * the filter and not a recorded render, and the direction it commits to on
 * that uncertainty is the safe one: show nothing rather than an image the
 * render does not produce.
 *
 * @param text - The span's content, converted the way `spanContent` reads it,
 *   so a prefix that runs across a line ending is still found.
 */
function classify(text: string, attribute: string): TypstUnitKind | undefined {
	if (attribute !== "") {
		// Anchored on the whole attribute, the way the block classifier reads
		// `{=typst}`. Pandoc's bracketed attribute syntax allows an unquoted
		// `key=value` pair, so a substring test would misread `{lang=typst-preview}`
		// as the same raw-passthrough form.
		if (RAW_ATTRIBUTE.test(attribute)) {
			return "raw";
		}
		return hasTypstClass(attribute) ? "cell" : undefined;
	}
	return PREFIX.test(text) ? "cell" : undefined;
}
