import * as assert from "assert";
import { svgSize, clampSvg, svgDataUri } from "../../utils/typst/typstSvg";

// The root element below is the real one, taken from
// `typst compile --format svg - -` over a two line document. Typst writes the
// viewBox first, then width and height in points.
const REAL_ROOT =
	'<svg viewBox="0 0 41.236188889 18.513" width="41.236188889pt" height="18.513pt" ' +
	'xmlns="http://www.w3.org/2000/svg"><path d="M 0 0"/></svg>';

suite("Typst SVG Test Suite", () => {
	suite("svgSize", () => {
		test("Should read the width and height of a real root element", () => {
			assert.deepStrictEqual(svgSize(REAL_ROOT), { width: 41.236188889, height: 18.513 });
		});

		test("Should read a size given without a unit", () => {
			assert.deepStrictEqual(svgSize('<svg width="10" height="20"></svg>'), { width: 10, height: 20 });
		});

		test("Should return undefined when the root carries no size", () => {
			assert.strictEqual(svgSize('<svg viewBox="0 0 10 20"></svg>'), undefined);
		});

		test("Should return undefined for text that is not an SVG", () => {
			assert.strictEqual(svgSize("error: expected expression"), undefined);
		});

		test("Should not read a hyphenated attribute as the size", () => {
			// A word boundary holds between a hyphen and a letter, so a plain
			// `\bwidth` also matches `stroke-width` and reads the stroke instead.
			const svg = '<svg stroke-width="2" width="41pt" height="18pt"></svg>';
			assert.deepStrictEqual(svgSize(svg), { width: 41, height: 18 });
		});

		test("Should not read a width from a child element", () => {
			// A `use` or `rect` further down carries its own width, and reading it
			// would size the image from an arbitrary glyph.
			const svg = '<svg viewBox="0 0 1 2"><rect width="999" height="999"/></svg>';
			assert.strictEqual(svgSize(svg), undefined);
		});
	});

	suite("clampSvg", () => {
		test("Should leave an image under the limit unchanged", () => {
			assert.strictEqual(clampSvg(REAL_ROOT, 100), REAL_ROOT);
		});

		test("Should scale both dimensions and keep the viewBox", () => {
			const clamped = clampSvg(REAL_ROOT, 9.2565);
			assert.deepStrictEqual(svgSize(clamped), { width: 20.6180944445, height: 9.2565 });
			assert.ok(clamped.includes('viewBox="0 0 41.236188889 18.513"'), "the viewBox must not change");
		});

		test("Should rewrite the size and not a hyphenated attribute", () => {
			const clamped = clampSvg('<svg stroke-width="2" width="40pt" height="20pt"></svg>', 10);
			assert.ok(clamped.includes('stroke-width="2"'), clamped);
			assert.deepStrictEqual(svgSize(clamped), { width: 20, height: 10 });
		});

		test("Should leave an image with no readable size unchanged", () => {
			const svg = '<svg viewBox="0 0 10 20"></svg>';
			assert.strictEqual(clampSvg(svg, 5), svg);
		});
	});

	suite("svgDataUri", () => {
		test("Should build a base64 data URI that decodes to the source", () => {
			const uri = svgDataUri(REAL_ROOT);
			assert.ok(uri.startsWith("data:image/svg+xml;base64,"), uri.slice(0, 40));
			const encoded = uri.slice("data:image/svg+xml;base64,".length);
			assert.strictEqual(Buffer.from(encoded, "base64").toString("utf-8"), REAL_ROOT);
		});
	});
});
