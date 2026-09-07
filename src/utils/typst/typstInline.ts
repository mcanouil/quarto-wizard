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

/** Whether an attribute carries the class the filter matches on. */
function hasTypstClass(attribute: string): boolean {
	return /(^|[\s{])\.typst(?=[\s}])/.test(attribute);
}

/**
 * The content of a span, without the rule CommonMark applies to its ends.
 *
 * One space comes off each end when both ends have one and the content is not
 * only spaces. The offset of the first kept character comes back beside the
 * text, because every offset this module reports is a document offset.
 */
function spanContent(raw: string): { text: string; offset: number } {
	const stripped = /^[ \t\r\n](.*)[ \t\r\n]$/s.exec(raw);
	if (stripped === null || raw.trim() === "") {
		return { text: raw, offset: 0 };
	}
	return { text: stripped[1], offset: 1 };
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
	for (const span of getInlineCodeSpanRanges(source, fences)) {
		const run = /^`+/.exec(source.slice(span.start, span.end))?.[0].length ?? 0;
		const raw = source.slice(span.start + run, span.end - run);
		const attributeMatch = ATTRIBUTE.exec(source.slice(span.end));
		const attribute = attributeMatch?.[0] ?? "";

		const kind = classify(raw, attribute);
		if (kind === undefined) {
			continue;
		}

		const content = spanContent(raw);
		const prefix = attribute === "" ? (PREFIX.exec(content.text)?.[0].length ?? 0) : 0;
		const body = content.text.slice(prefix);
		const bodyStart = span.start + run + content.offset + prefix + from;

		let line = firstLine;
		for (let index = 0; index < span.start; index++) {
			if (source[index] === "\n") {
				line++;
			}
		}

		units.push({
			scope: "inline",
			kind,
			body,
			// A span carries no option run, so the two are the same text.
			code: body,
			options: {},
			bodyStart,
			bodyEnd: bodyStart + body.length,
			unitEnd: span.end + attribute.length + from,
			fenceStart: span.start + from,
			fenceLine: line,
			indent: 0,
		});
	}

	return units;
}

/** The kind a span declares, or undefined when it is not Typst. */
function classify(raw: string, attribute: string): TypstUnitKind | undefined {
	if (attribute !== "") {
		if (attribute.includes("=typst")) {
			return "raw";
		}
		return hasTypstClass(attribute) ? "cell" : undefined;
	}
	return PREFIX.test(spanContent(raw).text) ? "cell" : undefined;
}
