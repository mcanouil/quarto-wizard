/**
 * The command line one compile runs under, ported from the `typst-render` filter.
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

import * as path from "node:path";
import { mapping, type ResolvedTypstOptions, type TypstOptionValue } from "./typstOptions";

/** Where one document sits, which is what every path here resolves against. */
export interface TypstPaths {
	/** The project root that owns the document, when one does. */
	projectRoot?: string;
	/** The directory holding the document, when it is a file on disk. */
	documentDirectory?: string;
}

/** The arguments that read the source from stdin and write the image to stdout. */
const STDIO: readonly string[] = ["-", "-"];

/** The image format every surface can show, whatever the cell asks to render as. */
const FORMAT: readonly string[] = ["compile", "--format", "svg"];

/**
 * A `font-path` or `package-path` as the filter resolves it,
 * `_modules/paths.lua:34-48`.
 *
 * A leading `/` means the project root, and every other path is returned
 * unchanged: the filter leaves it relative, so it resolves against the working
 * directory of the compile. `compileCwd` is what makes that the same directory
 * here as it is under a render.
 *
 * This is not the rule `root`, `preamble` and `file` follow, which resolve a
 * relative path against the document instead.
 */
export function resolveProjectPath(quartoPath: string, projectRoot: string | undefined): string {
	if (quartoPath === "" || !quartoPath.startsWith("/")) {
		return quartoPath;
	}
	const relative = quartoPath.slice(1);
	return projectRoot === undefined ? path.normalize(relative) : path.join(projectRoot, relative);
}

/**
 * The compile root, `typst-render.lua:1195` and `:931-953`.
 *
 * A leading `/` means the project root, and every other value is relative to the
 * document directory. The default is `.`, which is the document directory
 * itself, and a document at the project root resolves the two to the same place.
 *
 * Undefined when the value names a place this cannot find: a document outside
 * every project has no root for a leading `/` to mean, and one that is not a
 * file on disk has no directory for a relative value to sit under. The root
 * confines every read a compile makes, so a guess would either widen it past the
 * document or point it somewhere the document never names.
 */
export function resolveCompileRoot(root: string | undefined, paths: TypstPaths): string | undefined {
	const value = root === undefined || root === "" ? "." : root;
	if (value.startsWith("/")) {
		return paths.projectRoot === undefined ? undefined : path.join(paths.projectRoot, value.slice(1));
	}
	const base = paths.documentDirectory ?? paths.projectRoot;
	return base === undefined ? undefined : path.normalize(path.join(base, value));
}

/**
 * The directory a compile runs from.
 *
 * The project root, because that is where Quarto runs Typst from under a render
 * and because a relative `font-path` is left relative and resolves against it.
 */
export function compileCwd(paths: TypstPaths): string | undefined {
	return paths.projectRoot ?? paths.documentDirectory;
}

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
	if (value === undefined || value === "") {
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
 * The global mapping is what `input:` writes at a metadata level, and the block
 * string is what its own `//| input:` writes. A block value wins, which is the
 * precedence every other option follows.
 */
export function mergeInputs(
	global: Record<string, string> | undefined,
	blockInput: string | undefined,
): Record<string, string> {
	return { ...global, ...parseInputString(blockInput) };
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

/** The `input:` mapping of the merged options, when it holds one. */
function inputMapping(value: TypstOptionValue | undefined): Record<string, string> | undefined {
	const map = mapping(value);
	if (map === undefined) {
		return undefined;
	}
	const inputs: Record<string, string> = {};
	for (const [key, held] of Object.entries(map)) {
		inputs[key] = String(held);
	}
	return inputs;
}

/** The `font-path:` of the merged options as a list, whichever shape it holds. */
function fontPaths(value: TypstOptionValue | undefined): string[] {
	if (value === undefined) {
		return [];
	}
	return Array.isArray(value) ? value.map(String) : [String(value)];
}

/** Everything one cell's command line is decided by. */
export interface CellArgvRequest {
	/** The merged options of the cell. */
	options: ResolvedTypstOptions;
	/** The cell's own `input:` string, which the merged options drop. */
	blockInput?: string;
	/** The page fill of the mode in force, as a Typst expression. */
	background?: string;
	/** The text fill of the mode in force, absent when the cell sets none. */
	foreground?: string;
	paths: TypstPaths;
}

/**
 * The command line of one ```` ```{typst} ```` cell,
 * `typst-render.lua:1242-1262`.
 *
 * The order is the filter's own, and the colour inputs come last on purpose: an
 * author who writes `typst-render-background` in their own `input:` mapping has
 * it overridden by the resolved colour, the same way a render does.
 *
 * `--ppi` is not emitted, because the preview compiles to SVG and the flag reads
 * on a raster format alone.
 */
export function buildCellArgv(request: CellArgvRequest): string[] {
	const { options, paths } = request;
	const argv = [...FORMAT];

	const root = resolveCompileRoot(options.root === undefined ? undefined : String(options.root), paths);
	if (root !== undefined) {
		argv.push("--root", root);
	}

	for (const fontPath of fontPaths(options["font-path"])) {
		argv.push("--font-path", resolveProjectPath(fontPath, paths.projectRoot));
	}

	const packagePath = options["package-path"];
	if (packagePath !== undefined) {
		argv.push("--package-path", resolveProjectPath(String(packagePath), paths.projectRoot));
	}

	const inputs = mergeInputs(inputMapping(options.input), request.blockInput);
	// Sorted, so two compiles of the same cell spell the same command line and
	// share one cache entry.
	for (const key of Object.keys(inputs).sort()) {
		argv.push("--input", `${key}=${inputs[key]}`);
	}

	const foreground = typstColourHex(request.foreground);
	if (foreground !== undefined) {
		argv.push("--input", `typst-render-foreground=${foreground}`);
	}
	const background = typstColourHex(request.background);
	if (background !== undefined) {
		argv.push("--input", `typst-render-background=${background}`);
	}

	return [...argv, ...STDIO];
}

/**
 * The command line of a plain block and of a raw block.
 *
 * Neither reaches the filter, so neither reads an option of it. The root is the
 * document directory alone, which is what makes a relative path in the block
 * resolve the way it reads: beside the document it is written in.
 */
export function buildBlockArgv(documentDirectory: string | undefined): string[] {
	const argv = [...FORMAT];
	if (documentDirectory !== undefined) {
		argv.push("--root", documentDirectory);
	}
	return [...argv, ...STDIO];
}
