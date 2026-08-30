import * as assert from "assert";
import { findTypstBlocks, type TypstBlock } from "../../utils/typst/typstBlocks";
import { EMPTY_BRAND, brandColourReader } from "../../utils/typst/typstBrand";
import {
	TYPST_DEFAULTS,
	cssColourToTypst,
	documentBrandMode,
	extensionLevel,
	mergeGlobalConfigs,
	resolveColourConfig,
	resolveColourValue,
	resolveGlobalConfig,
	resolveTypstOptions,
	type BrandColourReader,
	type TypstGlobalLevel,
} from "../../utils/typst/typstOptions";

/** The one cell of a document written as an option run over one line of code. */
function cell(options: string[]): TypstBlock {
	const body = [...options.map((option) => `//| ${option}`), "#circle()"].join("\n");
	return findTypstBlocks(`\`\`\`{typst}\n${body}\n\`\`\`\n`)[0];
}

/** A document with no brand at all, which is what every candidate path missing means. */
const NO_BRAND_READER = brandColourReader(EMPTY_BRAND);

/** A brand answering one colour per mode, for the `auto` cases. */
function brandOf(light: Record<string, string>, dark: Record<string, string> = light): BrandColourReader {
	return (mode, name) => (mode === "light" ? light : dark)[name];
}

suite("Typst Options Test Suite", () => {
	suite("TYPST_DEFAULTS", () => {
		// Cross-checked against `typst-render.lua:35-64` rather than read at run
		// time, because the schema's own `default:` values are documentation and
		// disagree with the filter in places.
		test("Should carry the filter's own default for every key it defaults", () => {
			assert.deepStrictEqual(TYPST_DEFAULTS, {
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
		});

		test("Should hold no key at all for a key the filter defaults to nil", () => {
			// `merge_options` copies with `pairs`, which skips a nil value, so these
			// four are absent from a merged table rather than undefined in it.
			for (const key of ["format", "foreground", "file", "input"]) {
				assert.ok(!Object.hasOwn(TYPST_DEFAULTS, key), `${key} should be absent`);
			}
		});
	});

	suite("cssColourToTypst", () => {
		const cases: [string, string][] = [
			["#fdfdfd", 'rgb("#fdfdfd")'],
			["#fff", 'rgb("#fff")'],
			["rgb(255, 0, 0)", 'rgb("rgb(255, 0, 0)")'],
			["hsl(120, 50%, 50%)", 'rgb("hsl(120, 50%, 50%)")'],
			// Already Typst form. Wrapping it again would nest a quote inside a
			// quoted string, which does not compile.
			['rgb("#fff")', 'rgb("#fff")'],
			['hsl("120deg, 50%, 50%")', 'hsl("120deg, 50%, 50%")'],
			// Typst-native spellings, which pass through untouched.
			["blue", "blue"],
			["luma(240)", "luma(240)"],
			["oklch(70% 0.1 200deg)", "oklch(70% 0.1 200deg)"],
			["none", "none"],
		];

		for (const [input, expected] of cases) {
			test(`Should read \`${input}\` as \`${expected}\``, () => {
				assert.strictEqual(cssColourToTypst(input), expected);
			});
		}
	});

	suite("resolveColourValue", () => {
		test("Should read one mode of a pair", () => {
			assert.strictEqual(resolveColourValue({ light: "white", dark: "black" }, "dark"), "black");
		});

		test("Should fall back to the other mode when the wanted one is absent", () => {
			// A brand commonly writes one side only, and a block that then rendered
			// with no colour at all would look like the option was ignored.
			assert.strictEqual(resolveColourValue({ light: "white" }, "dark"), "white");
		});

		test("Should read a plain string as itself in either mode", () => {
			assert.strictEqual(resolveColourValue("navy", "dark"), "navy");
		});

		test("Should answer nothing for an absent colour", () => {
			assert.strictEqual(resolveColourValue(undefined, "light"), undefined);
		});
	});

	suite("resolveColourConfig", () => {
		test("Should keep both sides of a light and dark map", () => {
			const resolved = resolveColourConfig({ light: "#fff", dark: "#000" }, "background", NO_BRAND_READER);
			assert.deepStrictEqual(resolved, { light: 'rgb("#fff")', dark: 'rgb("#000")' });
		});

		test("Should collapse a map that names one side to that side", () => {
			assert.strictEqual(resolveColourConfig({ dark: "#000" }, "background", NO_BRAND_READER), 'rgb("#000")');
		});

		test("Should read auto from the brand, as a pair when the modes differ", () => {
			const brand = brandOf({ background: "#fdf6e3" }, { background: "#101418" });
			assert.deepStrictEqual(resolveColourConfig("auto", "background", brand), {
				light: 'rgb("#fdf6e3")',
				dark: 'rgb("#101418")',
			});
		});

		test("Should collapse auto to one colour when the brand names the same one twice", () => {
			// A pair would send the filter down its dual-rendering path for no
			// difference in output.
			const brand = brandOf({ background: "#fdf6e3" });
			assert.strictEqual(resolveColourConfig("auto", "background", brand), 'rgb("#fdf6e3")');
		});

		test("Should fall back when auto finds no brand colour", () => {
			assert.strictEqual(resolveColourConfig("auto", "background", NO_BRAND_READER), undefined);
		});

		test("Should answer nothing for an empty colour", () => {
			assert.strictEqual(resolveColourConfig("", "foreground", NO_BRAND_READER), undefined);
		});
	});

	suite("extensionLevel", () => {
		test("Should read the extensions mapping", () => {
			const level = extensionLevel({ extensions: { "typst-render": { dpi: 300 } } });
			assert.deepStrictEqual(level, { dpi: 300 });
		});

		test("Should fall back to the bare top-level key", () => {
			// A legacy spelling the filter still reads, so a document written the old
			// way previews the way it renders.
			assert.deepStrictEqual(extensionLevel({ "typst-render": { dpi: 300 } }), { dpi: 300 });
		});

		test("Should prefer the extensions mapping over the bare key", () => {
			const level = extensionLevel({
				extensions: { "typst-render": { dpi: 300 } },
				"typst-render": { dpi: 96 },
			});
			assert.deepStrictEqual(level, { dpi: 300 });
		});

		test("Should answer nothing for a document that names neither", () => {
			assert.strictEqual(extensionLevel({ title: "A document" }), undefined);
		});
	});

	suite("documentBrandMode", () => {
		test("Should read an explicit mode", () => {
			assert.strictEqual(documentBrandMode({ "brand-mode": "dark" }), "dark");
			assert.strictEqual(documentBrandMode({ "brand-mode": "light" }), "light");
		});

		test("Should answer nothing when the document sets none", () => {
			// The filter defaults to light here. The preview follows the editor theme
			// instead, and undefined is what says the document has no opinion.
			assert.strictEqual(documentBrandMode({ title: "A document" }), undefined);
		});
	});

	suite("resolveGlobalConfig", () => {
		test("Should coerce a numeric key and drop one that is not a number", () => {
			assert.strictEqual(resolveGlobalConfig({ dpi: "300" }, NO_BRAND_READER).dpi, 300);
			assert.ok(!Object.hasOwn(resolveGlobalConfig({ dpi: "wide" }, NO_BRAND_READER), "dpi"));
		});

		test("Should keep the three-way values of echo, code-fold and output", () => {
			assert.strictEqual(resolveGlobalConfig({ echo: "fenced" }, NO_BRAND_READER).echo, "fenced");
			assert.strictEqual(resolveGlobalConfig({ "code-fold": "show" }, NO_BRAND_READER)["code-fold"], "show");
			assert.strictEqual(resolveGlobalConfig({ output: "asis" }, NO_BRAND_READER).output, "asis");
		});

		test("Should read an invalid code-fold as false, which is what the warning does", () => {
			assert.strictEqual(resolveGlobalConfig({ "code-fold": "maybe" }, NO_BRAND_READER)["code-fold"], false);
		});

		test("Should keep a code-line-numbers range verbatim", () => {
			assert.strictEqual(
				resolveGlobalConfig({ "code-line-numbers": "1|3-4" }, NO_BRAND_READER)["code-line-numbers"],
				"1|3-4",
			);
		});

		test("Should store preamble and font-path as lists whichever way they are written", () => {
			assert.deepStrictEqual(resolveGlobalConfig({ preamble: "#let a = 1" }, NO_BRAND_READER).preamble, ["#let a = 1"]);
			assert.deepStrictEqual(resolveGlobalConfig({ preamble: ["a", "b.typ"] }, NO_BRAND_READER).preamble, [
				"a",
				"b.typ",
			]);
			assert.deepStrictEqual(resolveGlobalConfig({ "font-path": "fonts" }, NO_BRAND_READER)["font-path"], ["fonts"]);
		});

		test("Should read an empty preamble as an empty list, which clears an outer one", () => {
			assert.deepStrictEqual(resolveGlobalConfig({ preamble: "" }, NO_BRAND_READER).preamble, []);
		});

		test("Should ignore an input that is not a map", () => {
			// A string is a warning upstream and is dropped, which leaves whatever an
			// outer level set.
			assert.ok(!Object.hasOwn(resolveGlobalConfig({ input: "a=1" }, NO_BRAND_READER), "input"));
			assert.deepStrictEqual(resolveGlobalConfig({ input: { a: 1 } }, NO_BRAND_READER).input, { a: "1" });
		});
	});

	suite("mergeGlobalConfigs", () => {
		test("Should let a later level win, key by key", () => {
			const levels: TypstGlobalLevel[] = [{ dpi: 96, margin: "1cm" }, { dpi: 300 }];
			const merged = mergeGlobalConfigs(levels, NO_BRAND_READER);
			assert.strictEqual(merged.dpi, 300);
			assert.strictEqual(merged.margin, "1cm");
		});

		test("Should resolve each level on its own", () => {
			// Resolving the merged mapping instead would read two half-written pairs
			// as though one level had written both halves.
			const levels: TypstGlobalLevel[] = [{ background: { light: "#fff", dark: "#000" } }, { background: "navy" }];
			assert.strictEqual(mergeGlobalConfigs(levels, NO_BRAND_READER).background, "navy");
		});
	});

	suite("resolveTypstOptions", () => {
		test("Should let a block option win over a global one", () => {
			const options = resolveTypstOptions(cell(["margin: 2mm"]), { margin: "1cm" }, NO_BRAND_READER);
			assert.strictEqual(options.margin, "2mm");
		});

		test("Should leave the default in place when nothing overrides it", () => {
			assert.strictEqual(resolveTypstOptions(cell([]), {}, NO_BRAND_READER).width, "auto");
		});

		test("Should wrap a block colour as a Typst expression", () => {
			const options = resolveTypstOptions(cell(['background: "#faf6ee"']), {}, NO_BRAND_READER);
			assert.strictEqual(options.background, 'rgb("#faf6ee")');
		});

		test("Should not wrap a colour inherited from a global level a second time", () => {
			// A global value is already an expression, and `rgb("rgb("#fff")")` does
			// not compile.
			const options = resolveTypstOptions(cell([]), { background: 'rgb("#faf6ee")' }, NO_BRAND_READER);
			assert.strictEqual(options.background, 'rgb("#faf6ee")');
		});

		test("Should leave a block background of none as the bare word", () => {
			// The guard upstream is against the default and not against the inherited
			// value, so `none` is left alone rather than rewritten.
			const options = resolveTypstOptions(
				cell(["background: none"]),
				{ background: 'rgb("#123456")' },
				NO_BRAND_READER,
			);
			assert.strictEqual(options.background, "none");
		});

		test("Should resolve a block auto colour through the brand", () => {
			const brand = brandOf({ background: "#fdf6e3" });
			const options = resolveTypstOptions(cell(["background: auto"]), {}, brand);
			assert.strictEqual(options.background, 'rgb("#fdf6e3")');
		});

		test("Should leave no foreground key when auto finds no brand", () => {
			// The filter assigns `DEFAULTS.foreground`, which is nil, and assigning
			// nil in Lua removes the key.
			const options = resolveTypstOptions(cell(["foreground: auto"]), {}, NO_BRAND_READER);
			assert.ok(!Object.hasOwn(options, "foreground"));
		});

		test("Should drop a per-block cache-refresh, which is a global option", () => {
			const options = resolveTypstOptions(cell(["cache-refresh: true"]), {}, NO_BRAND_READER);
			assert.strictEqual(options["cache-refresh"], false);
		});

		test("Should keep a block input string apart from the global input map", () => {
			// The merge would otherwise replace the map with the string.
			const options = resolveTypstOptions(cell(["input: theme=dark"]), { input: { lang: "en" } }, NO_BRAND_READER);
			assert.deepStrictEqual(options.input, { lang: "en" });
			assert.strictEqual(options._block_input, "theme=dark");
		});

		test("Should keep a block dpi as the string the comment-pipe parsed", () => {
			// The coercion is at the compile and not at the merge, so the merged
			// table carries the string.
			assert.strictEqual(resolveTypstOptions(cell(["dpi: 300"]), {}, NO_BRAND_READER).dpi, "300");
		});
	});
});
