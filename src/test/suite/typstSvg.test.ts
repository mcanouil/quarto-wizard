import * as assert from "assert";
import { clampSvg, svgDataUri } from "../../utils/typst/typstSvg";

// The root element below is the real one, taken from
// `typst compile --format svg - -` over a two line document. Typst writes the
// viewBox first, then width and height in points.
const REAL_ROOT =
	'<svg viewBox="0 0 41.236188889 18.513" width="41.236188889pt" height="18.513pt" ' +
	'xmlns="http://www.w3.org/2000/svg"><path d="M 0 0"/></svg>';

suite("Typst SVG Test Suite", () => {
	suite("clampSvg", () => {
		test("Should leave an image under the limit unchanged", () => {
			assert.strictEqual(clampSvg(REAL_ROOT, 100), REAL_ROOT);
		});

		test("Should scale both dimensions of a real root element and keep the viewBox", () => {
			const clamped = clampSvg(REAL_ROOT, 9.2565);
			assert.ok(clamped.includes('width="20.6180944445pt"'), clamped);
			assert.ok(clamped.includes('height="9.2565pt"'), clamped);
			assert.ok(clamped.includes('viewBox="0 0 41.236188889 18.513"'), "the viewBox must not change");
		});

		test("Should scale a size given without a unit", () => {
			const clamped = clampSvg('<svg width="10" height="20"></svg>', 10);
			assert.strictEqual(clamped, '<svg width="5" height="10"></svg>');
		});

		test("Should rewrite the size and not a hyphenated attribute", () => {
			// A word boundary holds between a hyphen and a letter, so a plain
			// `\bwidth` also matches `stroke-width` and would read the stroke as the
			// size, then rewrite it.
			const clamped = clampSvg('<svg stroke-width="2" width="40pt" height="20pt"></svg>', 10);
			assert.strictEqual(clamped, '<svg stroke-width="2" width="20pt" height="10pt"></svg>');
		});

		test("Should leave an image whose root carries no size unchanged", () => {
			const svg = '<svg viewBox="0 0 10 20"></svg>';
			assert.strictEqual(clampSvg(svg, 5), svg);
		});

		test("Should not take a size from a child element", () => {
			// A `use` or `rect` further down carries its own width, and reading it
			// would size the image from an arbitrary glyph.
			const svg = '<svg viewBox="0 0 1 2"><rect width="999" height="999"/></svg>';
			assert.strictEqual(clampSvg(svg, 5), svg);
		});

		test("Should leave text that is not an SVG unchanged", () => {
			const stderr = "error: expected expression";
			assert.strictEqual(clampSvg(stderr, 5), stderr);
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
