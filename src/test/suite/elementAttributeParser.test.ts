import * as assert from "assert";
import { getAttributeBounds, parseAttributeAtPosition } from "../../utils/elementAttributeParser";

suite("Element Attribute Parser", () => {
	suite("getAttributeBounds", () => {
		test("should return bounds for a span attribute block", () => {
			const text = '[text]{.highlight ink="blue"}';
			// cursor inside the braces; end is one past the closing }
			const bounds = getAttributeBounds(text, 10);
			assert.ok(bounds);
			assert.strictEqual(bounds.start, 6);
			assert.strictEqual(bounds.end, 29);
			assert.strictEqual(bounds.elementType, "Span");
		});

		test("should return bounds for a div attribute block", () => {
			const text = '::: {.panel bg="red"}\ncontent\n:::';
			const bounds = getAttributeBounds(text, 8);
			assert.ok(bounds);
			assert.strictEqual(bounds.start, 4);
			assert.strictEqual(bounds.end, 21);
			assert.strictEqual(bounds.elementType, "Div");
		});

		test("should return bounds for a code span attribute block", () => {
			const text = "`code`{.python}";
			const bounds = getAttributeBounds(text, 10);
			assert.ok(bounds);
			assert.strictEqual(bounds.start, 6);
			assert.strictEqual(bounds.end, 15);
			assert.strictEqual(bounds.elementType, "Code");
		});

		test("should return bounds with elementType Header for heading", () => {
			const text = "# Heading {.class}";
			const bounds = getAttributeBounds(text, 14);
			assert.ok(bounds);
			assert.strictEqual(bounds.start, 10);
			assert.strictEqual(bounds.end, 18);
			assert.strictEqual(bounds.elementType, "Header");
		});

		test("should detect Header for multi-level headings", () => {
			const text = "## Sub Heading {.class}";
			const bounds = getAttributeBounds(text, 18);
			assert.ok(bounds);
			assert.strictEqual(bounds.elementType, "Header");
		});

		test("should detect Header for level 6 heading", () => {
			const text = "###### Deep {.class}";
			const bounds = getAttributeBounds(text, 16);
			assert.ok(bounds);
			assert.strictEqual(bounds.elementType, "Header");
		});

		test("should return null when cursor is outside attribute block", () => {
			const text = "[text]{.class} after";
			const bounds = getAttributeBounds(text, 16);
			assert.strictEqual(bounds, null);
		});

		test("should return null for plain curly braces not in Pandoc context", () => {
			const text = "some {.class} text";
			const bounds = getAttributeBounds(text, 8);
			assert.strictEqual(bounds, null);
		});

		test("should return null for text without attribute blocks", () => {
			const text = "no attributes here";
			const bounds = getAttributeBounds(text, 5);
			assert.strictEqual(bounds, null);
		});

		test("should handle unclosed attribute block", () => {
			const text = "[text]{.class attr=";
			const bounds = getAttributeBounds(text, 15);
			assert.ok(bounds);
			assert.strictEqual(bounds.start, 6);
		});

		test("should handle div with no space before brace", () => {
			const text = ":::{.panel}";
			const bounds = getAttributeBounds(text, 5);
			assert.ok(bounds);
			assert.strictEqual(bounds.start, 3);
			assert.strictEqual(bounds.end, 11);
			assert.strictEqual(bounds.elementType, "Div");
		});

		test("should handle four colons for div", () => {
			const text = ":::: {.panel}\ncontent\n:::";
			const bounds = getAttributeBounds(text, 8);
			assert.ok(bounds);
			assert.strictEqual(bounds.start, 5);
			assert.strictEqual(bounds.elementType, "Div");
		});

		test("should return bounds for an image link attribute block", () => {
			const text = "![alt](url){.class}";
			const bounds = getAttributeBounds(text, 14);
			assert.ok(bounds);
			assert.strictEqual(bounds.start, 11);
			assert.strictEqual(bounds.end, 19);
			assert.strictEqual(bounds.elementType, "Span");
		});

		test("should return bounds for a link attribute block", () => {
			const text = "[text](url){.class}";
			const bounds = getAttributeBounds(text, 14);
			assert.ok(bounds);
			assert.strictEqual(bounds.start, 11);
			assert.strictEqual(bounds.end, 19);
			assert.strictEqual(bounds.elementType, "Span");
		});
	});

	suite("parseAttributeAtPosition", () => {
		test("should return null when cursor is not in an attribute block", () => {
			const text = "no attributes here";
			const result = parseAttributeAtPosition(text, 5);
			assert.strictEqual(result, null);
		});

		test("should detect attributeKey context when cursor is right after {", () => {
			const text = "[text]{ }";
			const result = parseAttributeAtPosition(text, 7);
			assert.ok(result);
			assert.strictEqual(result.cursorContext, "attributeKey");
		});

		test("should extract a single class", () => {
			const text = "[text]{.highlight }";
			const result = parseAttributeAtPosition(text, 18);
			assert.ok(result);
			assert.deepStrictEqual(result.classes, ["highlight"]);
			assert.strictEqual(result.cursorContext, "attributeKey");
		});

		test("should extract multiple classes", () => {
			const text = "[text]{.highlight .bold }";
			const result = parseAttributeAtPosition(text, 23);
			assert.ok(result);
			assert.deepStrictEqual(result.classes, ["highlight", "bold"]);
		});

		test("should extract an id", () => {
			const text = "[text]{#my-id }";
			const result = parseAttributeAtPosition(text, 14);
			assert.ok(result);
			assert.deepStrictEqual(result.ids, ["my-id"]);
		});

		test("should parse key=value attributes", () => {
			const text = '[text]{.highlight ink="blue" }';
			// Offset 29 is the space before }, so beforeCursor includes the trailing space.
			const result = parseAttributeAtPosition(text, 29);
			assert.ok(result);
			assert.deepStrictEqual(result.classes, ["highlight"]);
			assert.strictEqual(result.attributes["ink"], "blue");
			assert.strictEqual(result.cursorContext, "attributeKey");
		});

		test("should detect attributeValue context after key=", () => {
			const text = "[text]{.highlight ink=}";
			// Offset 22 is the }, so beforeCursor is ".highlight ink=".
			const result = parseAttributeAtPosition(text, 22);
			assert.ok(result);
			assert.strictEqual(result.cursorContext, "attributeValue");
			assert.strictEqual(result.currentAttributeKey, "ink");
		});

		test("should detect attributeKey context when typing a key", () => {
			const text = "[text]{.highlight in}";
			// Offset 20 is the }, so beforeCursor is ".highlight in".
			const result = parseAttributeAtPosition(text, 20);
			assert.ok(result);
			assert.strictEqual(result.cursorContext, "attributeKey");
			assert.strictEqual(result.currentWord, "in");
		});

		test("should handle already-quoted values correctly", () => {
			const text = '[text]{ink="blue" }';
			// Offset 18 is the space before }, so beforeCursor includes trailing space.
			const result = parseAttributeAtPosition(text, 18);
			assert.ok(result);
			assert.strictEqual(result.attributes["ink"], "blue");
			assert.strictEqual(result.cursorContext, "attributeKey");
		});

		test("should handle escaped quotes in values", () => {
			const text = '[text]{ink="bl\\"ue" }';
			// Offset 20 is the space before }, so beforeCursor includes trailing space.
			const result = parseAttributeAtPosition(text, 20);
			assert.ok(result);
			assert.strictEqual(result.attributes["ink"], 'bl"ue');
		});

		test("should parse unquoted attribute values", () => {
			const text = "[text]{ink=blue }";
			// Offset 16 is the space before }, so beforeCursor includes trailing space.
			const result = parseAttributeAtPosition(text, 16);
			assert.ok(result);
			assert.strictEqual(result.attributes["ink"], "blue");
			assert.strictEqual(result.cursorContext, "attributeKey");
		});

		test("should handle multiple attributes", () => {
			const text = '[text]{.highlight ink="blue" bg="red" }';
			// Offset 37 is the space before }, so beforeCursor includes trailing space.
			const result = parseAttributeAtPosition(text, 37);
			assert.ok(result);
			assert.strictEqual(result.attributes["ink"], "blue");
			assert.strictEqual(result.attributes["bg"], "red");
		});

		test("should work with div syntax", () => {
			const text = '::: {.panel bg="red" }\ncontent\n:::';
			// Offset 21 is the space before }, so beforeCursor includes trailing space.
			const result = parseAttributeAtPosition(text, 21);
			assert.ok(result);
			assert.deepStrictEqual(result.classes, ["panel"]);
			assert.strictEqual(result.attributes["bg"], "red");
			assert.strictEqual(result.elementType, "Div");
		});

		test("should work with code span syntax", () => {
			const text = "`code`{.python}";
			const result = parseAttributeAtPosition(text, 14);
			assert.ok(result);
			assert.deepStrictEqual(result.classes, ["python"]);
			assert.strictEqual(result.elementType, "Code");
		});

		test("should include elementType Span for span syntax", () => {
			const text = "[text]{.highlight }";
			const result = parseAttributeAtPosition(text, 18);
			assert.ok(result);
			assert.strictEqual(result.elementType, "Span");
		});

		test("should include elementType Header for heading syntax", () => {
			const text = "# Heading {.class }";
			const result = parseAttributeAtPosition(text, 18);
			assert.ok(result);
			assert.strictEqual(result.elementType, "Header");
			assert.deepStrictEqual(result.classes, ["class"]);
		});

		test("should include elementType Header for h3 heading", () => {
			const text = "### Title {toc-depth=2}";
			// Offset 22 is the }, so beforeCursor is "toc-depth=2".
			const result = parseAttributeAtPosition(text, 22);
			assert.ok(result);
			assert.strictEqual(result.elementType, "Header");
			assert.strictEqual(result.attributes["toc-depth"], "2");
		});

		test("should handle empty attribute block", () => {
			const text = "[text]{}";
			const result = parseAttributeAtPosition(text, 7);
			assert.ok(result);
			assert.strictEqual(result.cursorContext, "attributeKey");
			assert.deepStrictEqual(result.classes, []);
			assert.deepStrictEqual(result.attributes, {});
		});

		test("should parse attributes for image link syntax", () => {
			const text = "![alt](url){.class }";
			const result = parseAttributeAtPosition(text, 19);
			assert.ok(result);
			assert.strictEqual(result.elementType, "Span");
			assert.deepStrictEqual(result.classes, ["class"]);
			assert.strictEqual(result.cursorContext, "attributeKey");
		});

		test("should parse attributes for link syntax", () => {
			const text = "[text](url){.class }";
			const result = parseAttributeAtPosition(text, 19);
			assert.ok(result);
			assert.strictEqual(result.elementType, "Span");
			assert.deepStrictEqual(result.classes, ["class"]);
			assert.strictEqual(result.cursorContext, "attributeKey");
		});

		test("should detect className context for partial class name", () => {
			const text = "[text]{.pan}";
			// Offset 11 is the }, so beforeCursor is ".pan".
			const result = parseAttributeAtPosition(text, 11);
			assert.ok(result);
			assert.strictEqual(result.cursorContext, "className");
			assert.strictEqual(result.currentWord, "pan");
			assert.deepStrictEqual(result.classes, ["pan"]);
		});

		test("should detect className context for bare dot", () => {
			const text = "[text]{.}";
			// Offset 8 is the }, so beforeCursor is ".".
			const result = parseAttributeAtPosition(text, 8);
			assert.ok(result);
			assert.strictEqual(result.cursorContext, "className");
			assert.strictEqual(result.currentWord, "");
			assert.deepStrictEqual(result.classes, [""]);
		});

		test("should detect className context for second class name", () => {
			const text = "[text]{.highlight .pan}";
			// Offset 22 is the }, so beforeCursor is ".highlight .pan".
			const result = parseAttributeAtPosition(text, 22);
			assert.ok(result);
			assert.strictEqual(result.cursorContext, "className");
			assert.strictEqual(result.currentWord, "pan");
			assert.deepStrictEqual(result.classes, ["highlight", "pan"]);
		});

		test("should detect attributeKey context for completed class with trailing space", () => {
			const text = "[text]{.panel }";
			// Offset 14 is the space before }, so beforeCursor is ".panel ".
			const result = parseAttributeAtPosition(text, 14);
			assert.ok(result);
			assert.strictEqual(result.cursorContext, "attributeKey");
			assert.deepStrictEqual(result.classes, ["panel"]);
		});
	});

	suite("code block exclusion", () => {
		test("should still detect {r} in a code fence header", () => {
			const text = "```{r}\nx <- 1\n```";
			// Cursor inside {r}: offset 4 is the 'r'. The fence header is
			// outside the code block body range, so {r} is still a valid Code attribute.
			const bounds = getAttributeBounds(text, 4);
			assert.ok(bounds);
			assert.strictEqual(bounds.elementType, "Code");
		});

		test("should still detect {python} in a code fence header", () => {
			const text = "```{python}\nimport os\n```";
			const bounds = getAttributeBounds(text, 5);
			assert.ok(bounds);
			assert.strictEqual(bounds.elementType, "Code");
		});

		test("should return null for curly braces inside code block body", () => {
			const text = "text\n```{r}\nfunction(x) {\n  x + 1\n}\n```\nafter";
			// Cursor inside the { on the function line.
			const braceOffset = text.indexOf("function(x) {") + 13;
			const bounds = getAttributeBounds(text, braceOffset + 1);
			assert.strictEqual(bounds, null);
		});

		test("should still detect attributes outside code blocks", () => {
			const text = "```{r}\nx <- 1\n```\n\n[text]{.class}";
			const attrOffset = text.indexOf("{.class}") + 2;
			const bounds = getAttributeBounds(text, attrOffset);
			assert.ok(bounds);
			assert.strictEqual(bounds.elementType, "Span");
		});

		test("parseAttributeAtPosition should work on fence headers", () => {
			const text = "```{r}\nx <- 1\n```";
			const result = parseAttributeAtPosition(text, 5);
			assert.ok(result);
			assert.strictEqual(result.elementType, "Code");
		});

		test("parseAttributeAtPosition should return null inside code block body", () => {
			const text = "text\n```{r}\nfunction(x) {\n  x + 1\n}\n```\nafter";
			const braceOffset = text.indexOf("function(x) {") + 13;
			const result = parseAttributeAtPosition(text, braceOffset + 1);
			assert.strictEqual(result, null);
		});

		test("should detect attributes on the line immediately after closing fence", () => {
			const text = "```\ncode\n```\n[text]{.class}";
			const attrOffset = text.indexOf("{.class}") + 2;
			const bounds = getAttributeBounds(text, attrOffset);
			assert.ok(bounds);
			assert.strictEqual(bounds.elementType, "Span");
		});
	});
});
