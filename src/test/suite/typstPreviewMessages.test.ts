import * as assert from "assert";
import * as vscode from "vscode";
import { errorText, previewColour, previewTimeoutMs, themeKindOf } from "../../providers/typstPreview";
import { DEFAULT_TIMEOUT_MS } from "../../providers/typstPreview/typstCompiler";

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

		test("Should say that a failure sits above the block rather than in it", () => {
			// A raw block compiles under every raw block before it, so the error can
			// belong to one of those. Reporting line 1 of this block would name the
			// wrong block and the wrong line, and saying nothing about where it is
			// would leave the reader looking at a block that compiles.
			const text = errorText(diagnostic("error", "unknown variable: accent", 2, 4), 5);
			assert.strictEqual(text, "error above this block: unknown variable: accent");
		});

		test("Should claim no position when Typst gave none", () => {
			// A package that would not download is not about a place in the block.
			// Reporting "line 1, column 1" would assert a position that does not
			// exist and mark a character that is not at fault.
			const stderr = "error: failed to download package @preview/example:0.1.0\n";
			assert.strictEqual(errorText(stderr, 1), "error: failed to download package @preview/example:0.1.0");
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

	suite("previewTimeoutMs", () => {
		const cases: [string, unknown, number][] = [
			["a value inside the bounds", 5000, 5000],
			["zero, which would fail every compile at once", 0, 1000],
			["a negative value", -1, 1000],
			["a value above the upper bound", 999999, 300000],
			["a value that is not a number at all", "soon", DEFAULT_TIMEOUT_MS],
			["a value that is not finite", Number.NaN, DEFAULT_TIMEOUT_MS],
		];

		for (const [description, value, expected] of cases) {
			test(`Should handle ${description}`, () => {
				// The bounds in `package.json` only guide the settings user interface.
				// A hand-edited `settings.json` reaches the compiler unchecked, and
				// `setTimeout` accepts every one of these without complaining.
				assert.strictEqual(previewTimeoutMs(value), expected);
			});
		}
	});

	suite("previewColour", () => {
		const cases: [string, unknown, string][] = [
			["a colour expression", 'rgb("#ff9800")', 'rgb("#ff9800")'],
			["one of the two words", "none", "none"],
			["a number, which has no trim", 5, "auto"],
			["a null, which a cleared key can leave", null, "auto"],
			["an object", { r: 1 }, "auto"],
		];

		for (const [description, value, expected] of cases) {
			test(`Should handle ${description}`, () => {
				// The header trims the value, so a value that is not a string throws
				// where nothing catches it, and the panel opens and then stays empty.
				assert.strictEqual(previewColour(value), expected);
			});
		}
	});

	suite("themeKindOf", () => {
		const kinds: [vscode.ColorThemeKind, string][] = [
			[vscode.ColorThemeKind.Light, "light"],
			[vscode.ColorThemeKind.Dark, "dark"],
			[vscode.ColorThemeKind.HighContrast, "high-contrast"],
			[vscode.ColorThemeKind.HighContrastLight, "high-contrast-light"],
		];

		for (const [kind, expected] of kinds) {
			test(`Should map ${expected} onto the pure kind`, () => {
				// `HighContrast` is the dark one and `HighContrastLight` the light one,
				// which is the pairing a mapping written from the names gets wrong.
				assert.strictEqual(themeKindOf(kind), expected);
			});
		}
	});
});
