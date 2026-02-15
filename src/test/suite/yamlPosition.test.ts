import * as assert from "assert";
import { getYamlKeyPath, isInYamlRegion, getYamlIndentLevel } from "../../utils/yamlPosition";

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
	});
});
