import * as assert from "assert";
import { findTypstInlines } from "../../utils/typst/typstInline";
import { blockAtOffset, findTypstUnits } from "../../utils/typst/typstBlocks";

suite("Typst Inline Test Suite", () => {
	test("Should read the prefix form as a cell", () => {
		const text = "The value is `{typst} #calc.pi` today.\n";
		const [unit] = findTypstInlines(text);
		assert.strictEqual(unit.scope, "inline");
		assert.strictEqual(unit.kind, "cell");
		assert.strictEqual(unit.body, "#calc.pi");
		assert.strictEqual(unit.code, "#calc.pi");
		assert.strictEqual(text.slice(unit.bodyStart, unit.bodyEnd), "#calc.pi");
		assert.strictEqual(unit.fenceStart, text.indexOf("`"));
		assert.strictEqual(unit.unitEnd, text.indexOf("` today") + 1);
	});

	test("Should read the class form as a cell, because the filter executes it", () => {
		const text = "A circle: `#circle()`{.typst}.\n";
		const [unit] = findTypstInlines(text);
		assert.strictEqual(unit.kind, "cell");
		assert.strictEqual(unit.body, "#circle()");
		// The attribute belongs to the unit, so a cursor inside it finds the unit.
		assert.strictEqual(unit.unitEnd, text.indexOf("}") + 1);
	});

	test("Should read the raw form as raw", () => {
		const text = "Bound here: `#let a = 1`{=typst}.\n";
		const [unit] = findTypstInlines(text);
		assert.strictEqual(unit.kind, "raw");
		assert.strictEqual(unit.body, "#let a = 1");
	});

	test("Should keep a class beside other classes", () => {
		const text = "A circle: `#circle()`{.typst .extra}.\n";
		assert.strictEqual(findTypstInlines(text)[0]?.kind, "cell");
	});

	test("Should read a span written with a longer backtick run", () => {
		const text = 'Code: ``{typst} #raw("`")``.\n';
		assert.strictEqual(findTypstInlines(text)[0]?.body, '#raw("`")');
	});

	test("Should remove one space from each end, as CommonMark does", () => {
		const text = "Value: `` {typst} #calc.pi ``.\n";
		assert.strictEqual(findTypstInlines(text)[0]?.body, "#calc.pi");
	});

	test("Should read no span that is not Typst", () => {
		const text = "Plain `#circle()` and `x`{.python} and `y`{=html}.\n";
		assert.deepStrictEqual(findTypstInlines(text), []);
	});

	test("Should read no span inside a fenced block", () => {
		const text = ["```markdown", "`{typst} #circle()`", "```", ""].join("\n");
		assert.deepStrictEqual(findTypstInlines(text), []);
	});

	test("Should read no span inside the front matter", () => {
		const text = ["---", 'title: "`{typst} #circle()`"', "---", "", "Prose.", ""].join("\n");
		assert.deepStrictEqual(findTypstInlines(text), []);
	});

	test("Should read a span that runs across a line ending", () => {
		// CommonMark converts every line ending inside a span to one space before
		// the span's content exists at all, so Pandoc hands the filter one line.
		const text = "Value: `{typst} #calc\n.pi`.\n";
		assert.strictEqual(findTypstInlines(text)[0]?.body, "#calc .pi");
	});

	test("Should convert an embedded CRLF to one space and keep bodyEnd on the document", () => {
		// A converted `\r\n` is one character shorter than the two document
		// characters it replaced, so this pins `bodyEnd` against the raw text
		// rather than against `body.length`.
		const text = "Value: `{typst} #calc\r\n.pi`.\r\n";
		const [unit] = findTypstInlines(text);
		assert.strictEqual(unit.body, "#calc .pi");
		assert.strictEqual(text.slice(unit.bodyStart, unit.bodyEnd), "#calc\r\n.pi");
	});

	test("Should measure the prefix separator in document units when it is a CRLF", () => {
		// The `\r\n` between `{typst}` and the code is two document characters but
		// one converted character, so a prefix length read from the converted text
		// would land `bodyStart` one character early, inside the line ending
		// rather than on the code that follows it.
		const text = "Value: `{typst}\r\n#calc.pi`.\r\n";
		const [unit] = findTypstInlines(text);
		assert.strictEqual(unit.body, "#calc.pi");
		assert.strictEqual(text.slice(unit.bodyStart, unit.bodyEnd), "#calc.pi");
	});

	test("Should measure the prefix separator in document units when it is a bare newline", () => {
		// A bare `\n` is one document character and one converted character, so
		// this was already correct before the CRLF fix above. Pinned here so the
		// fix does not shift it.
		const text = "Value: `{typst}\n#calc.pi`.\n";
		const [unit] = findTypstInlines(text);
		assert.strictEqual(unit.body, "#calc.pi");
		assert.strictEqual(text.slice(unit.bodyStart, unit.bodyEnd), "#calc.pi");
	});

	test("Should read a span in a CRLF document", () => {
		const text = "Value: `{typst} #calc.pi`.\r\nMore prose.\r\n";
		assert.strictEqual(findTypstInlines(text)[0]?.body, "#calc.pi");
	});

	test("Should read no span whose attribute merely contains the raw text, unquoted key=value", () => {
		// Pandoc's bracketed attribute syntax allows an unquoted `key=value` pair,
		// so `{lang=typst-preview}` holds the substring `=typst` without being the
		// raw-passthrough form `{=typst}`.
		const text = "Code: `#circle()`{lang=typst-preview}.\n";
		assert.deepStrictEqual(findTypstInlines(text), []);
	});

	test("Should read no span whose attribute merely contains the class inside a quoted value", () => {
		// A quoted attribute value can hold the text `.typst` bounded by whitespace
		// or a brace, which would otherwise read as the class.
		const text = 'Code: `#circle()`{alt="see .typst here"}.\n';
		assert.deepStrictEqual(findTypstInlines(text), []);
	});

	test("Should read a real class beside another attribute", () => {
		const text = 'A circle: `#circle()`{alt="see here" .typst}.\n';
		assert.strictEqual(findTypstInlines(text)[0]?.kind, "cell");
	});

	test("Should read no phantom span between two fences of equal run length", () => {
		// A body-only fenced range leaves the opening backtick run unguarded, and
		// two fences of the same length let that run pair with the next fence's
		// opening run, reading the prose between them as one span. `findTypstInlines`
		// rebuilds the ranges from `fenceStart` to guard against exactly this.
		const text = ["```typst", "#a", "```", "", "Prose in between.", "", "```{=typst}", "#b", "```", ""].join("\n");
		assert.deepStrictEqual(findTypstInlines(text), []);
		assert.ok(findTypstUnits(text).every((unit) => unit.scope === "block"));
	});

	test("Should merge spans and fences in document order", () => {
		const text = ["Value: `{typst} #calc.pi`.", "", "```typst", "#circle()", "```", ""].join("\n");
		const units = findTypstUnits(text);
		assert.deepStrictEqual(
			units.map((unit) => unit.scope),
			["inline", "block"],
		);
	});

	test("Should find the unit under a cursor on the closing run or in the attribute", () => {
		const text = "A circle: `#circle()`{.typst}.\n";
		const units = findTypstUnits(text);
		const closing = text.indexOf("`{.typst}");
		const attribute = text.indexOf(".typst");
		assert.strictEqual(blockAtOffset(units, closing), units[0]);
		assert.strictEqual(blockAtOffset(units, attribute), units[0]);
	});
});
