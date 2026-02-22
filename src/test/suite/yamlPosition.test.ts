import * as assert from "assert";
import {
	getYamlKeyPath,
	isInYamlRegion,
	getYamlIndentLevel,
	getExistingKeysAtPath,
	getCodeBlockRanges,
	isInCodeBlockRange,
} from "../../utils/yamlPosition";

suite("YAML Position Utils Test Suite", () => {
	suite("getYamlIndentLevel", () => {
		test("Should return 0 for unindented lines", () => {
			assert.strictEqual(getYamlIndentLevel("key: value"), 0);
		});

		test("Should return 2 for two-space indentation", () => {
			assert.strictEqual(getYamlIndentLevel("  key: value"), 2);
		});

		test("Should return 4 for four-space indentation", () => {
			assert.strictEqual(getYamlIndentLevel("    key: value"), 4);
		});

		test("Should return 0 for empty string", () => {
			assert.strictEqual(getYamlIndentLevel(""), 0);
		});

		test("Should count only leading spaces", () => {
			assert.strictEqual(getYamlIndentLevel("  key:  value  "), 2);
		});
	});

	suite("isInYamlRegion", () => {
		test("Should return true for any line in a YAML document", () => {
			const lines = ["key: value", "other: stuff"];
			assert.strictEqual(isInYamlRegion(lines, 0, "yaml"), true);
			assert.strictEqual(isInYamlRegion(lines, 1, "yaml"), true);
		});

		test("Should return true inside QMD front-matter", () => {
			const lines = ["---", "title: Test", "format: html", "---", "Body text"];
			assert.strictEqual(isInYamlRegion(lines, 1, "quarto"), true);
			assert.strictEqual(isInYamlRegion(lines, 2, "quarto"), true);
		});

		test("Should return false outside QMD front-matter", () => {
			const lines = ["---", "title: Test", "---", "Body text"];
			assert.strictEqual(isInYamlRegion(lines, 0, "quarto"), false);
			assert.strictEqual(isInYamlRegion(lines, 3, "quarto"), false);
		});

		test("Should return false on the delimiter lines themselves", () => {
			const lines = ["---", "title: Test", "---", "Body text"];
			assert.strictEqual(isInYamlRegion(lines, 0, "quarto"), false);
			assert.strictEqual(isInYamlRegion(lines, 2, "quarto"), false);
		});

		test("Should return false when no closing delimiter exists", () => {
			const lines = ["---", "title: Test", "Body text"];
			assert.strictEqual(isInYamlRegion(lines, 1, "quarto"), false);
		});

		test("Should return false when no delimiters exist at all", () => {
			const lines = ["Some text", "More text"];
			assert.strictEqual(isInYamlRegion(lines, 0, "quarto"), false);
		});
	});

	suite("getYamlKeyPath", () => {
		test("Should return empty array outside YAML region", () => {
			const lines = ["---", "title: Test", "---", "Body text"];
			const result = getYamlKeyPath(lines, 3, "quarto");
			assert.deepStrictEqual(result, []);
		});

		test("Should return single key at top level", () => {
			const lines = ["title: Test"];
			const result = getYamlKeyPath(lines, 0, "yaml");
			assert.deepStrictEqual(result, ["title"]);
		});

		test("Should return nested key path", () => {
			const lines = ["extensions:", "  modal:", "    size: large"];
			const result = getYamlKeyPath(lines, 2, "yaml");
			assert.deepStrictEqual(result, ["extensions", "modal", "size"]);
		});

		test("Should handle sibling keys correctly", () => {
			const lines = ["extensions:", "  modal:", "    size: large", "    colour: red"];
			const result = getYamlKeyPath(lines, 3, "yaml");
			assert.deepStrictEqual(result, ["extensions", "modal", "colour"]);
		});

		test("Should handle returning to parent level", () => {
			const lines = ["extensions:", "  modal:", "    size: large", "format:", "  html:", "    theme: cosmo"];
			const result = getYamlKeyPath(lines, 5, "yaml");
			assert.deepStrictEqual(result, ["format", "html", "theme"]);
		});

		test("Should skip blank lines", () => {
			const lines = ["extensions:", "", "  modal:", "", "    size: large"];
			const result = getYamlKeyPath(lines, 4, "yaml");
			assert.deepStrictEqual(result, ["extensions", "modal", "size"]);
		});

		test("Should skip comment lines", () => {
			const lines = ["extensions:", "  # This is a comment", "  modal:", "    size: large"];
			const result = getYamlKeyPath(lines, 3, "yaml");
			assert.deepStrictEqual(result, ["extensions", "modal", "size"]);
		});

		test("Should handle list items", () => {
			const lines = ["items:", "  - name: first", "  - name: second"];
			const result = getYamlKeyPath(lines, 1, "yaml");
			assert.deepStrictEqual(result, ["items", "name"]);
		});

		test("Should handle QMD front-matter with --- delimiters", () => {
			const lines = ["---", "title: My Document", "extensions:", "  modal:", "    size: large", "---", "# Body"];
			const result = getYamlKeyPath(lines, 4, "quarto");
			assert.deepStrictEqual(result, ["extensions", "modal", "size"]);
		});

		test("Should return parent path for a key-only line (no value)", () => {
			const lines = ["extensions:", "  modal:"];
			const result = getYamlKeyPath(lines, 1, "yaml");
			assert.deepStrictEqual(result, ["extensions", "modal"]);
		});

		test("Should handle deeply nested structures", () => {
			const lines = ["extensions:", "  modal:", "    style:", "      background:", "        colour: blue"];
			const result = getYamlKeyPath(lines, 4, "yaml");
			assert.deepStrictEqual(result, ["extensions", "modal", "style", "background", "colour"]);
		});

		test("Should handle multiple top-level keys", () => {
			const lines = ["title: Test", "author: Me", "format: html"];
			assert.deepStrictEqual(getYamlKeyPath(lines, 0, "yaml"), ["title"]);
			assert.deepStrictEqual(getYamlKeyPath(lines, 1, "yaml"), ["author"]);
			assert.deepStrictEqual(getYamlKeyPath(lines, 2, "yaml"), ["format"]);
		});

		suite("cursorIndent parameter", () => {
			test("Should trim path to match cursor indent 4 (child of iconify)", () => {
				const lines = ["extensions:", "  iconify:", "    "];
				const result = getYamlKeyPath(lines, 2, "yaml", 4);
				assert.deepStrictEqual(result, ["extensions", "iconify"]);
			});

			test("Should trim path to match cursor indent 2 (sibling of iconify)", () => {
				const lines = ["extensions:", "  iconify:", "  "];
				const result = getYamlKeyPath(lines, 2, "yaml", 2);
				assert.deepStrictEqual(result, ["extensions"]);
			});

			test("Should trim path to match cursor indent 0 (root level)", () => {
				const lines = ["extensions:", "  iconify:", ""];
				const result = getYamlKeyPath(lines, 2, "yaml", 0);
				assert.deepStrictEqual(result, []);
			});

			test("Should not affect non-blank lines", () => {
				const lines = ["extensions:", "  iconify:", "    size: large"];
				const result = getYamlKeyPath(lines, 2, "yaml", 0);
				assert.deepStrictEqual(result, ["extensions", "iconify", "size"]);
			});

			test("Should behave normally without cursorIndent", () => {
				const lines = ["extensions:", "  iconify:", "    "];
				const result = getYamlKeyPath(lines, 2, "yaml");
				assert.deepStrictEqual(result, ["extensions", "iconify"]);
			});
		});
	});

	suite("getExistingKeysAtPath", () => {
		test("Should return root-level keys from a plain YAML document", () => {
			const lines = ["title: Test", "author: Me", "format: html"];
			const result = getExistingKeysAtPath(lines, [], "yaml");
			assert.deepStrictEqual(result, new Set(["title", "author", "format"]));
		});

		test("Should return child keys under a specific parent path", () => {
			const lines = ["extensions:", "  modal:", "    size: large", "    colour: red"];
			const result = getExistingKeysAtPath(lines, ["extensions", "modal"], "yaml");
			assert.deepStrictEqual(result, new Set(["size", "colour"]));
		});

		test("Should return children at the correct nesting depth (skips grandchildren)", () => {
			const lines = ["extensions:", "  modal:", "    style:", "      background: blue", "    size: large"];
			const result = getExistingKeysAtPath(lines, ["extensions", "modal"], "yaml");
			assert.deepStrictEqual(result, new Set(["style", "size"]));
		});

		test("Should handle .qmd front matter (skips --- delimiter)", () => {
			const lines = ["---", "title: Test", "author: Me", "---", "Body text"];
			const result = getExistingKeysAtPath(lines, [], "quarto");
			assert.deepStrictEqual(result, new Set(["title", "author"]));
		});

		test("Should return empty set when the parent path does not exist", () => {
			const lines = ["extensions:", "  modal:", "    size: large"];
			const result = getExistingKeysAtPath(lines, ["extensions", "nonexistent"], "yaml");
			assert.deepStrictEqual(result, new Set());
		});

		test("Should ignore comments and blank lines", () => {
			const lines = ["extensions:", "  # A comment", "", "  modal:", "  iconify:"];
			const result = getExistingKeysAtPath(lines, ["extensions"], "yaml");
			assert.deepStrictEqual(result, new Set(["modal", "iconify"]));
		});

		test("Should return first-level children under extensions:", () => {
			const lines = ["extensions:", "  modal:", "    size: large", "  iconify:", "    version: 2"];
			const result = getExistingKeysAtPath(lines, ["extensions"], "yaml");
			assert.deepStrictEqual(result, new Set(["modal", "iconify"]));
		});

		test("Should stop collecting at a shallower indent", () => {
			const lines = ["extensions:", "  modal:", "    size: large", "format:", "  html:"];
			const result = getExistingKeysAtPath(lines, ["extensions", "modal"], "yaml");
			assert.deepStrictEqual(result, new Set(["size"]));
		});

		test("Should find a segment that appears after other siblings at the same level", () => {
			const lines = ["extensions:", "  other:", "    x: 1", "  another:", "    y: 2", "  modal:", "    size: large"];
			const result = getExistingKeysAtPath(lines, ["extensions", "modal"], "yaml");
			assert.deepStrictEqual(result, new Set(["size"]));
		});
	});

	suite("getCodeBlockRanges", () => {
		test("should detect a backtick-fenced code block body", () => {
			const text = "before\n```\ncode\n```\nafter";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 1);
			// Range excludes the opening fence line but includes body and closing fence.
			assert.strictEqual(text.slice(ranges[0].start, ranges[0].end), "code\n```");
		});

		test("should detect a tilde-fenced code block body", () => {
			const text = "before\n~~~\ncode\n~~~\nafter";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 1);
			assert.strictEqual(text.slice(ranges[0].start, ranges[0].end), "code\n~~~");
		});

		test("should exclude opening fence header with info strings", () => {
			const text = "text\n```{r}\nx <- 1\n```\nmore";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 1);
			// The {r} header is NOT inside the range.
			assert.strictEqual(text.slice(ranges[0].start, ranges[0].end), "x <- 1\n```");
		});

		test("should exclude python fence header", () => {
			const text = "text\n```{python}\nimport os\n```\nmore";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 1);
			assert.strictEqual(text.slice(ranges[0].start, ranges[0].end), "import os\n```");
		});

		test("should handle unclosed code blocks extending to end of text", () => {
			const text = "before\n```\ncode without closing";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 1);
			// Starts after the opening fence line.
			assert.strictEqual(ranges[0].start, 11);
			assert.strictEqual(ranges[0].end, text.length);
		});

		test("should handle multiple code blocks", () => {
			const text = "a\n```\nb\n```\nc\n~~~\nd\n~~~\ne";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 2);
		});

		test("should return empty array for text without code blocks", () => {
			const text = "no code blocks here\njust text";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 0);
		});

		test("should cover curly-brace content inside code block body", () => {
			const text = "text\n```{r}\nfunction(x) {\n  x + 1\n}\n```\nafter";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 1);
			// The body (with curly braces) is inside the range.
			const block = text.slice(ranges[0].start, ranges[0].end);
			assert.ok(block.includes("function(x) {"));
			assert.ok(block.includes("}"));
			// But the opening fence header is NOT.
			assert.ok(!block.includes("```{r}"));
		});

		test("should require closing fence to have at least the same length", () => {
			const text = "````\ncode\n```\nstill in block\n````\nafter";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 1);
			// ``` is not enough to close ````; only ```` closes it.
			const block = text.slice(ranges[0].start, ranges[0].end);
			assert.ok(block.includes("still in block"));
		});

		test("should handle code block with language info string", () => {
			const text = "```javascript\nconsole.log('hi');\n```";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 1);
			// Opening fence header excluded from range.
			const block = text.slice(ranges[0].start, ranges[0].end);
			assert.ok(!block.includes("javascript"));
			assert.ok(block.includes("console.log"));
		});

		test("should leave fence header outside range so {r} gets completions", () => {
			const text = "```{r}\nx <- 1\n```";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 1);
			// Offset of '{' in ```{r} is 3; it should NOT be in any range.
			assert.strictEqual(isInCodeBlockRange(ranges, 3), false);
			// Offset of 'x' on the body line should be in the range.
			assert.strictEqual(isInCodeBlockRange(ranges, text.indexOf("x <")), true);
		});

		test("should return empty array for empty string", () => {
			assert.deepStrictEqual(getCodeBlockRanges(""), []);
		});

		test("should handle document that is entirely a code block", () => {
			const text = "```\ncode\n```";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 1);
			assert.strictEqual(text.slice(ranges[0].start, ranges[0].end), "code\n```");
		});

		test("should handle consecutive code blocks with no gap", () => {
			const text = "```\na\n```\n```\nb\n```";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 2);
			assert.strictEqual(text.slice(ranges[0].start, ranges[0].end), "a\n```");
			assert.strictEqual(text.slice(ranges[1].start, ranges[1].end), "b\n```");
		});

		test("should handle tilde fence with info string", () => {
			const text = "~~~python\nprint('hi')\n~~~";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 1);
			assert.strictEqual(text.slice(ranges[0].start, ranges[0].end), "print('hi')\n~~~");
		});

		test("should handle empty code block (no body lines)", () => {
			const text = "```\n```";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 1);
			assert.strictEqual(text.slice(ranges[0].start, ranges[0].end), "```");
		});

		test("should not treat backtick fence with backticks in info string as a fence", () => {
			// Per CommonMark, backtick fences whose info string contains backticks
			// are not valid opening fences. Here neither line is a valid opening fence.
			const text = "```foo`bar\ncontent\n```baz`qux";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 0);
		});
	});

	suite("isInCodeBlockRange", () => {
		test("should return true for offset inside the code block body", () => {
			const text = "before\n```\ncode\n```\nafter";
			const ranges = getCodeBlockRanges(text);
			// "code" starts at offset 11.
			assert.strictEqual(isInCodeBlockRange(ranges, 11), true);
		});

		test("should return false for offset on the opening fence line", () => {
			const text = "before\n```\ncode\n```\nafter";
			const ranges = getCodeBlockRanges(text);
			// Offset 7 is the first backtick of the opening fence.
			assert.strictEqual(isInCodeBlockRange(ranges, 7), false);
		});

		test("should return true for offset on the closing fence line", () => {
			const text = "before\n```\ncode\n```\nafter";
			const ranges = getCodeBlockRanges(text);
			// Offset 16 is the first backtick of the closing fence.
			assert.strictEqual(isInCodeBlockRange(ranges, 16), true);
		});

		test("should return false for offset at code block end (exclusive)", () => {
			const text = "before\n```\ncode\n```\nafter";
			const ranges = getCodeBlockRanges(text);
			// The block end is exclusive.
			assert.strictEqual(isInCodeBlockRange(ranges, ranges[0].end), false);
		});

		test("should return false for offset before code block", () => {
			const text = "before\n```\ncode\n```\nafter";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(isInCodeBlockRange(ranges, 0), false);
		});

		test("should return false for offset after code block", () => {
			const text = "before\n```\ncode\n```\nafter";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(isInCodeBlockRange(ranges, text.length - 1), false);
		});

		test("should return false with empty ranges", () => {
			assert.strictEqual(isInCodeBlockRange([], 5), false);
		});

		test("should return false for offset between two code block ranges", () => {
			const text = "```\na\n```\nbetween\n```\nb\n```";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 2);
			// "between" is at offset 10.
			assert.strictEqual(isInCodeBlockRange(ranges, 10), false);
		});

		test("should return true at exact range start", () => {
			const text = "```\ncode\n```";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(isInCodeBlockRange(ranges, ranges[0].start), true);
		});

		test("should return true at range end minus one", () => {
			const text = "```\ncode\n```";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(isInCodeBlockRange(ranges, ranges[0].end - 1), true);
		});
	});
});
