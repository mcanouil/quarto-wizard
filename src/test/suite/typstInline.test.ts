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
		const text = "Value: `{typst} #calc\n.pi`.\n";
		assert.strictEqual(findTypstInlines(text)[0]?.body, "#calc\n.pi");
	});

	test("Should read a span in a CRLF document", () => {
		const text = "Value: `{typst} #calc.pi`.\r\nMore prose.\r\n";
		assert.strictEqual(findTypstInlines(text)[0]?.body, "#calc.pi");
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
