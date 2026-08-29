import { precedingRawBlocks, type TypstBlock } from "./typstBlocks";

/** The source of one compile, and how far it pushed the block body down. */
export interface AssembledSource {
	/** The whole source to send to the compiler. */
	source: string;
	/**
	 * How many lines sit above the block body.
	 *
	 * A diagnostic reports a position in the assembled source, so it has to lose
	 * these before it means anything in the document.
	 */
	injectedLines: number;
}

/**
 * One part of the source, ending with a line ending.
 *
 * A body that is missing its own line ending is the body of an unclosed block,
 * whose closing fence never arrived. Concatenating it as it is would glue its
 * last line to the first line of whatever follows.
 */
function terminated(part: string): string {
	return part.endsWith("\n") ? part : `${part}\n`;
}

/**
 * The body of a block, under everything the preview puts above it.
 *
 * The line count is derived from the assembled prefix rather than counted by
 * the caller, so a caller that prepends one more part cannot forget to say so.
 */
function assemble(above: string[], body: string): AssembledSource {
	const prefix = above
		.filter((part) => part.length > 0)
		.map(terminated)
		.join("");
	return { source: prefix + body, injectedLines: prefix.split("\n").length - 1 };
}

/**
 * The source for a plain ```` ```typst ```` block.
 *
 * A plain block is never executed by Quarto and reaches no Typst output, so it
 * carries no context and compiles on its own.
 */
export function buildPlainSource(block: TypstBlock, header: string): AssembledSource {
	return assemble([header], block.body);
}

/**
 * The source for a raw ```` ```{=typst} ```` block, with the blocks it needs.
 *
 * Pandoc passes every raw block into the Typst output in document order, so a
 * raw block commonly holds only `#set` or `#show` rules, or uses a `#let` bound
 * in an earlier one. Compiled alone it fails or renders blank, so every
 * preceding raw block goes above it.
 *
 * This is an approximation of the render and not a reproduction of it. The
 * Quarto Typst template contributes imports, `#show` rules and `#set`
 * directives that the preview has no way to apply, so a block relying on
 * template state diverges.
 */
export function buildRawSource(blocks: TypstBlock[], target: TypstBlock, header: string): AssembledSource {
	const context = precedingRawBlocks(blocks, target).map((block) => block.body);
	return assemble([header, ...context], target.body);
}
