import * as assert from "assert";
import {
	getYamlKeyPath,
	isInYamlRegion,
	getYamlIndentLevel,
	getExistingKeysAtPath,
	shouldRetriggerSuggest,
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

	suite("shouldRetriggerSuggest", () => {
		test("Should return true for root-level blank line in YAML", () => {
			const lines = [""];
			assert.strictEqual(shouldRetriggerSuggest(lines, 0, 0, "yaml"), true);
		});

		test("Should return false under title: in YAML", () => {
			const lines = ["title: My title"];
			assert.strictEqual(shouldRetriggerSuggest(lines, 0, 15, "yaml"), false);
		});

		test("Should return true under extensions: in YAML", () => {
			const lines = ["extensions:", "  modal:"];
			assert.strictEqual(shouldRetriggerSuggest(lines, 1, 8, "yaml"), true);
		});

		test("Should return true under format: in YAML", () => {
			const lines = ["format:", "  html:"];
			assert.strictEqual(shouldRetriggerSuggest(lines, 1, 7, "yaml"), true);
		});

		test("Should return true under extensions.modal.size: in YAML", () => {
			const lines = ["extensions:", "  modal:", "    size: large"];
			assert.strictEqual(shouldRetriggerSuggest(lines, 2, 15, "yaml"), true);
		});

		test("Should return false under bibliography: in YAML", () => {
			const lines = ["bibliography: refs.bib"];
			assert.strictEqual(shouldRetriggerSuggest(lines, 0, 22, "yaml"), false);
		});

		test("Should return false under title: in QMD front matter", () => {
			const lines = ["---", "title: My doc", "---", "Body text"];
			assert.strictEqual(shouldRetriggerSuggest(lines, 1, 13, "quarto"), false);
		});

		test("Should return true under extensions: in QMD front matter", () => {
			const lines = ["---", "extensions:", "  modal:", "---", "Body text"];
			assert.strictEqual(shouldRetriggerSuggest(lines, 2, 8, "quarto"), true);
		});

		test("Should return false outside QMD front matter", () => {
			const lines = ["---", "title: Test", "---", "Body text"];
			assert.strictEqual(shouldRetriggerSuggest(lines, 3, 5, "quarto"), false);
		});

		test("Should return false when not in YAML region", () => {
			const lines = ["Some text", "More text"];
			assert.strictEqual(shouldRetriggerSuggest(lines, 0, 5, "quarto"), false);
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
});
