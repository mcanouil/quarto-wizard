/**
 * The option machinery of the `typst-render` filter, ported to TypeScript.
 *
 * Every value here is read from `_extensions/typst-render/typst-render.lua` of
 * `mcanouil/quarto-typst-render`, at the version pinned in
 * `src/test/fixtures/typstPreview/README.md`. The schema is not the source: its
 * `default:` values are documentation, they disagree with the filter in places,
 * and they omit `foreground`, `file` and `format` entirely.
 *
 * The port is bug-compatible. Where the filter does something surprising, the
 * surprise is reproduced and the line it comes from is named, because a preview
 * that corrects the filter shows an image the render does not produce.
 */

import type { TypstBlock } from "./typstBlocks";

/** Which side of a light and dark pair a colour is read from. */
export type TypstBrandMode = "light" | "dark";

/**
 * A colour option after the global pass.
 *
 * A string is one colour for both modes. The pair form comes from a `light:`
 * and `dark:` map, or from an `auto` colour whose brand differs between the two.
 */
export type TypstColour = string | { readonly light?: string; readonly dark?: string };

/** One option value, in any of the shapes the filter carries. */
export type TypstOptionValue = string | number | boolean | readonly string[] | TypstColour | Record<string, string>;

/**
 * The merged option table of one block.
 *
 * A key with a `nil` default is absent rather than undefined, because
 * `merge_options` copies with `pairs`, which skips a `nil` value
 * (`typst-render.lua:66-68`). `format`, `foreground`, `file` and `input` are the
 * four the acceptance criteria name, and the difference is visible: the filter
 * tests `opts.foreground` for truthiness, so an absent key and a key holding an
 * empty string are not the same thing.
 */
export type ResolvedTypstOptions = Readonly<Record<string, TypstOptionValue>>;

/**
 * The filter's own defaults, `typst-render.lua:35-64`.
 *
 * The keys the filter defaults to `nil` are absent here for the reason above:
 * `format`, `foreground`, `file`, `output-filename`, `input`, `code-summary`,
 * `output-location`, `classes`, `label`, `layout-ncol` and `align`.
 */
export const TYPST_DEFAULTS: ResolvedTypstOptions = Object.freeze({
	dpi: 144,
	width: "auto",
	height: "auto",
	margin: "0.5em",
	background: "none",
	preamble: "",
	cache: true,
	"cache-refresh": false,
	"output-directory": "./assets/typst-render",
	"output-source": false,
	echo: false,
	"code-fold": false,
	"code-line-numbers": false,
	eval: true,
	include: true,
	output: true,
	pages: "all",
});

/**
 * The keys the global pass reads, `typst-render.lua:1788-1794`.
 *
 * `font-path`, `preamble`, `input`, `background` and `foreground` are read
 * after this list by rules of their own, and are not repeated here. `file`,
 * `output-filename`, `label`, `cap` and `alt` are block-only and are read at no
 * global level at all.
 *
 * `root`, `font-path` and `package-path` run the other way: they are read from
 * the global configuration alone (`typst-render.lua:1284-1293` and `:1332`) and
 * never from the merged table, so a block writing `root:` has no effect. Nothing
 * here has to enforce that, because none of the three reaches the source.
 */
const GLOBAL_KEYS: readonly string[] = [
	"format",
	"dpi",
	"width",
	"height",
	"margin",
	"cache",
	"cache-refresh",
	"echo",
	"code-fold",
	"code-summary",
	"code-line-numbers",
	"eval",
	"include",
	"output",
	"output-location",
	"classes",
	"root",
	"package-path",
	"pages",
	"layout-ncol",
	"align",
	"output-directory",
	"output-source",
];

/**
 * A CSS colour as a Typst colour literal, `typst-render.lua:315-326`.
 *
 * A hex value is wrapped, because Typst has no bare hex literal. Bare CSS
 * functional notation is wrapped as well, so Typst's string-form constructor
 * parses it. Everything else passes through, which is what lets a Typst
 * expression such as `luma(80%)` be written in the option directly.
 */
export function cssColourToTypst(cssColour: string): string {
	if (cssColour.startsWith("#")) {
		return `rgb("${cssColour}")`;
	}
	// A Typst-form argument list carries a quote and a bare CSS one never does,
	// which is the whole test upstream makes. Wrapping `rgb("#fff")` again would
	// produce `rgb("rgb("#fff")")`, which does not compile.
	const args = /^rgb\((.+)\)$/.exec(cssColour) ?? /^hsl\((.+)\)$/.exec(cssColour);
	if (args !== null && !/['"]/.test(args[1])) {
		return `rgb("${cssColour}")`;
	}
	return cssColour;
}

/**
 * One side of a colour option, `typst-render.lua:517-526`.
 *
 * A pair that holds only the other mode falls back to it rather than to the
 * default. A brand commonly writes one side only, and a block that then rendered
 * with no colour at all would look like the option was ignored.
 */
export function resolveColourValue(config: TypstColour | undefined, mode: TypstBrandMode): string | undefined {
	if (typeof config === "string") {
		return config;
	}
	if (config === undefined) {
		return undefined;
	}
	const other = mode === "light" ? "dark" : "light";
	return config[mode] ?? config[other];
}

/**
 * The brand colours one document resolves to.
 *
 * Mirrors `get_color_css` of Quarto's own Lua brand module, which is what the
 * filter calls. It is a function rather than a table so a caller with no brand
 * at all passes one that always answers undefined.
 */
export type BrandColourReader = (mode: TypstBrandMode, name: string) => string | undefined;

/**
 * A colour option as the filter stores it, `typst-render.lua:465-511`.
 *
 * Handles the three shapes a global level can write: a `light:` and `dark:` map,
 * the word `auto`, and a colour string. Returns undefined when the option
 * resolves to nothing, which leaves the merged value in place.
 *
 * `auto` returns a pair only when the two modes disagree. A brand that names the
 * same colour on both sides is one colour, and carrying it as a pair would send
 * the filter down its dual-rendering path for no difference in output.
 */
export function resolveColourConfig(
	raw: TypstOptionValue | undefined,
	colourName: string,
	brand: BrandColourReader,
): TypstColour | undefined {
	if (raw === undefined) {
		return undefined;
	}

	// Every table takes this branch upstream, a list included: the test there is
	// against the `Inlines` shape a plain YAML scalar has, and a list is not it.
	// A list therefore holds neither `light` nor `dark` and resolves to nothing.
	if (typeof raw === "object") {
		const map = raw as Record<string, string | undefined>;
		const light = map.light === undefined ? undefined : cssColourToTypst(String(map.light));
		const dark = map.dark === undefined ? undefined : cssColourToTypst(String(map.dark));
		if (light !== undefined && dark !== undefined) {
			return { light, dark };
		}
		return light ?? dark;
	}

	const value = String(raw);

	if (value === "auto") {
		const light = brand("light", colourName);
		const dark = brand("dark", colourName);
		const haveLight = light !== undefined && light !== "";
		const haveDark = dark !== undefined && dark !== "";
		if (haveLight && haveDark && light !== dark) {
			return { light: cssColourToTypst(light), dark: cssColourToTypst(dark) };
		}
		if (haveLight) {
			return cssColourToTypst(light);
		}
		if (haveDark) {
			return cssColourToTypst(dark);
		}
		// The filter warns and falls back to the default here. The preview has no
		// place to warn from, and the panel header names the resolved mode, so the
		// fallback alone is reproduced.
		return undefined;
	}

	return value === "" ? undefined : cssColourToTypst(value);
}

/**
 * A global level as the filter reads it.
 *
 * The values are whatever the YAML held, so this is the shape of one
 * `extensions.typst-render:` mapping and not of a merged table.
 */
export type TypstGlobalLevel = Readonly<Record<string, unknown>>;

/** The extension name, which is both the metadata key and the schema name. */
export const TYPST_RENDER = "typst-render";

/**
 * The `typst-render` mapping of one metadata level, `typst-render.lua:1783`.
 *
 * `extensions.typst-render:` is the supported spelling. A bare top-level
 * `typst-render:` is a legacy fallback that the filter still reads, so a
 * document written the old way previews the way it renders.
 */
export function extensionLevel(metadata: unknown): TypstGlobalLevel | undefined {
	if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
		return undefined;
	}
	const map = metadata as Record<string, unknown>;
	const extensions = map.extensions;
	if (extensions !== null && typeof extensions === "object" && !Array.isArray(extensions)) {
		const level = (extensions as Record<string, unknown>)[TYPST_RENDER];
		if (level !== null && typeof level === "object" && !Array.isArray(level)) {
			return level as TypstGlobalLevel;
		}
	}
	const legacy = map[TYPST_RENDER];
	if (legacy !== null && typeof legacy === "object" && !Array.isArray(legacy)) {
		return legacy as TypstGlobalLevel;
	}
	return undefined;
}

/**
 * The `brand-mode:` a document sets, `typst-render.lua:1772-1773`.
 *
 * Undefined when the document sets none, which is where the preview deviates
 * from the filter on purpose: the filter defaults to light, and the preview
 * follows the editor theme instead, so a dark editor shows a dark image.
 */
export function documentBrandMode(metadata: unknown): TypstBrandMode | undefined {
	if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
		return undefined;
	}
	const value = (metadata as Record<string, unknown>)["brand-mode"];
	if (value === undefined || value === null) {
		return undefined;
	}
	return stringify(value) === "dark" ? "dark" : "light";
}

/** A YAML scalar as the filter's `pandoc.utils.stringify` would leave it. */
function stringify(value: unknown): string {
	if (value === null || value === undefined) {
		return "";
	}
	if (Array.isArray(value)) {
		return value.map(stringify).join("");
	}
	if (typeof value === "object") {
		return Object.values(value as Record<string, unknown>)
			.map(stringify)
			.join("");
	}
	return String(value);
}

/**
 * One global value, coerced by the rules at `typst-render.lua:1795-1886`.
 *
 * Returns undefined when the filter leaves the key unset, which happens for a
 * `dpi` that is not a number at all.
 */
function coerceGlobal(key: string, raw: unknown): TypstOptionValue | undefined {
	if (key === "echo") {
		if (typeof raw === "boolean") {
			return raw;
		}
		const value = stringify(raw);
		return value === "fenced" ? "fenced" : value === "true";
	}
	if (key === "code-fold") {
		if (typeof raw === "boolean") {
			return raw;
		}
		const value = stringify(raw);
		if (value === "show") {
			return "show";
		}
		// Anything but `true`, `false` and `show` is a warning upstream and
		// disables the fold, which is the same answer `false` gives.
		return value === "true";
	}
	if (key === "code-line-numbers") {
		if (typeof raw === "boolean") {
			return raw;
		}
		const value = stringify(raw);
		if (value === "true" || value === "false") {
			return value === "true";
		}
		// A value such as `1|3-4` is kept verbatim for Quarto's own pass.
		return value;
	}
	if (key === "output") {
		if (typeof raw === "boolean") {
			return raw;
		}
		const value = stringify(raw);
		return value === "asis" ? "asis" : value === "true";
	}
	if (key === "code-summary") {
		// Upstream keeps Markdown markup here by writing the inlines back out.
		// A file read with `js-yaml` never holds inlines, so the string it parsed
		// already is the markup.
		return typeof raw === "string" ? raw : stringify(raw);
	}

	const fallback = TYPST_DEFAULTS[key];
	if (typeof fallback === "number") {
		const parsed = Number(stringify(raw));
		return Number.isNaN(parsed) ? undefined : parsed;
	}
	if (typeof fallback === "boolean") {
		return typeof raw === "boolean" ? raw : stringify(raw) === "true";
	}
	return stringify(raw);
}

/**
 * The global configuration one level contributes, `typst-render.lua:1785-1944`.
 *
 * A level is one `extensions.typst-render:` mapping, from `_quarto.yml`, a
 * `metadata-files:` target, a `_metadata.yml` or the document front matter. The
 * levels are merged by the caller, lowest first, because the filter sees only
 * the one mapping Quarto has already merged for it.
 */
export function resolveGlobalConfig(level: TypstGlobalLevel, brand: BrandColourReader): ResolvedTypstOptions {
	const config: Record<string, TypstOptionValue> = {};

	for (const key of GLOBAL_KEYS) {
		if (level[key] === undefined || level[key] === null) {
			continue;
		}
		const value = coerceGlobal(key, level[key]);
		if (value !== undefined) {
			config[key] = value;
		}
	}

	// `font-path` and `preamble` take a string or a list, and both are stored as
	// a list. A `preamble` that stringifies to nothing becomes an empty list, so
	// `preamble: ""` clears an inherited one rather than being ignored.
	const fontPath = level["font-path"];
	if (fontPath !== undefined && fontPath !== null) {
		config["font-path"] = Array.isArray(fontPath) ? fontPath.map(stringify) : [stringify(fontPath)];
	}

	const preamble = level.preamble;
	if (preamble !== undefined && preamble !== null) {
		if (Array.isArray(preamble)) {
			config.preamble = preamble.map(stringify);
		} else {
			const value = stringify(preamble);
			config.preamble = value === "" ? [] : [value];
		}
	}

	// `input` is a map and nothing else. A string is a warning upstream and is
	// dropped, which leaves whatever an outer level set.
	const input = level.input;
	if (input !== undefined && input !== null && typeof input === "object" && !Array.isArray(input)) {
		const map: Record<string, string> = {};
		for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
			map[key] = stringify(value);
		}
		config.input = map;
	}

	for (const key of ["background", "foreground"] as const) {
		if (level[key] === undefined || level[key] === null) {
			continue;
		}
		const resolved = resolveColourConfig(level[key] as TypstOptionValue, key, brand);
		if (resolved !== undefined) {
			config[key] = resolved;
		}
	}

	return config;
}

/**
 * The global configuration of a whole metadata chain.
 *
 * The levels arrive lowest first, and each one is resolved on its own before
 * the merge. Resolving the merged mapping instead would read a `light:` and
 * `dark:` map that two levels each half-wrote as though one level had written
 * both halves.
 */
export function mergeGlobalConfigs(
	levels: readonly TypstGlobalLevel[],
	brand: BrandColourReader,
): ResolvedTypstOptions {
	const merged: Record<string, TypstOptionValue> = {};
	for (const level of levels) {
		Object.assign(merged, resolveGlobalConfig(level, brand));
	}
	return merged;
}

/**
 * The merged options of one cell, `typst-render.lua:1976-2009`.
 *
 * Three passes, in the filter's own order: the block's `input` string is set
 * aside so the merge cannot overwrite the global map with it, the three tables
 * are merged, and only then are the block's own colours resolved.
 *
 * The colour pass is deliberately last and deliberately reads the block table
 * rather than the merged one. A value inherited from a global level is already a
 * Typst expression, and wrapping `rgb("#faf6ee")` a second time does not compile.
 */
export function resolveTypstOptions(
	block: TypstBlock,
	global: ResolvedTypstOptions,
	brand: BrandColourReader,
): ResolvedTypstOptions {
	const blockOptions: Record<string, string | boolean> = { ...block.options };

	// Per-block `cache-refresh` is a warning upstream and is dropped, because the
	// sweep it controls runs once for the whole document.
	delete blockOptions["cache-refresh"];

	// `input` is a comma-separated string per block and a map globally, so the
	// merge would otherwise replace the map with the string.
	const blockInput = typeof blockOptions.input === "string" ? blockOptions.input : undefined;
	if (blockInput !== undefined) {
		delete blockOptions.input;
	}

	const merged: Record<string, TypstOptionValue> = { ...TYPST_DEFAULTS, ...global, ...blockOptions };
	if (blockInput !== undefined) {
		merged._block_input = blockInput;
	}

	for (const key of ["background", "foreground"] as const) {
		const raw = block.options[key];
		if (raw === "auto") {
			const resolved = resolveColourConfig("auto", key, brand);
			if (resolved === undefined) {
				// `DEFAULTS[key]` is `nil` for `foreground`, and assigning `nil` in Lua
				// removes the key, so an `auto` foreground with no brand leaves no key
				// at all rather than an empty one.
				delete merged[key];
			} else {
				merged[key] = resolved;
			}
			continue;
		}
		// The guard is against the default, so a block writing `background: none`
		// is left as the bare word `none` rather than being wrapped. The merge has
		// already put it in place, so this pass only decides whether to rewrite it
		// as a Typst expression, and `none` already is one.
		if (typeof raw === "string" && raw !== TYPST_DEFAULTS[key]) {
			merged[key] = cssColourToTypst(raw);
		}
	}

	return merged;
}
