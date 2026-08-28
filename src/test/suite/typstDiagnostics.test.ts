import * as assert from "assert";
import { parseTypstStderr } from "../../utils/typst/typstDiagnostics";

// Both samples below are the real output of
// `typst compile --format svg - -`, captured from the binary that ships inside
// Quarto. The message is on the first line and the position on the second, so
// a reader that looks only for `<stdin>:line:column` loses every message.
const ONE_ERROR = ["error: expected pattern", "  ┌─ <stdin>:2:4", "  │", "2 │ #let", "  │     ^", ""].join("\n");

const TWO_ERRORS = [
	"error: expected expression",
	"  ┌─ <stdin>:1:8",
	"  │",
	"1 │ #let a = ",
	"  │         ^",
	"",
	"error: unclosed delimiter",
	"  ┌─ <stdin>:3:2",
	"  │",
	"3 │ #c(",
	"  │   ^",
	"",
].join("\n");

suite("Typst Diagnostics Test Suite", () => {
	test("Should read the message and the position of one error", () => {
		assert.deepStrictEqual(parseTypstStderr(ONE_ERROR, 0), [
			{ line: 1, column: 4, message: "expected pattern", severity: "error" },
		]);
	});

	test("Should read every diagnostic of a run", () => {
		assert.deepStrictEqual(parseTypstStderr(TWO_ERRORS, 0), [
			{ line: 0, column: 8, message: "expected expression", severity: "error" },
			{ line: 2, column: 2, message: "unclosed delimiter", severity: "error" },
		]);
	});

	test("Should subtract the injected lines so a position maps to the document", () => {
		// The compiled source carries a header the author never wrote, so the
		// reported line is ahead of the block by exactly that many lines.
		// One injected line above a report on Typst line 2 leaves the first line
		// of the body, and the column survives because the line is still inside it.
		assert.deepStrictEqual(parseTypstStderr(ONE_ERROR, 1), [
			{ line: 0, column: 4, message: "expected pattern", severity: "error" },
		]);
	});

	test("Should point at the start of the body for an error in the header", () => {
		// An error inside the injected header maps above the block. A negative
		// line is not a position any editor can take, and the column that came
		// with it was measured against a line the author never wrote, so keeping
		// it would put the mark at an arbitrary character of the first body line.
		assert.deepStrictEqual(parseTypstStderr(ONE_ERROR, 10), [
			{ line: 0, column: 0, message: "expected pattern", severity: "error" },
		]);
	});

	test("Should read a warning as well as an error", () => {
		const stderr = ["warning: unnecessary import", "  ┌─ <stdin>:1:1", "  │", "1 │ #import", ""].join("\n");
		assert.deepStrictEqual(parseTypstStderr(stderr, 0), [
			{ line: 0, column: 1, message: "unnecessary import", severity: "warning" },
		]);
	});

	test("Should ignore a diagnostic that names a file other than the source", () => {
		// A preamble read from disk reports its own path, and mapping that line
		// onto the block would point at the wrong text entirely.
		const stderr = ["error: file not found", "  ┌─ preamble.typ:4:2", "  │", "4 │ #x", ""].join("\n");
		assert.deepStrictEqual(parseTypstStderr(stderr, 0), []);
	});

	test("Should return nothing for output that holds no diagnostic", () => {
		assert.deepStrictEqual(parseTypstStderr("", 0), []);
		assert.deepStrictEqual(parseTypstStderr("<svg></svg>", 0), []);
	});
});
