import { hasLateOptionLine, precedingRawBlocks, type TypstBlock } from "./typstBlocks";
import { brandColourReader, brandDictionary, type Brand } from "./typstBrand";
import { buildTypstCommand, type TypstCommand } from "./typstCli";
import type { TypstPaths } from "./typstPaths";
import {
	TYPST_DEFAULTS,
	mergeGlobalConfigs,
	resolveColourValue,
	resolveTypstOptions,
	type ResolvedTypstOptions,
	type TypstBrandMode,
	type TypstGlobalLevel,
} from "./typstOptions";

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

/** What the preview puts above a block body, and the colour it carries. */
export interface TypstThemeHeader {
	/** The `#set` lines, which is what the builders take. */
	header: string;
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
 * One colour setting, with a blank value read as `auto`.
 *
 * Clearing the field in the settings user interface leaves an empty string,
 * which is neither of the two words and is not an expression either. Written
 * through it gives `fill: )`, and every compile then fails on the injected
 * header rather than on the block the reader is looking at.
 */
function setting(value: string): string {
	return value.trim() === "" ? AUTO : value.trim();
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
	const text = setting(foreground);
	// An `auto` page is transparent, so the surface behind the image supplies the
	// background and follows a theme change with no recompile.
	const page = setting(background);
	const fill = page === NONE ? "" : `, fill: ${page === AUTO ? NONE : page}`;
	const geometry = `#set page(width: auto, height: auto, margin: 0.5em${fill})`;

	if (text === NONE) {
		return { header: geometry, foreground: "" };
	}
	const colour = text === AUTO ? typstColour(THEME_TEXT[kind]) : text;
	return { header: `${geometry}\n#set text(fill: ${colour})`, foreground: colour };
}

/**
 * Everything a ```` ```{typst} ```` cell needs, once the disk has been read.
 *
 * A cell keeps the colour contract of the `typst-render` filter and never takes
 * the preview's own theme header: the filter writes the page fill and the text
 * fill itself, from the options in force, and a second set of directives above
 * them would show an image the render does not produce.
 */
export interface CellSourceOptions {
	/** The page fill, already a Typst expression. */
	background: string;
	/** The text fill, or undefined when the options set none. */
	foreground?: string;
	/** The page width, `auto` unless an option says otherwise. */
	width: string;
	/** The page height. */
	height: string;
	/** The page margin, which is what keeps a glyph off the edge of the image. */
	margin: string;
	/** The `_typst_render_brand` dictionary literal for the mode in force. */
	brand: string;
	/** The preamble, resolved from inline code and `.typ` files, or empty. */
	preamble: string;
	/**
	 * The contents of a `file:` option, which replace the cell body entirely
	 * (`typst-render.lua:2047-2052`). Absent when the cell has no `file:`.
	 */
	code?: string;
}

/**
 * The body of a cell as Pandoc hands it to the filter.
 *
 * A `CodeBlock` carries no trailing line ending, because the closing fence is
 * not part of the block. The scanner keeps the one before that fence, so it
 * comes off here rather than in the scanner, where the other two kinds need it.
 *
 * A `file:` substitution is not passed through here. The filter reads that file
 * whole, trailing line ending included, and the compiled source keeps it.
 */
function cellBody(body: string): string {
	return body.replace(/\r?\n$/, "");
}

/**
 * The source of one ```` ```{typst} ```` cell.
 *
 * A port of `build_typst_source` at `typst-render.lua:943-962`, together with
 * the bindings it injects at `:907-915` and the page directive it builds at
 * `:920-925`. The parts are joined with newlines in the filter's own order, and
 * the order is load-bearing: the author's preamble sits below the `#set`
 * directives so it can override them, and above the code so the code can use it.
 *
 * One part is deliberately not emitted. `build_define_preamble` at `:946-949`
 * writes the `typst_define()` payload of the R and Python helpers, which the
 * preview cannot see: it lives in metadata Quarto's engine produces during a
 * render. A cell that reads it is out of scope for the first version, which
 * `docs/getting-started/typst-preview.qmd` states.
 */
function buildCellSource(block: TypstBlock, options: CellSourceOptions): AssembledSource {
	const above = [
		`#let _typst_render_background = ${options.background}`,
		`#let _typst_render_foreground = ${options.foreground ?? "none"}`,
		`#let _typst_render_brand = ${options.brand}`,
		`#set page(width: ${options.width}, height: ${options.height}, margin: ${options.margin}, fill: ${options.background})`,
	];
	if (options.foreground !== undefined) {
		above.push(`#set text(fill: ${options.foreground})`);
	}
	if (options.preamble !== "") {
		above.push(options.preamble);
	}

	// Joined and not terminated, which is where a cell differs from the other two
	// kinds. `table.concat(parts, '\n')` puts exactly one line ending between two
	// parts, so a preamble file that ends with a newline of its own contributes a
	// blank line, and a preview that dropped it would not match the render.
	const prefix = above.join("\n");
	// The block is taken rather than only its code so a caller cannot pass the
	// body of one cell beside the options of another.
	const code = options.code ?? cellBody(block.code);
	return { source: `${prefix}\n${code}`, injectedLines: prefix.split("\n").length };
}

/**
 * A `preamble:` option resolved to Typst code,
 * `typst-render.lua:701-749`.
 *
 * An entry ending in `.typ` is a path and is read; every other entry is inline
 * Typst code. A list is resolved entry by entry and joined with newlines, and an
 * entry that cannot be read is dropped rather than failing the whole preview,
 * which is what the filter does as well.
 *
 * The reads are injected, so this module keeps importing no `vscode` and a test
 * needs no file on disk.
 */
export async function resolvePreamble(
	value: string | readonly string[] | undefined,
	readFile: ReadFile,
): Promise<string> {
	if (value === undefined || value === "") {
		return "";
	}
	const entries = typeof value === "string" ? [value] : value;
	// The entries are independent, so they are read together rather than one
	// after another. Their order in the source is the order they are written in,
	// which `Promise.all` preserves.
	const resolved = await Promise.all(entries.map(async (entry) => (entry.endsWith(".typ") ? readFile(entry) : entry)));
	// An entry that cannot be read is dropped rather than failing the whole
	// preview, which is what the filter does as well.
	return resolved.filter((part): part is string => part !== undefined && part !== "").join("\n");
}

/** A `preamble:` or `file:` path read as text, or undefined when it cannot be. */
export type ReadFile = (documentPath: string) => Promise<string | undefined>;

/**
 * Everything outside a cell that decides what it compiles to.
 *
 * The levels arrive lowest first, and the caller is what knows where they came
 * from. The read is injected, so this module imports no `vscode` and a fixture
 * drives the whole pipeline from strings alone.
 */
export interface CellContext {
	/** The `extensions.typst-render:` mapping of each level, lowest first. */
	levels: readonly TypstGlobalLevel[];
	/** The parsed `_brand.yml`, or an empty brand when the project has none. */
	brand: Brand;
	/** Which side of the brand the compile reads. */
	mode: TypstBrandMode;
	/**
	 * Where the document sits, which is what the command resolves against.
	 *
	 * Two plain strings, so this module still imports no `vscode` and a fixture
	 * still drives the whole pipeline without a workspace. A document with
	 * neither passes an empty pair, and the compile then carries no root.
	 */
	paths: TypstPaths;
	readFile: ReadFile;
}

/** Something the preview cannot do, and the one line that says why. */
export interface Unavailable {
	unavailable: string;
}

/** Whether a result reported why it could not be produced. */
export function isUnavailable<T extends object>(result: T | Unavailable): result is Unavailable {
	return "unavailable" in result;
}

/** One cell assembled, with what the preview does not reproduce about it. */
export interface AssembledCell extends AssembledSource {
	/** The command the cell compiles under. */
	command: TypstCommand;
	/** What the panel should say about the block beside the image. */
	notes: string[];
	/**
	 * How many lines of the block body sit above the first compiled line.
	 *
	 * A cell compiles its `code` and not its `body`, so the leading `//|` run is
	 * in the document but not in the source Typst reads. A diagnostic that lost
	 * only the injected lines would name a line of the block that is short by the
	 * length of that run.
	 */
	bodyLineOffset: number;
	/**
	 * The `file:` whose contents replaced the body, when one did.
	 *
	 * A diagnostic then has no line of the block at all: it names a position in
	 * that file, and reporting it against the block would send the reader to a
	 * line that has nothing to do with the failure.
	 */
	externalFile?: string;
}

/**
 * What the preview does not reproduce about a cell.
 *
 * Each of these compiles to something, so refusing them would be worse than
 * showing the image and saying what is missing from it.
 *
 * Read from the merged options and not from the block's own `//|` run, because
 * every one of the three is a global key as well: a `format: pdf` written in
 * `_quarto.yml` applies to a block that never mentions it.
 */
export function cellNotes(options: ResolvedTypstOptions): string[] {
	const notes: string[] = [];
	const format = options.format;
	if (format === "pdf" || format === "html") {
		// The preview always compiles to SVG, because that is what a webview, a
		// hover and a decoration can all show.
		notes.push(`the preview compiles to SVG, not to ${format}`);
	}
	if (options.output === "asis") {
		// An `asis` cell is emitted into the document Typst is already laying out,
		// so it inherits a page the preview has no way to reproduce.
		notes.push("an `output: asis` cell inherits the document page, which the preview cannot apply");
	}
	if (typeof options.pages === "string" && options.pages !== "all") {
		notes.push("the preview shows the first page only");
	}
	return notes;
}

/**
 * One ```` ```{typst} ```` cell, from its context to its compiled source.
 *
 * The whole pipeline of the filter, in the filter's own order: the global levels
 * are resolved and merged, the block options are merged over them, the colours
 * of the mode in force are picked out, and the parts are assembled.
 */
export async function buildCell(block: TypstBlock, context: CellContext): Promise<AssembledCell | Unavailable> {
	const brand = brandColourReader(context.brand);
	const global = mergeGlobalConfigs(context.levels, brand);
	const options = resolveTypstOptions(block, global, brand);

	// `true` and `false` parse as booleans, and these two options are written and
	// read as text. A boolean is ignored rather than carried on, because the
	// assembler would raise a `TypeError` inside a compile that has no reason to
	// fail and the reader would be shown that in place of the block. `input:` is
	// guarded the same way below.
	const preambleOption =
		typeof options.preamble === "string" || Array.isArray(options.preamble) ? options.preamble : undefined;
	const fileOption = typeof options.file === "string" && options.file !== "" ? options.file : undefined;

	// The preamble and the `file:` are independent reads, so they run together.
	const [preamble, code] = await Promise.all([
		resolvePreamble(preambleOption, context.readFile),
		fileOption === undefined ? undefined : context.readFile(fileOption),
	]);

	// A `file:` replaces the cell body entirely. The filter logs and renders
	// nothing when the read fails, which in a preview would be a blank image with
	// no reason beside it.
	if (fileOption !== undefined && code === undefined) {
		return { unavailable: `The file option names \`${fileOption}\`, and it could not be read.` };
	}

	// The compiled code starts below the block's own option run, and a `file:`
	// replaces the body outright, so the panel is told where the lines it is about
	// to be handed actually live.
	const bodyLineOffset =
		code === undefined ? block.body.slice(0, block.body.length - block.code.length).split("\n").length - 1 : 0;

	// The fallback is `DEFAULTS.background`, which `resolve_opts_colours` applies
	// at `typst-render.lua:884`. Only the background has one: a cell with no
	// foreground writes no text fill line at all.
	const background = resolveColourValue(options.background, context.mode) ?? String(TYPST_DEFAULTS.background);
	const foreground = resolveColourValue(options.foreground, context.mode);

	const assembled = buildCellSource(block, {
		background,
		foreground,
		width: String(options.width),
		height: String(options.height),
		margin: String(options.margin),
		brand: brandDictionary(context.brand, context.mode),
		preamble,
		code,
	});
	// Named only when the file actually replaced the body. An empty `file:` skips
	// the read and compiles the body, and reporting it as the external file would
	// print a position "of " with no name and drop the option run correction.
	const externalFile = code === undefined ? undefined : fileOption;
	// The global configuration and not the merged options, because the filter
	// reads `root`, `font-path` and `package-path` from it alone. The block's own
	// `input:` is read from the block, because the merge drops it: it is a string
	// per block and a mapping globally, and the two cannot live under one key.
	const command = buildTypstCommand({
		global,
		blockInput: typeof block.options.input === "string" ? block.options.input : undefined,
		background,
		foreground,
		paths: context.paths,
	});
	const notes = cellNotes(options);
	// The upstream warning at `code-cell.lua:110-118`. An option line below the
	// leading run is left as code, and the two spellings look the same in the
	// block, so the reader is told which one this is. A `file:` replaces the body
	// outright, so that line is not compiled at all and the note would be wrong.
	if (code === undefined && hasLateOptionLine(block)) {
		notes.push("an option line below the first run is compiled as code, not read as an option");
	}
	return { ...assembled, command, notes, bodyLineOffset, externalFile };
}
