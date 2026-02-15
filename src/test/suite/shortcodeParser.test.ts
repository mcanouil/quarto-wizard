import * as assert from "assert";
import { parseShortcodeAtPosition, isInsideShortcode, getShortcodeBounds } from "../../utils/shortcodeParser";

suite("Shortcode Parser", () => {
	suite("getShortcodeBounds", () => {
		test("should return bounds for a simple shortcode", () => {
			const text = "{{< mysc >}}";
			const bounds = getShortcodeBounds(text, 5);
			assert.ok(bounds);
			assert.strictEqual(bounds.start, 0);
			assert.strictEqual(bounds.end, 12);
		});

		test("should return null when cursor is outside shortcode", () => {
			const text = "before {{< mysc >}} after";
			const bounds = getShortcodeBounds(text, 2);
			assert.strictEqual(bounds, null);
		});

		test("should return null for text without shortcodes", () => {
			const text = "no shortcodes here";
			const bounds = getShortcodeBounds(text, 5);
			assert.strictEqual(bounds, null);
		});

		test("should handle unclosed shortcodes", () => {
			const text = "{{< mysc ";
			const bounds = getShortcodeBounds(text, 5);
			assert.ok(bounds);
			assert.strictEqual(bounds.start, 0);
		});

		test("should handle cursor at the opening delimiter", () => {
			const text = "{{< mysc >}}";
			const bounds = getShortcodeBounds(text, 3);
			assert.ok(bounds);
			assert.strictEqual(bounds.start, 0);
		});

		test("should handle cursor at the closing delimiter", () => {
			const text = "{{< mysc >}}";
			const bounds = getShortcodeBounds(text, 12);
			assert.ok(bounds);
			assert.strictEqual(bounds.start, 0);
			assert.strictEqual(bounds.end, 12);
		});

		test("should handle multiple shortcodes and pick the correct one", () => {
			const text = "{{< first >}} some text {{< second >}}";
			const bounds = getShortcodeBounds(text, 30);
			assert.ok(bounds);
			assert.strictEqual(bounds.start, 24);
			assert.strictEqual(bounds.end, 38);
		});
	});

	suite("isInsideShortcode", () => {
		test("should return true inside a shortcode", () => {
			const text = "{{< mysc >}}";
			assert.strictEqual(isInsideShortcode(text, 5), true);
		});

		test("should return false outside a shortcode", () => {
			const text = "before {{< mysc >}} after";
			assert.strictEqual(isInsideShortcode(text, 2), false);
		});

		test("should return false for plain text", () => {
			const text = "no shortcodes";
			assert.strictEqual(isInsideShortcode(text, 3), false);
		});
	});

	suite("parseShortcodeAtPosition", () => {
		test("should return null when cursor is not in a shortcode", () => {
			const text = "no shortcodes";
			const result = parseShortcodeAtPosition(text, 3);
			assert.strictEqual(result, null);
		});

		test("should detect name context when cursor is right after {{<", () => {
			const text = "{{< >}}";
			const result = parseShortcodeAtPosition(text, 4);
			assert.ok(result);
			assert.strictEqual(result.cursorContext, "name");
			assert.strictEqual(result.name, null);
		});

		test("should detect name context when typing a shortcode name", () => {
			const text = "{{< my >}}";
			const result = parseShortcodeAtPosition(text, 6);
			assert.ok(result);
			assert.strictEqual(result.cursorContext, "name");
			assert.strictEqual(result.name, "my");
		});

		test("should detect attributeKey context after name and space", () => {
			const text = "{{< mysc  >}}";
			const result = parseShortcodeAtPosition(text, 9);
			assert.ok(result);
			assert.strictEqual(result.cursorContext, "attributeKey");
			assert.strictEqual(result.name, "mysc");
		});

		test("should detect attributeKey context when typing an attribute name", () => {
			const text = "{{< mysc ke >}}";
			const result = parseShortcodeAtPosition(text, 11);
			assert.ok(result);
			assert.strictEqual(result.cursorContext, "attributeKey");
			assert.strictEqual(result.name, "mysc");
		});

		test("should detect attributeValue context after key=", () => {
			const text = "{{< mysc key= >}}";
			const result = parseShortcodeAtPosition(text, 14);
			assert.ok(result);
			assert.strictEqual(result.cursorContext, "attributeValue");
			assert.strictEqual(result.name, "mysc");
			assert.strictEqual(result.currentAttributeKey, "key");
		});

		test("should parse completed key=value attributes", () => {
			const text = '{{< mysc key="value"  >}}';
			const result = parseShortcodeAtPosition(text, 21);
			assert.ok(result);
			assert.strictEqual(result.cursorContext, "attributeKey");
			assert.strictEqual(result.name, "mysc");
			assert.strictEqual(result.attributes["key"], "value");
		});

		test("should parse unquoted attribute values", () => {
			const text = "{{< mysc key=val  >}}";
			const result = parseShortcodeAtPosition(text, 17);
			assert.ok(result);
			assert.strictEqual(result.cursorContext, "attributeKey");
			assert.strictEqual(result.attributes["key"], "val");
		});

		test("should handle multiple attributes", () => {
			const text = '{{< mysc a="1" b="2"  >}}';
			const result = parseShortcodeAtPosition(text, 21);
			assert.ok(result);
			assert.strictEqual(result.attributes["a"], "1");
			assert.strictEqual(result.attributes["b"], "2");
		});

		test("should handle positional arguments before named attributes", () => {
			const text = '{{< mysc arg1 key="val"  >}}';
			const result = parseShortcodeAtPosition(text, 24);
			assert.ok(result);
			assert.deepStrictEqual(result.arguments, ["arg1"]);
			assert.strictEqual(result.attributes["key"], "val");
		});

		test("should handle empty shortcode", () => {
			const text = "{{<  >}}";
			const result = parseShortcodeAtPosition(text, 4);
			assert.ok(result);
			assert.strictEqual(result.cursorContext, "name");
			assert.strictEqual(result.name, null);
		});

		test("should handle shortcode with only name", () => {
			const text = "{{< mysc >}}";
			const result = parseShortcodeAtPosition(text, 8);
			assert.ok(result);
			assert.strictEqual(result.name, "mysc");
		});

		test("should handle escaped quotes in attribute values", () => {
			const text = '{{< mysc key="val\\"ue"  >}}';
			const result = parseShortcodeAtPosition(text, 23);
			assert.ok(result);
			assert.strictEqual(result.attributes["key"], 'val"ue');
		});

		test("should handle multiline shortcode content", () => {
			const text = '{{< mysc\n  key="value"\n>}}';
			const result = parseShortcodeAtPosition(text, 22);
			assert.ok(result);
			assert.strictEqual(result.name, "mysc");
			assert.strictEqual(result.attributes["key"], "value");
		});

		test("should handle cursor right at the start of content", () => {
			const text = "{{< >}}";
			const result = parseShortcodeAtPosition(text, 3);
			assert.ok(result);
			assert.strictEqual(result.cursorContext, "name");
		});

		test("should handle shortcode surrounded by other text", () => {
			const text = "Some text {{< mysc >}} more text";
			const result = parseShortcodeAtPosition(text, 18);
			assert.ok(result);
			assert.strictEqual(result.name, "mysc");
		});

		test("should detect attributeValue context for key=partial_value", () => {
			const text = "{{< mysc key=va >}}";
			const result = parseShortcodeAtPosition(text, 15);
			assert.ok(result);
			assert.strictEqual(result.cursorContext, "attributeValue");
			assert.strictEqual(result.currentAttributeKey, "key");
		});
	});
});
