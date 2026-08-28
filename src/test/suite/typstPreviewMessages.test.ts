import * as assert from "assert";
import { errorText } from "../../providers/typstPreview";

/** One diagnostic as Typst writes it, on the two lines it uses. */
function diagnostic(severity: string, message: string, line: number, column: number, file = "<stdin>"): string {
	return `${severity}: ${message}\n  ┌─ ${file}:${line}:${column}\n  │\n`;
}

suite("Typst Preview Messages Test Suite", () => {
	suite("errorText", () => {
		test("Should say which line count it is reporting", () => {
			// The panel header counts document lines, so a bare "line 2" reads as a
			// document line and points at the wrong text.
			const text = errorText(diagnostic("error", "expected expression", 2, 4), 1);
			assert.strictEqual(text, "error at line 1, column 5 of the block: expected expression");
		});

		test("Should show the error rather than a warning above it", () => {
			// Headlining a failed compile as a warning misstates why no image came
			// back, and Typst puts its warnings first.
			const stderr = diagnostic("warning", "unused variable", 2, 0) + diagnostic("error", "unknown variable", 3, 6);
			assert.strictEqual(errorText(stderr, 1), "error at line 2, column 7 of the block: unknown variable");
		});

		test("Should fall back to the only warning when there is no error", () => {
			assert.strictEqual(
				errorText(diagnostic("warning", "unused variable", 2, 0), 1),
				"warning at line 1, column 1 of the block: unused variable",
			);
		});

		test("Should report a failure that points at another file", () => {
			// Every diagnostic is dropped by the mapping, because none of them names
			// a position in this block. Reporting nothing would contradict both the
			// log and the missing image.
			const stderr = diagnostic("error", "file not found", 4, 2, "preamble.typ");
			assert.strictEqual(errorText(stderr, 1), "error outside this block: file not found");
		});

		test("Should say so when the compiler reported nothing at all", () => {
			assert.strictEqual(errorText("", 1), "Typst produced no image and reported nothing.");
		});
	});
});
