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

/**
 * The colour themes the preview tells apart.
 *
 * This mirrors `vscode.ColorThemeKind`, which cannot be named here because this
 * module imports no `vscode`. The provider maps one onto the other.
 */
export type TypstThemeKind = "light" | "dark" | "high-contrast" | "high-contrast-light";

/** The lines the preview puts above a block body, and the colour they carry. */
export interface TypstThemeHeader {
	/** The `#set` lines, in the order they are written. */
	lines: string[];
	/**
	 * The text colour as it is written into the source, empty when none is.
	 *
	 * A theme change recompiles only when this value changes. It is the whole
	 * theme dependence of the header, because the page never derives anything
	 * from the theme kind.
	 */
	foreground: string;
}

/** The two values a colour setting can take that are not a colour. */
const AUTO = "auto";
const NONE = "none";

/**
 * The text colour each theme kind gets.
 *
 * The host cannot read a theme colour value, so these are the `editor.foreground`
 * of the four default themes: Light Modern, Dark Modern, High Contrast and High
 * Contrast Light. A theme of a given kind sits close enough to its default for
 * the text to stay legible, and an author who disagrees sets the colour.
 */
const THEME_TEXT: Record<TypstThemeKind, string> = {
	light: "#3b3b3b",
	dark: "#cccccc",
	"high-contrast": "#ffffff",
	"high-contrast-light": "#292929",
};

/** A hex colour as Typst source, which has no bare hex literal. */
function typstColour(hex: string): string {
	return `rgb("${hex}")`;
}

/**
 * The header a plain or a raw block compiles under.
 *
 * The page setup is always written: a block is a fragment and not a document,
 * so the page has to shrink to it, and on a `width: auto` page the glyphs of the
 * outermost characters clip at the edge of the viewBox without the margin.
 *
 * The colours are a floor and not a ceiling. They are written above the body, so
 * a later `#set` in the author's own code wins.
 *
 * @param kind - The active colour theme kind, which is all the host exposes.
 * @param foreground - `auto` to derive from the kind, `none` to write no text
 *   line at all, or any Typst colour expression, used as it is.
 * @param background - `auto` for a transparent page, so the surface behind the
 *   image supplies the background, `none` to write no page fill and leave Typst
 *   its own, or any Typst colour expression, used as it is.
 */
export function themeHeader(kind: TypstThemeKind, foreground: string, background: string): TypstThemeHeader {
	const fill = background === NONE ? "" : `, fill: ${background === AUTO ? NONE : background}`;
	const lines = [`#set page(width: auto, height: auto, margin: 0.5em${fill})`];

	if (foreground === NONE) {
		return { lines, foreground: "" };
	}
	const colour = foreground === AUTO ? typstColour(THEME_TEXT[kind]) : foreground;
	lines.push(`#set text(fill: ${colour})`);
	return { lines, foreground: colour };
}
