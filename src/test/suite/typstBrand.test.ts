import * as assert from "assert";
import {
	BRAND_CANDIDATES,
	EMPTY_BRAND,
	brandColourReader,
	brandDictionary,
	joinBrands,
	readBrandOverride,
	splitBrand,
} from "../../utils/typst/typstBrand";

/** A brand whose palette aliases the two colours a preview reads. */
const ALIASED = {
	color: {
		palette: { ink: "#1b1b1b", paper: "#fdf6e3" },
		foreground: "ink",
		background: "paper",
		primary: "#268bd2",
	},
	typography: { base: { family: "Inter" } },
};

/** A brand whose two modes disagree, written the way `_brand.yml` writes it. */
const DUAL = {
	color: {
		palette: { ink: "#1b1b1b", paper: "#fdf6e3" },
		foreground: { light: "ink", dark: "#e8e8e8" },
		background: { light: "paper", dark: "#101418" },
	},
};

suite("Typst Brand Test Suite", () => {
	suite("BRAND_CANDIDATES", () => {
		test("Should be the four paths Quarto looks at, in Quarto's order", () => {
			assert.deepStrictEqual(BRAND_CANDIDATES, [
				"_brand.yml",
				"_brand.yaml",
				"_brand/_brand.yml",
				"_brand/_brand.yaml",
			]);
		});
	});

	suite("brandColourReader", () => {
		test("Should follow a palette alias to its value", () => {
			const read = brandColourReader(splitBrand(ALIASED));
			assert.strictEqual(read("light", "background"), "#fdf6e3");
			assert.strictEqual(read("light", "foreground"), "#1b1b1b");
		});

		test("Should read a colour value that needs no alias", () => {
			assert.strictEqual(brandColourReader(splitBrand(ALIASED))("light", "primary"), "#268bd2");
		});

		test("Should read the palette entry itself by name", () => {
			assert.strictEqual(brandColourReader(splitBrand(ALIASED))("light", "ink"), "#1b1b1b");
		});

		test("Should answer nothing for a name the brand never mentions", () => {
			// The name itself would otherwise reach the source as `rgb("danger")`,
			// which does not compile, and `background: auto` must fall back instead.
			assert.strictEqual(brandColourReader(splitBrand(ALIASED))("light", "danger"), undefined);
		});

		test("Should read each mode of a brand whose modes disagree", () => {
			const read = brandColourReader(splitBrand(DUAL));
			assert.strictEqual(read("light", "background"), "#fdf6e3");
			assert.strictEqual(read("dark", "background"), "#101418");
			assert.strictEqual(read("dark", "foreground"), "#e8e8e8");
		});

		test("Should share the palette between the two modes", () => {
			// The split copies the palette to both sides, which is what lets an alias
			// resolve the same way while the name it points at differs by mode.
			assert.strictEqual(brandColourReader(splitBrand(DUAL))("dark", "ink"), "#1b1b1b");
		});

		test("Should leave a name out of the mode that does not define it", () => {
			const brand = splitBrand({ color: { foreground: { dark: "#eee" } } });
			assert.strictEqual(brandColourReader(brand)("dark", "foreground"), "#eee");
			assert.strictEqual(brandColourReader(brand)("light", "foreground"), undefined);
		});

		test("Should answer nothing rather than loop on a cycle", () => {
			// Quarto throws here. A preview that threw would take out the compile
			// over a brand file the render also rejects.
			const brand = splitBrand({ color: { palette: { a: "b", b: "a" }, foreground: "a" } });
			assert.strictEqual(brandColourReader(brand)("light", "foreground"), undefined);
		});

		test("Should answer nothing for a brand with no colour at all", () => {
			assert.strictEqual(brandColourReader(EMPTY_BRAND)("light", "background"), undefined);
			assert.strictEqual(brandColourReader(splitBrand(undefined))("light", "background"), undefined);
		});
	});

	suite("brandDictionary", () => {
		test("Should carry the resolved hex of every role the brand defines", () => {
			assert.strictEqual(
				brandDictionary(splitBrand(ALIASED), "light"),
				'("color": ("background": "#fdf6e3", "foreground": "#1b1b1b", "primary": "#268bd2"), ' +
					'"typography": ("base": ("family": "Inter")))',
			);
		});

		test("Should hold both keys and an empty dictionary when the brand says nothing", () => {
			// Consuming Typst code has one shape to read, so the two keys are always
			// present. `(:)` is the empty dictionary; `()` is the empty array.
			assert.strictEqual(brandDictionary(EMPTY_BRAND, "light"), '("color": (:), "typography": (:))');
		});

		test("Should read the dark side of a brand whose modes disagree", () => {
			assert.strictEqual(
				brandDictionary(splitBrand(DUAL), "dark"),
				'("color": ("background": "#101418", "foreground": "#e8e8e8"), "typography": (:))',
			);
		});

		test("Should fall back to the other mode for a role written on one side only", () => {
			// Quarto marks a brand as carrying a dark mode as soon as one role
			// declares a dark value, so a light-only role would otherwise vanish.
			const brand = splitBrand({ color: { foreground: { dark: "#eee" }, primary: "#268bd2" } });
			assert.ok(brandDictionary(brand, "dark").includes('"primary": "#268bd2"'));
		});

		test("Should leave out a role written in a notation that is not hex", () => {
			// The dictionary carries brand values, and a consumer would read any
			// other notation as the name of a palette entry.
			const brand = splitBrand({ color: { primary: "rebeccapurple", secondary: "#268bd2" } });
			assert.strictEqual(brandDictionary(brand, "light"), '("color": ("secondary": "#268bd2"), "typography": (:))');
		});

		test("Should leave out a hex of a length CSS does not allow", () => {
			const brand = splitBrand({ color: { primary: "#12345" } });
			assert.strictEqual(brandDictionary(brand, "light"), '("color": (:), "typography": (:))');
		});

		test("Should carry neither light, dark nor link, which are not roles", () => {
			const brand = splitBrand({ color: { light: "#ffffff", dark: "#000000", link: "#268bd2" } });
			assert.strictEqual(brandDictionary(brand, "light"), '("color": (:), "typography": (:))');
		});

		test("Should read a typography entry written as a bare family name", () => {
			const brand = splitBrand({ typography: { base: "Inter", headings: { family: "Fira Sans" } } });
			assert.strictEqual(
				brandDictionary(brand, "light"),
				'("color": (:), "typography": ("base": ("family": "Inter"), "headings": ("family": "Fira Sans")))',
			);
		});

		test("Should escape a family name that carries a quote", () => {
			const brand = splitBrand({ typography: { base: { family: 'A "B"' } } });
			assert.ok(brandDictionary(brand, "light").includes('"base": ("family": "A \\"B\\"")'));
		});
	});

	suite("readBrandOverride", () => {
		test("Should read an absent or true key as the project default", () => {
			assert.deepStrictEqual(readBrandOverride(undefined), { kind: "default" });
			assert.deepStrictEqual(readBrandOverride(true), { kind: "default" });
		});

		test("Should read false as no brand at all", () => {
			assert.deepStrictEqual(readBrandOverride(false), { kind: "disabled" });
		});

		test("Should read a string as one unified file", () => {
			assert.deepStrictEqual(readBrandOverride("theme/_brand.yml"), { kind: "unified", path: "theme/_brand.yml" });
		});

		test("Should read a map as one file per mode", () => {
			assert.deepStrictEqual(readBrandOverride({ light: "a.yml", dark: "b.yml" }), {
				kind: "split",
				light: "a.yml",
				dark: "b.yml",
			});
		});

		test("Should read a shape Quarto would reject as the project default", () => {
			// Quarto validates the key and reports it, and saying the same thing
			// twice about a document Quarto is already refusing helps nobody.
			assert.deepStrictEqual(readBrandOverride(["a.yml"]), { kind: "default" });
		});
	});

	suite("joinBrands", () => {
		test("Should take each mode from its own file", () => {
			const brand = joinBrands({ color: { background: "#fdf6e3" } }, { color: { background: "#101418" } });
			const read = brandColourReader(brand);
			assert.strictEqual(read("light", "background"), "#fdf6e3");
			assert.strictEqual(read("dark", "background"), "#101418");
		});
	});
});
