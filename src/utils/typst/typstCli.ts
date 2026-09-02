/**
 * The command one compile runs, ported from the `typst-render` filter.
 *
 * The source reaches Typst on stdin, so Typst has no file directory to anchor a
 * relative path on and resolves every read against the compile root instead.
 * That makes `--root` the flag the whole feature depends on: without it the root
 * is the working directory of the extension host, and a block reading a file
 * beside its own document fails.
 *
 * Every rule here comes from `_extensions/typst-render/typst-render.lua` of
 * `mcanouil/quarto-typst-render`, at the version pinned in
 * `src/test/fixtures/typstPreview/README.md`. The port is bug-compatible, the
 * same way `typstOptions.ts` is: a preview that resolved a path the filter does
 * not would show an image the render does not produce.
 */

import { mapping, type ResolvedTypstOptions, type TypstOptionValue } from "./typstOptions";
import { compileCwd, resolveCompileRoot, resolveProjectPath, type TypstPaths } from "./typstPaths";

/**
 * One whole invocation of the compiler.
 *
 * The arguments and the directory travel together, because a relative
 * `--font-path` means nothing without the directory it resolves against, and
 * pairing an argv with the wrong one reads the fonts of another project.
 */
export interface TypstCommand {
	argv: string[];
	/** The directory to run from, absent when the document names none. */
	cwd?: string;
}

/** The arguments that read the source from stdin and write the image to stdout. */
const STDIO: readonly string[] = ["-", "-"];

/** The image format every surface can show, whatever the cell asks to render as. */
const FORMAT: readonly string[] = ["compile", "--format", "svg"];

/**
 * A per-block `input:` string, `typst-render.lua:612-624`.
 *
 * Comma-separated `key=value` pairs, trimmed around both halves. An entry with
 * no `=` and one with an empty key are dropped, and an entry whose value is
 * empty is kept, because clearing an inherited input is a thing an author can
 * mean.
 */
export function parseInputString(value: string | undefined): Record<string, string> {
	const parsed: Record<string, string> = {};
	if (value === undefined) {
		return parsed;
	}
	for (const pair of value.split(",")) {
		const found = /^\s*(.*?)\s*=\s*(.*?)\s*$/.exec(pair);
		if (found !== null && found[1] !== "") {
			parsed[found[1]] = found[2];
		}
	}
	return parsed;
}

/**
 * The inputs one cell compiles with, `typst-render.lua:630-643`.
 *
 * The mapping is what `input:` writes at a metadata level, and the string is
 * what the cell's own `//| input:` writes. A block value wins, which is the
 * precedence every other option follows.
 */
export function mergeInputs(
	global: TypstOptionValue | undefined,
	blockInput: string | undefined,
): Record<string, string> {
	const map = mapping(global) ?? {};
	const inputs: Record<string, string> = {};
	for (const [key, value] of Object.entries(map)) {
		inputs[key] = String(value);
	}
	return { ...inputs, ...parseInputString(blockInput) };
}

/**
 * The hex a colour expression carries, `typst-render.lua:748-751`.
 *
 * A flag can carry a hex and nothing else, so every other expression resolves to
 * no input at all. The `#let` bindings the source already carries are what a
 * block reads those from.
 */
export function typstColourHex(expression: string | undefined): string | undefined {
	if (expression === undefined) {
		return undefined;
	}
	const found = /^rgb\("(#[0-9a-fA-F]+)"\)$/.exec(expression);
	return found === null ? undefined : found[1];
}

/** The `font-path:` of a configuration as a list, whichever shape it holds. */
function fontPaths(value: TypstOptionValue | undefined): string[] {
	if (value === undefined) {
		return [];
	}
	return Array.isArray(value) ? value.map(String) : [String(value)];
}

/** Everything one command line is decided by. */
export interface TypstCommandRequest {
	/**
	 * The global configuration of the document, merged lowest level first.
	 *
	 * The global configuration and not the merged options of the cell.
	 * `typst-render.lua:1284-1293` reads `root`, `font-path` and `package-path`
	 * from it alone, so a cell writing one of the three has no effect.
	 *
	 * A plain block and a raw block reach no filter and pass none of this.
	 */
	global?: ResolvedTypstOptions;
	/** The cell's own `input:` string, which the merged options drop. */
	blockInput?: string;
	/** The page fill of the mode in force, as a Typst expression. */
	background?: string;
	/** The text fill of the mode in force, absent when the cell sets none. */
	foreground?: string;
	paths: TypstPaths;
}

/**
 * The command one block compiles under, `typst-render.lua:1242-1262`.
 *
 * The order is the filter's own, and the colour inputs come last on purpose: an
 * author who writes `typst-render-background` in their own `input:` mapping has
 * it overridden by the resolved colour, the same way a render does.
 *
 * `--ppi` is not emitted, because the preview compiles to SVG and the flag reads
 * on a raster format alone.
 */
export function buildTypstCommand(request: TypstCommandRequest): TypstCommand {
	const { global = {}, paths } = request;
	const argv = [...FORMAT];

	const root = resolveCompileRoot(global.root === undefined ? undefined : String(global.root), paths);
	if (root !== undefined) {
		argv.push("--root", root);
	}

	for (const fontPath of fontPaths(global["font-path"])) {
		argv.push("--font-path", resolveProjectPath(fontPath, paths.projectRoot));
	}

	const packagePath = global["package-path"];
	if (packagePath !== undefined) {
		argv.push("--package-path", resolveProjectPath(String(packagePath), paths.projectRoot));
	}

	// Sorted, so one cell spells one command line however the YAML was written.
	const inputs = mergeInputs(global.input, request.blockInput);
	for (const key of Object.keys(inputs).sort()) {
		argv.push("--input", `${key}=${inputs[key]}`);
	}

	for (const [name, expression] of [
		["typst-render-foreground", request.foreground],
		["typst-render-background", request.background],
	] as const) {
		const hex = typstColourHex(expression);
		if (hex !== undefined) {
			argv.push("--input", `${name}=${hex}`);
		}
	}

	argv.push(...STDIO);
	return { argv, cwd: compileCwd(paths) };
}

/**
 * What makes two compiles the same compile.
 *
 * Beside the builder, so that what identifies an invocation cannot drift from
 * what one is. The parts are joined on a NUL, which every path and every option
 * this builds from a YAML document is free of. It is a cache key and not a
 * signature: a caller that hand-built an argument holding a NUL could spell two
 * commands the same way, and Typst would refuse to start on either of them.
 *
 * An absent directory is written as an empty one, which `compileCwd` never
 * answers: it returns a directory or nothing at all, so the two cannot collide.
 */
export function commandKey(command: TypstCommand): string {
	return [command.cwd ?? "", ...command.argv].join("\u0000");
}
