/**
 * Enough of Quarto's `_brand.yml` reader to resolve one named colour.
 *
 * The filter reads `auto` colours through Quarto's own Lua brand module, which
 * TypeScript cannot reach: it runs inside the Pandoc Lua interpreter and reads a
 * brand Quarto has already parsed, validated and split. `packages/core` does not
 * help either, because `operations/brand.ts` stages brand files and never reads
 * a colour out of one.
 *
 * So the parts a colour needs are reimplemented here, from the Quarto source:
 * the light and dark split at `src/core/brand/brand.ts:631-812`, the alias chain
 * with its cycle guard at `:161-197`, and the accessor at
 * `src/resources/filters/modules/brand/brand.lua:10-17`. Fonts, logos and
 * defaults are not read, because no colour option needs them.
 */

import { mapping } from "./typstOptions";
import type { BrandColourReader, TypstBrandMode } from "./typstOptions";

/**
 * The named theme colours, `src/resources/types/zod/schema-types.ts:1476-1491`.
 *
 * The list matters twice. A name in it is followed to the value under
 * `color.<name>`, and a name outside it is a colour value, so getting the list
 * wrong turns an alias into a literal or a literal into a lookup.
 */
const NAMED_THEME_COLOURS: ReadonlySet<string> = new Set([
	"foreground",
	"background",
	"primary",
	"secondary",
	"tertiary",
	"success",
	"info",
	"warning",
	"danger",
	"light",
	"dark",
	"link",
]);

/** The recursion bound Quarto sets, `src/core/brand/brand.ts:197`. */
const MAX_ALIAS_DEPTH = 100;

/** One side of a `_brand.yml`, after the unified file has been split. */
interface SingleBrand {
	palette: Readonly<Record<string, string>>;
	colours: Readonly<Record<string, string>>;
}

/**
 * The parsed contents of a `_brand.yml`, one entry per mode.
 *
 * `fonts` sits outside the pair because a family is shared: the light and dark
 * split at `src/core/brand/brand.ts:590-611` strips only `color` and
 * `background-color` from a typography entry, so both sides keep the same one.
 */
export interface Brand {
	light: SingleBrand;
	dark: SingleBrand;
	fonts: Readonly<Record<string, string>>;
}

/** The typography entries the filter carries, `typst-render.lua:339`. */
const BRAND_TYPOGRAPHY_ENTRIES: readonly string[] = ["base", "headings"];

/** A string value of a mapping, or undefined when the key holds anything else. */
function stringAt(source: Record<string, unknown>, key: string): string | undefined {
	const value = source[key];
	return typeof value === "string" ? value : undefined;
}

/**
 * One named colour split across the two modes,
 * `src/core/brand/brand.ts:533-540`.
 *
 * A plain string is the same colour on both sides. A map contributes only the
 * side it names, so a brand that writes `dark:` alone leaves the light side with
 * no entry for that name at all.
 */
function splitColour(value: unknown): { light?: string; dark?: string } {
	if (typeof value === "string") {
		return { light: value, dark: value };
	}
	const map = mapping(value);
	return map === undefined ? {} : { light: stringAt(map, "light"), dark: stringAt(map, "dark") };
}

/**
 * A `_brand.yml` document split into its light and dark sides.
 *
 * The palette is shared, which is what makes an alias resolve the same way on
 * both sides while the name it points at differs by mode.
 */
export function splitBrand(document: unknown): Brand {
	const map = mapping(document);
	if (map === undefined) {
		return EMPTY_BRAND;
	}

	const fonts = readFonts(map.typography);

	const colourMap = mapping(map.color);
	if (colourMap === undefined) {
		return { ...EMPTY_BRAND, fonts };
	}

	const palette: Record<string, string> = {};
	for (const [name, value] of Object.entries(mapping(colourMap.palette) ?? {})) {
		if (typeof value === "string") {
			palette[name] = value;
		}
	}

	const light: Record<string, string> = {};
	const dark: Record<string, string> = {};
	for (const name of NAMED_THEME_COLOURS) {
		if (colourMap[name] === undefined) {
			continue;
		}
		const sides = splitColour(colourMap[name]);
		if (sides.light !== undefined) {
			light[name] = sides.light;
		}
		if (sides.dark !== undefined) {
			dark[name] = sides.dark;
		}
	}

	return { light: { palette, colours: light }, dark: { palette, colours: dark }, fonts };
}

/**
 * The font family of each typography entry the filter carries.
 *
 * An entry is a family name on its own or a mapping with a `family:` key, and
 * `get_typography` turns the first into the second before reading it
 * (`modules/brand/brand.lua:36`), so both spellings answer the same here.
 */
function readFonts(typography: unknown): Record<string, string> {
	const fonts: Record<string, string> = {};
	const map = mapping(typography);
	if (map === undefined) {
		return fonts;
	}
	for (const name of BRAND_TYPOGRAPHY_ENTRIES) {
		const entry = map[name];
		if (typeof entry === "string" && entry !== "") {
			fonts[name] = entry;
			continue;
		}
		const family = stringAt(mapping(entry) ?? {}, "family");
		if (family !== undefined && family !== "") {
			fonts[name] = family;
		}
	}
	return fonts;
}

/**
 * A brand name followed to the colour value it stands for,
 * `src/core/brand/brand.ts:161-197`.
 *
 * Three rules, tried in this order and repeated until one of them ends the walk:
 * a name in the palette is replaced by what the palette holds, a named theme
 * colour that the brand defines is replaced by what the brand holds, and
 * anything else is the colour value itself.
 *
 * The palette is tried first, so a palette entry named after a theme colour
 * shadows it, which is how a brand redefines `primary` away from its default.
 *
 * A cycle throws upstream. Here it resolves to undefined instead: a preview that
 * threw would take out the whole compile over a brand file the render also
 * rejects, and the panel would say nothing about which of the two was wrong.
 */
function followColour(brand: SingleBrand, name: string): string | undefined {
	const seen = new Set<string>();
	let current = name;

	for (let depth = 0; depth < MAX_ALIAS_DEPTH; depth++) {
		if (seen.has(current)) {
			return undefined;
		}
		seen.add(current);

		const alias = brand.palette[current];
		if (alias !== undefined && alias !== "") {
			current = alias;
			continue;
		}
		const themed = NAMED_THEME_COLOURS.has(current) ? brand.colours[current] : undefined;
		if (themed !== undefined && themed !== "") {
			current = themed;
			continue;
		}
		return current;
	}

	return undefined;
}

/**
 * A reader over a parsed brand, matching `get_color_css`.
 *
 * A name the brand does not define answers undefined rather than the name
 * itself. `processedData.color` upstream holds only the keys the file writes, so
 * a lookup of a name the file never mentions misses, and `background: auto`
 * against a brand with no background must fall back rather than compile
 * `rgb("background")`.
 */
export function brandColourReader(brand: Brand): BrandColourReader {
	return (mode: TypstBrandMode, name: string): string | undefined => {
		const side = brand[mode];
		if (side.palette[name] === undefined && side.colours[name] === undefined) {
			return undefined;
		}
		return followColour(side, name);
	};
}

/**
 * The four paths Quarto looks for a brand at,
 * `src/project/project-shared.ts:623-628`.
 *
 * They are relative to the project root, and they are tried in this order.
 */
export const BRAND_CANDIDATES: readonly string[] = [
	"_brand.yml",
	"_brand.yaml",
	"_brand/_brand.yml",
	"_brand/_brand.yaml",
];

/**
 * What a `brand:` key asks for.
 *
 * `false` disables the brand outright, `true` means the project default, a
 * string names one unified file, and a map names one file per mode.
 */
export type BrandOverride =
	| { kind: "default" }
	| { kind: "disabled" }
	| { kind: "unified"; path: string }
	| { kind: "split"; light?: string; dark?: string };

/**
 * The `brand:` key of a document or a project, `project-shared.ts:597-621`.
 *
 * An unreadable shape is the project default, which is what an absent key means
 * as well. Quarto validates the key and reports it, and a preview that reported
 * it too would say the same thing twice about a document Quarto is already
 * refusing.
 */
export function readBrandOverride(value: unknown): BrandOverride {
	if (value === undefined || value === null || value === true) {
		return { kind: "default" };
	}
	if (value === false) {
		return { kind: "disabled" };
	}
	if (typeof value === "string") {
		return { kind: "unified", path: value };
	}
	const map = mapping(value);
	if (map !== undefined && ("light" in map || "dark" in map)) {
		return { kind: "split", light: stringAt(map, "light"), dark: stringAt(map, "dark") };
	}
	return { kind: "default" };
}

/**
 * Two single-mode brand files joined into one brand.
 *
 * A `brand:` map names one file per mode, and each file is read as a whole
 * brand rather than split, so the light file contributes the light side only.
 */
export function joinBrands(light: unknown, dark: unknown): Brand {
	const lightBrand = splitBrand(light);
	const darkBrand = splitBrand(dark);
	// The light file names the fonts, because the two files are read as whole
	// brands and nothing upstream merges their typography either.
	return { light: lightBrand.light, dark: darkBrand.dark, fonts: lightBrand.fonts };
}

/** A brand that defines nothing, which is what no brand file at all means. */
export const EMPTY_BRAND: Brand = Object.freeze({
	light: { palette: {}, colours: {} },
	dark: { palette: {}, colours: {} },
	fonts: {},
});

/**
 * The semantic roles `_typst_render_brand` carries, `typst-render.lua:331-334`.
 *
 * Deliberately not every named theme colour: `light`, `dark` and `link` are left
 * out upstream, and the palette is left out as well.
 */
const BRAND_COLOUR_ROLES: readonly string[] = [
	"foreground",
	"background",
	"primary",
	"secondary",
	"tertiary",
	"success",
	"info",
	"warning",
	"danger",
];

/**
 * A brand colour kept only when it is a CSS hex string,
 * `typst-render.lua:348-355`.
 *
 * The dictionary carries `_brand.yml` values and not Typst expressions, so a
 * consumer reads it the way it reads the file. Such a consumer takes hex only,
 * and would read any other notation as the name of a palette entry.
 */
function hexOnly(css: string): string | undefined {
	const digits = /^#([0-9a-fA-F]+)$/.exec(css);
	if (digits === null) {
		return undefined;
	}
	const count = digits[1].length;
	return count === 3 || count === 4 || count === 6 || count === 8 ? css : undefined;
}

/** A Typst string literal, `_modules/string.lua:264-271`. */
function typstString(value: string): string {
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")}"`;
}

/**
 * A mapping as a Typst dictionary literal, `typst-render.lua:243-253`.
 *
 * Keys are sorted, so the literal is byte-identical between two runs over the
 * same brand, which is what lets the compiled source be cached and compared. An
 * empty mapping is `(:)`, because `()` is the empty array in Typst.
 */
function typstDictionary(entries: Readonly<Record<string, string>>): string {
	const keys = Object.keys(entries).sort();
	if (keys.length === 0) {
		return "(:)";
	}
	return `(${keys.map((key) => `${typstString(key)}: ${entries[key]}`).join(", ")})`;
}

/**
 * The `_typst_render_brand` dictionary for one mode,
 * `typst-render.lua:407-457`.
 *
 * `color` and `typography` are always present, empty when the brand says nothing
 * under them, so consuming Typst code has one shape to read.
 */
export function brandDictionary(brand: Brand, mode: TypstBrandMode): string {
	const read = brandColourReader(brand);

	// Each role is read from the wanted mode and then from the other
	// (`typst-render.lua:380-398`). The scan is per role and not per brand: Quarto
	// marks a brand as carrying a dark mode as soon as any one role declares a dark
	// value, so a role written for light only would otherwise vanish in dark mode.
	const hexAt = (side: TypstBrandMode, role: string): string | undefined => {
		const value = read(side, role);
		return value === undefined || value === "" ? undefined : hexOnly(value);
	};
	const other = mode === "light" ? "dark" : "light";
	const colours: Record<string, string> = {};
	for (const role of BRAND_COLOUR_ROLES) {
		const hex = hexAt(mode, role) ?? hexAt(other, role);
		if (hex !== undefined) {
			colours[role] = typstString(hex);
		}
	}

	const typography: Record<string, string> = {};
	for (const name of BRAND_TYPOGRAPHY_ENTRIES) {
		const family = brand.fonts[name];
		if (family !== undefined && family !== "") {
			typography[name] = typstDictionary({ family: typstString(family) });
		}
	}

	return typstDictionary({ color: typstDictionary(colours), typography: typstDictionary(typography) });
}
