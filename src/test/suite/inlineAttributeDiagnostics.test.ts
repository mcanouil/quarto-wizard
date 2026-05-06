import * as assert from "assert";
import {
	findSpacesAroundEquals,
	findEmptyValueAssignments,
	findKeyValueOffset,
	findArgumentOffset,
	extractBareWords,
	extractBlocks,
	validateInlineValue,
} from "../../providers/inlineAttributeDiagnosticsProvider";
import type { FieldDescriptor } from "@quarto-wizard/schema";

suite("Inline Attribute Diagnostics", () => {
	suite("findSpacesAroundEquals", () => {
		test('should flag space before and after = in bc = "blue"', () => {
			const results = findSpacesAroundEquals('bc = "blue"');
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0].replacement, "bc=");
		});

		test('should flag space before = in bc ="blue"', () => {
			const results = findSpacesAroundEquals('bc ="blue"');
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0].replacement, "bc=");
		});

		test('should flag space after = in bc= "blue"', () => {
			const results = findSpacesAroundEquals('bc= "blue"');
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0].replacement, "bc=");
		});

		test('should not flag bc="blue" (no spaces)', () => {
			const results = findSpacesAroundEquals('bc="blue"');
			assert.strictEqual(results.length, 0);
		});

		test("should not flag = inside a double-quoted string", () => {
			const results = findSpacesAroundEquals('bc="a = b"');
			assert.strictEqual(results.length, 0);
		});

		test("should not flag = inside a single-quoted string", () => {
			const results = findSpacesAroundEquals("bc='a = b'");
			assert.strictEqual(results.length, 0);
		});

		test("should handle escaped quotes inside strings", () => {
			const results = findSpacesAroundEquals('bc="a \\" = b"');
			assert.strictEqual(results.length, 0);
		});

		test("should flag multiple assignments in one block", () => {
			const results = findSpacesAroundEquals('bc = "blue" fg = "red"');
			assert.strictEqual(results.length, 2);
			assert.strictEqual(results[0].replacement, "bc=");
			assert.strictEqual(results[1].replacement, "fg=");
		});

		test("should flag in shortcode content", () => {
			const results = findSpacesAroundEquals('name bc = "blue"');
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0].replacement, "bc=");
		});

		test("should flag in element attribute content", () => {
			const results = findSpacesAroundEquals('.class bc = "blue"');
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0].replacement, "bc=");
		});

		test("should handle multiple spaces around =", () => {
			const results = findSpacesAroundEquals('bc  =  "blue"');
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0].replacement, "bc=");
		});

		test("should handle hyphenated attribute names", () => {
			const results = findSpacesAroundEquals('border-color = "red"');
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0].replacement, "border-color=");
		});

		test("should return correct offsets", () => {
			const text = 'bc = "blue"';
			const results = findSpacesAroundEquals(text);
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0].start, 0);
			// end should cover up to the start of the value (the quote).
			assert.strictEqual(text.slice(results[0].start, results[0].end), "bc = ");
		});

		test("should not flag = not preceded by an identifier", () => {
			const results = findSpacesAroundEquals('= "blue"');
			assert.strictEqual(results.length, 0);
		});

		test("should handle mixed correct and incorrect assignments", () => {
			const results = findSpacesAroundEquals('a="ok" b = "bad" c="ok"');
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0].replacement, "b=");
		});

		test("should handle unquoted values", () => {
			const results = findSpacesAroundEquals("bc = blue");
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0].replacement, "bc=");
		});
	});

	suite("findKeyValueOffset", () => {
		test("should find quoted value offsets", () => {
			const content = '.class bc="blue" fg="red"';
			const result = findKeyValueOffset(content, "bc");
			assert.notStrictEqual(result, null);
			assert.strictEqual(content.slice(result!.keyStart, result!.keyEnd), "bc");
			assert.strictEqual(content.slice(result!.valueStart, result!.valueEnd), '"blue"');
		});

		test("should find unquoted value offsets", () => {
			const content = ".class bc=blue fg=red";
			const result = findKeyValueOffset(content, "fg");
			assert.notStrictEqual(result, null);
			assert.strictEqual(content.slice(result!.keyStart, result!.keyEnd), "fg");
			assert.strictEqual(content.slice(result!.valueStart, result!.valueEnd), "red");
		});

		test("should return null for missing key", () => {
			const content = '.class bc="blue"';
			const result = findKeyValueOffset(content, "missing");
			assert.strictEqual(result, null);
		});

		test("should handle content with id prefix", () => {
			const content = '#my-id bc="val"';
			const result = findKeyValueOffset(content, "bc");
			assert.notStrictEqual(result, null);
			assert.strictEqual(content.slice(result!.keyStart, result!.keyEnd), "bc");
		});

		test("should handle escaped quotes in values", () => {
			const content = 'bc="val\\"ue"';
			const result = findKeyValueOffset(content, "bc");
			assert.notStrictEqual(result, null);
			assert.strictEqual(content.slice(result!.valueStart, result!.valueEnd), '"val\\"ue"');
		});

		test("should find hyphenated key", () => {
			const content = 'border-color="red"';
			const result = findKeyValueOffset(content, "border-color");
			assert.notStrictEqual(result, null);
			assert.strictEqual(content.slice(result!.keyStart, result!.keyEnd), "border-color");
		});
	});

	suite("findArgumentOffset", () => {
		test("should find correct positional argument offset", () => {
			const content = " mysc arg1 arg2";
			const result = findArgumentOffset(content, 0);
			assert.notStrictEqual(result, null);
			assert.strictEqual(content.slice(result!.start, result!.end), "arg1");
		});

		test("should find second positional argument", () => {
			const content = " mysc arg1 arg2";
			const result = findArgumentOffset(content, 1);
			assert.notStrictEqual(result, null);
			assert.strictEqual(content.slice(result!.start, result!.end), "arg2");
		});

		test("should return null when index out of range", () => {
			const content = " mysc arg1";
			const result = findArgumentOffset(content, 1);
			assert.strictEqual(result, null);
		});

		test("should skip key=value pairs", () => {
			const content = ' mysc key="val" arg1';
			const result = findArgumentOffset(content, 0);
			assert.notStrictEqual(result, null);
			assert.strictEqual(content.slice(result!.start, result!.end), "arg1");
		});

		test("should return null for empty content", () => {
			const result = findArgumentOffset("", 0);
			assert.strictEqual(result, null);
		});

		test("should return null when only shortcode name present", () => {
			const content = " mysc";
			const result = findArgumentOffset(content, 0);
			assert.strictEqual(result, null);
		});
	});

	suite("validateInlineValue", () => {
		test("number type: valid number", () => {
			const descriptor: FieldDescriptor = { type: "number" };
			const findings = validateInlineValue("count", "42", descriptor);
			assert.strictEqual(findings.length, 0);
		});

		test("number type: invalid number", () => {
			const descriptor: FieldDescriptor = { type: "number" };
			const findings = validateInlineValue("count", "abc", descriptor);
			assert.strictEqual(findings.length, 1);
			assert.strictEqual(findings[0].code, "schema-type-mismatch");
			assert.strictEqual(findings[0].severity, "error");
			assert.ok(findings[0].message.includes("string"));
			assert.ok(findings[0].message.includes('"abc"'));
		});

		test("boolean type: valid true", () => {
			const descriptor: FieldDescriptor = { type: "boolean" };
			const findings = validateInlineValue("flag", "true", descriptor);
			assert.strictEqual(findings.length, 0);
		});

		test("boolean type: valid false (case-insensitive)", () => {
			const descriptor: FieldDescriptor = { type: "boolean" };
			const findings = validateInlineValue("flag", "False", descriptor);
			assert.strictEqual(findings.length, 0);
		});

		test("boolean type: invalid value", () => {
			const descriptor: FieldDescriptor = { type: "boolean" };
			const findings = validateInlineValue("flag", "yes", descriptor);
			assert.strictEqual(findings.length, 1);
			assert.strictEqual(findings[0].code, "schema-type-mismatch");
			assert.ok(findings[0].message.includes("string"));
			assert.ok(findings[0].message.includes('"yes"'));
		});

		test("string type: always valid", () => {
			const descriptor: FieldDescriptor = { type: "string" };
			const findings = validateInlineValue("name", "anything", descriptor);
			assert.strictEqual(findings.length, 0);
		});

		test("array type: skipped", () => {
			const descriptor: FieldDescriptor = { type: "array" };
			const findings = validateInlineValue("items", "val", descriptor);
			assert.strictEqual(findings.length, 0);
		});

		test("object type: skipped", () => {
			const descriptor: FieldDescriptor = { type: "object" };
			const findings = validateInlineValue("data", "val", descriptor);
			assert.strictEqual(findings.length, 0);
		});

		test("content type: skipped", () => {
			const descriptor: FieldDescriptor = { type: "content" };
			const findings = validateInlineValue("body", "val", descriptor);
			assert.strictEqual(findings.length, 0);
		});

		test("enum: exact match", () => {
			const descriptor: FieldDescriptor = { enum: ["red", "blue", "green"] };
			const findings = validateInlineValue("color", "blue", descriptor);
			assert.strictEqual(findings.length, 0);
		});

		test("enum: case-insensitive match", () => {
			const descriptor: FieldDescriptor = { enum: ["red", "blue"], enumCaseInsensitive: true };
			const findings = validateInlineValue("color", "RED", descriptor);
			assert.strictEqual(findings.length, 0);
		});

		test("enum: invalid value", () => {
			const descriptor: FieldDescriptor = { enum: ["red", "blue"] };
			const findings = validateInlineValue("color", "purple", descriptor);
			assert.strictEqual(findings.length, 1);
			assert.strictEqual(findings[0].code, "schema-enum-invalid");
		});

		test("min: coerced number below min", () => {
			const descriptor: FieldDescriptor = { type: "number", min: 10 };
			const findings = validateInlineValue("size", "5", descriptor);
			assert.strictEqual(findings.length, 1);
			assert.strictEqual(findings[0].code, "schema-range");
		});

		test("max: coerced number above max", () => {
			const descriptor: FieldDescriptor = { type: "number", max: 100 };
			const findings = validateInlineValue("size", "150", descriptor);
			assert.strictEqual(findings.length, 1);
			assert.strictEqual(findings[0].code, "schema-range");
		});

		test("min/max: value within range", () => {
			const descriptor: FieldDescriptor = { type: "number", min: 0, max: 100 };
			const findings = validateInlineValue("size", "50", descriptor);
			assert.strictEqual(findings.length, 0);
		});

		test("pattern: matching value", () => {
			const descriptor: FieldDescriptor = { pattern: "^[a-z]+$" };
			const findings = validateInlineValue("name", "hello", descriptor);
			assert.strictEqual(findings.length, 0);
		});

		test("pattern: non-matching value", () => {
			const descriptor: FieldDescriptor = { pattern: "^[a-z]+$" };
			const findings = validateInlineValue("name", "Hello123", descriptor);
			assert.strictEqual(findings.length, 1);
			assert.strictEqual(findings[0].code, "schema-pattern");
		});

		test("pattern: exact mode", () => {
			const descriptor: FieldDescriptor = { pattern: "[a-z]+", patternExact: true };
			const findings = validateInlineValue("name", "abc123", descriptor);
			assert.strictEqual(findings.length, 1);
			assert.strictEqual(findings[0].code, "schema-pattern");
		});

		test("pattern: partial match without exact mode", () => {
			const descriptor: FieldDescriptor = { pattern: "[a-z]+" };
			const findings = validateInlineValue("name", "abc123", descriptor);
			assert.strictEqual(findings.length, 0);
		});

		test("minLength: too short", () => {
			const descriptor: FieldDescriptor = { minLength: 5 };
			const findings = validateInlineValue("code", "ab", descriptor);
			assert.strictEqual(findings.length, 1);
			assert.strictEqual(findings[0].code, "schema-length");
		});

		test("maxLength: too long", () => {
			const descriptor: FieldDescriptor = { maxLength: 3 };
			const findings = validateInlineValue("code", "abcde", descriptor);
			assert.strictEqual(findings.length, 1);
			assert.strictEqual(findings[0].code, "schema-length");
		});

		test("minLength/maxLength: within range", () => {
			const descriptor: FieldDescriptor = { minLength: 2, maxLength: 5 };
			const findings = validateInlineValue("code", "abc", descriptor);
			assert.strictEqual(findings.length, 0);
		});

		test("deprecated: boolean true", () => {
			const descriptor: FieldDescriptor = { deprecated: true };
			const findings = validateInlineValue("old", "val", descriptor);
			assert.strictEqual(findings.length, 1);
			assert.strictEqual(findings[0].code, "schema-deprecated");
			assert.strictEqual(findings[0].severity, "warning");
		});

		test("deprecated: string message", () => {
			const descriptor: FieldDescriptor = { deprecated: "use new-attr instead" };
			const findings = validateInlineValue("old", "val", descriptor);
			assert.strictEqual(findings.length, 1);
			assert.strictEqual(findings[0].code, "schema-deprecated");
			assert.ok(findings[0].message.includes("use new-attr instead"));
		});

		test("deprecated: structured spec with replaceWith", () => {
			const descriptor: FieldDescriptor = { deprecated: { replaceWith: "new-attr" } };
			const findings = validateInlineValue("old", "val", descriptor);
			assert.strictEqual(findings.length, 1);
			assert.strictEqual(findings[0].code, "schema-deprecated");
			assert.ok(findings[0].message.includes("new-attr"));
		});

		test("deprecated: structured spec with since and message", () => {
			const descriptor: FieldDescriptor = { deprecated: { since: "2.0", message: "Removed in 3.0." } };
			const findings = validateInlineValue("old", "val", descriptor);
			assert.strictEqual(findings.length, 1);
			assert.ok(findings[0].message.includes("2.0"));
			assert.ok(findings[0].message.includes("Removed in 3.0."));
		});

		test("no descriptor constraints: no findings", () => {
			const descriptor: FieldDescriptor = {};
			const findings = validateInlineValue("attr", "val", descriptor);
			assert.strictEqual(findings.length, 0);
		});

		test("type mismatch short-circuits further checks", () => {
			const descriptor: FieldDescriptor = { type: "number", min: 0, max: 100 };
			const findings = validateInlineValue("count", "abc", descriptor);
			// Should only get the type mismatch, not range errors.
			assert.strictEqual(findings.length, 1);
			assert.strictEqual(findings[0].code, "schema-type-mismatch");
		});

		test("union type [number, boolean]: accepts valid number", () => {
			const descriptor: FieldDescriptor = { type: ["number", "boolean"] };
			const findings = validateInlineValue("val", "42", descriptor);
			assert.strictEqual(findings.length, 0);
		});

		test("union type [number, boolean]: accepts valid boolean", () => {
			const descriptor: FieldDescriptor = { type: ["number", "boolean"] };
			const findings = validateInlineValue("val", "true", descriptor);
			assert.strictEqual(findings.length, 0);
		});

		test("union type [number, boolean]: rejects invalid value", () => {
			const descriptor: FieldDescriptor = { type: ["number", "boolean"] };
			const findings = validateInlineValue("val", "hello", descriptor);
			assert.strictEqual(findings.length, 1);
			assert.strictEqual(findings[0].code, "schema-type-mismatch");
		});

		test("union type [number, array]: validates number component", () => {
			const descriptor: FieldDescriptor = { type: ["number", "array"] };
			const findings = validateInlineValue("val", "42", descriptor);
			assert.strictEqual(findings.length, 0);
		});

		test("union type [number, array]: rejects non-number string", () => {
			const descriptor: FieldDescriptor = { type: ["number", "array"] };
			const findings = validateInlineValue("val", "hello", descriptor);
			assert.strictEqual(findings.length, 1);
			assert.strictEqual(findings[0].code, "schema-type-mismatch");
		});

		test("union type [string, array]: accepts any string", () => {
			const descriptor: FieldDescriptor = { type: ["string", "array"] };
			const findings = validateInlineValue("val", "anything", descriptor);
			assert.strictEqual(findings.length, 0);
		});

		test("union type [boolean, array]: accepts valid boolean", () => {
			const descriptor: FieldDescriptor = { type: ["boolean", "array"] };
			const findings = validateInlineValue("val", "false", descriptor);
			assert.strictEqual(findings.length, 0);
		});

		test("union type [boolean, array]: rejects non-boolean string", () => {
			const descriptor: FieldDescriptor = { type: ["boolean", "array"] };
			const findings = validateInlineValue("val", "hello", descriptor);
			assert.strictEqual(findings.length, 1);
			assert.strictEqual(findings[0].code, "schema-type-mismatch");
		});

		test("pure non-inline union [array, object]: skipped", () => {
			const descriptor: FieldDescriptor = { type: ["array", "object"] };
			const findings = validateInlineValue("val", "anything", descriptor);
			assert.strictEqual(findings.length, 0);
		});

		test("deprecated field with pure non-inline union still warns", () => {
			const descriptor: FieldDescriptor = {
				type: ["array", "object"],
				deprecated: { message: "Use 'items' instead." },
			};
			const findings = validateInlineValue("old", "val", descriptor);
			assert.strictEqual(findings.length, 1);
			assert.strictEqual(findings[0].code, "schema-deprecated");
		});
	});

	suite("findEmptyValueAssignments", () => {
		test("should flag key= at end of content", () => {
			const results = findEmptyValueAssignments("bc=");
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0].key, "bc");
			assert.strictEqual(results[0].replacement, 'bc=""');
		});

		test("should flag key= followed by whitespace", () => {
			const results = findEmptyValueAssignments("bc= ");
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0].key, "bc");
			assert.strictEqual(results[0].replacement, 'bc=""');
		});

		test("should not flag key=value", () => {
			const results = findEmptyValueAssignments('bc="blue"');
			assert.strictEqual(results.length, 0);
		});

		test("should not flag key=unquoted", () => {
			const results = findEmptyValueAssignments("bc=blue");
			assert.strictEqual(results.length, 0);
		});

		test("should flag only trailing key= when intermediate one precedes another token", () => {
			const results = findEmptyValueAssignments("bc= fg=");
			// Only fg= is flagged: bc= is followed by a non-whitespace
			// character after the space, so the forward lookahead treats it
			// as a (possibly spaced) value assignment rather than empty.
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0].key, "fg");
		});

		test("should flag key= followed by only whitespace until end", () => {
			const results = findEmptyValueAssignments("bc=   ");
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0].key, "bc");
		});

		test("should flag key= followed by tab", () => {
			const results = findEmptyValueAssignments("bc=\t");
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0].key, "bc");
		});

		test("should not flag key=<tab>value as empty", () => {
			const results = findEmptyValueAssignments("bc=\tblue");
			assert.strictEqual(results.length, 0);
		});

		test("should flag key<tab>= as empty (tab before =)", () => {
			const results = findEmptyValueAssignments("bc\t=");
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0].key, "bc");
		});

		test("should not flag key<tab>=value as empty", () => {
			const results = findEmptyValueAssignments("bc\t=blue");
			assert.strictEqual(results.length, 0);
		});

		test("should not flag = inside quotes", () => {
			const results = findEmptyValueAssignments('bc="a="');
			assert.strictEqual(results.length, 0);
		});

		test("should handle hyphenated attribute names", () => {
			const results = findEmptyValueAssignments("border-color=");
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0].key, "border-color");
			assert.strictEqual(results[0].replacement, 'border-color=""');
		});

		test("should not flag key= when followed by another token after space", () => {
			// bc= followed by fg="red" is ambiguous (the space before fg
			// is handled by findSpacesAroundEquals instead).
			const results = findEmptyValueAssignments('bc= fg="red"');
			assert.strictEqual(results.length, 0);
		});

		test("should return correct offsets", () => {
			const text = ".class bc=";
			const results = findEmptyValueAssignments(text);
			assert.strictEqual(results.length, 1);
			assert.strictEqual(text.slice(results[0].start, results[0].end), "bc=");
		});

		test("should not flag = not preceded by an identifier", () => {
			const results = findEmptyValueAssignments("=");
			assert.strictEqual(results.length, 0);
		});
	});

	suite("extractBlocks (CRLF)", () => {
		test("should not return blocks from inside a code block with CRLF", () => {
			const text = "---\r\ntitle: Test\r\n---\r\n\r\n```{r}\r\nfunction(x) {\r\n  x + 1\r\n}\r\n```\r\n";
			const blocks = extractBlocks(text);
			// Only the {r} on the fence header should be returned, not the
			// curly braces inside the code body.
			assert.strictEqual(blocks.length, 1);
			assert.strictEqual(blocks[0].content, "r");
		});

		test("should return {r} from fence header with CRLF", () => {
			const text = "text\r\n```{r}\r\ncode\r\n```\r\nmore";
			const blocks = extractBlocks(text);
			assert.strictEqual(blocks.length, 1);
			assert.strictEqual(blocks[0].content, "r");
			assert.strictEqual(blocks[0].type, "element");
		});

		test("should not produce spaces-around-equals findings inside code blocks with CRLF", () => {
			const text = ["---", "title: Test", "---", "", "```{r}", "x = 1", "y = 2", "```", ""].join("\r\n");
			const blocks = extractBlocks(text);
			// Only {r} from the fence header.
			const codeBlocks = blocks.filter((b) => b.content !== "r");
			for (const block of codeBlocks) {
				const findings = findSpacesAroundEquals(block.content);
				assert.strictEqual(findings.length, 0, `Unexpected finding in block content: "${block.content}"`);
			}
		});

		test("should not return blocks from R code with key = value patterns and CRLF", () => {
			const text = [
				"---",
				"title: Example document",
				"---",
				"",
				"```{r}",
				"#| label: example-code",
				"",
				"theme_simulation <- function() {",
				"  theme_minimal() +",
				"    theme(",
				'      axis.text.y = element_text(face = "bold"),',
				"      axis.text.x = element_text(angle = 45, hjust = 1),",
				'      strip.background = element_rect(fill = "#F0F0F0", colour = NA),',
				"    )",
				"}",
				"```",
			].join("\r\n");
			const blocks = extractBlocks(text);
			// Only {r} from the fence header should be extracted.
			assert.strictEqual(blocks.length, 1);
			assert.strictEqual(blocks[0].content, "r");
		});
		test("should not return blocks from inside an indented code block", () => {
			const text = [
				"- demo",
				"",
				'  ```{.r filename="demo.qmd"}',
				"  function(x = 1) {",
				"    x = 1",
				"  }",
				"  ```",
				"",
				"- test",
			].join("\n");
			const blocks = extractBlocks(text);
			// Only {.r filename="demo.qmd"} from the fence header.
			assert.strictEqual(blocks.length, 1);
			assert.ok(blocks[0].content.startsWith(".r"));
		});

		test("should not produce spaces-around-equals findings inside indented code blocks", () => {
			const text = ["- demo", "", "  ```{r}", "  x = 1", "  y = 2", "  ```"].join("\n");
			const blocks = extractBlocks(text);
			const codeBlocks = blocks.filter((b) => b.content !== "r");
			for (const block of codeBlocks) {
				const findings = findSpacesAroundEquals(block.content);
				assert.strictEqual(findings.length, 0, `Unexpected finding in block content: "${block.content}"`);
			}
		});

		test("should not extract blocks from code body when fence info has quoted backticks", () => {
			const text = [
				'```{.r code-summary="Show `theme_brand()` implementation"}',
				"theme_brand <- function() {",
				"  amount = 0.25",
				"}",
				"```",
			].join("\n");
			const blocks = extractBlocks(text);
			// Only the fence header block should be extracted.
			assert.strictEqual(blocks.length, 1);
			assert.ok(blocks[0].content.startsWith(".r"));
		});

		test("should not produce spaces-around-equals findings when fence info has quoted backticks", () => {
			const text = ['```{.r code-summary="Show `theme_brand()` implementation"}', "amount = 0.25", "```"].join("\n");
			const blocks = extractBlocks(text);
			for (const block of blocks) {
				const findings = findSpacesAroundEquals(block.content);
				assert.strictEqual(findings.length, 0, `Unexpected finding in block content: "${block.content}"`);
			}
		});
	});

	suite("extractBlocks (inline code spans)", () => {
		test("should not extract attribute block from inside a single-backtick span", () => {
			const text = 'Pandoc syntax: `{key="value"}` produces an attribute.';
			const blocks = extractBlocks(text);
			assert.strictEqual(blocks.length, 0);
		});

		test("should not extract attribute block with spaces around = inside backticks", () => {
			const text = 'But `{key = "value"}` does not.';
			const blocks = extractBlocks(text);
			assert.strictEqual(blocks.length, 0);
		});

		test("should not produce spaces-around-equals diagnostic for backtick-wrapped {key = value}", () => {
			const text = 'see `{key = "value"}` here';
			const blocks = extractBlocks(text);
			for (const block of blocks) {
				assert.strictEqual(findSpacesAroundEquals(block.content).length, 0);
			}
		});

		test("should still extract a real {=html} attribute on inline code", () => {
			// Pandoc raw inline: `code`{=html} — the {=html} attribute is OUTSIDE
			// the inline code span and is a legitimate attribute block.
			const text = "x `code`{=html} y";
			const blocks = extractBlocks(text);
			assert.strictEqual(blocks.length, 1);
			assert.strictEqual(blocks[0].content, "=html");
		});

		test("should still extract a normal attribute outside any backticks", () => {
			const text = '[span]{.cls key="value"} and `inline {a=b}`';
			const blocks = extractBlocks(text);
			assert.strictEqual(blocks.length, 1);
			assert.strictEqual(blocks[0].content, '.cls key="value"');
		});

		test("should not extract attribute from inside a double-backtick span", () => {
			const text = "before ``contains {key = val} here`` after";
			const blocks = extractBlocks(text);
			assert.strictEqual(blocks.length, 0);
		});
	});

	suite("extractBlocks (YAML front matter)", () => {
		test("should not extract a {...} block from a YAML literal block scalar", () => {
			const text = [
				"---",
				"format: typst",
				"include-before-body:",
				"  - text: |",
				"      #show raw.where(block: false): it => {",
				"        let text = it.text();",
				"        it",
				"      }",
				"---",
				"",
				"body",
			].join("\n");
			const blocks = extractBlocks(text);
			assert.strictEqual(blocks.length, 0);
		});

		test("should not produce spaces-around-equals findings inside YAML front matter", () => {
			const text = [
				"---",
				"format: typst",
				"include-before-body:",
				"  - text: |",
				"      it => {",
				"        let text = it.text();",
				"      }",
				"---",
			].join("\n");
			const blocks = extractBlocks(text);
			for (const block of blocks) {
				assert.strictEqual(findSpacesAroundEquals(block.content).length, 0);
			}
		});

		test("should not extract {a=b} inside a quoted YAML scalar value", () => {
			const text = ["---", 'title: "literal {a = b} text"', "---", ""].join("\n");
			const blocks = extractBlocks(text);
			assert.strictEqual(blocks.length, 0);
		});

		test("should still extract attribute blocks after the closing front matter", () => {
			const text = ["---", "title: Test", "---", "", '[span]{.cls key="value"}'].join("\n");
			const blocks = extractBlocks(text);
			assert.strictEqual(blocks.length, 1);
			assert.strictEqual(blocks[0].content, '.cls key="value"');
		});

		test("should be unaffected when the document has no front matter", () => {
			const text = '[span]{.cls key="value"}';
			const blocks = extractBlocks(text);
			assert.strictEqual(blocks.length, 1);
			assert.strictEqual(blocks[0].content, '.cls key="value"');
		});

		test("should handle CRLF front matter correctly", () => {
			const text = ["---", "format: typst", "include-before-body:", "  - text: |", "      it => { x }", "---", ""].join(
				"\r\n",
			);
			const blocks = extractBlocks(text);
			assert.strictEqual(blocks.length, 0);
		});
	});

	suite("extractBareWords", () => {
		test("should extract bare word from element content", () => {
			const results = extractBareWords(".class myword");
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0].word, "myword");
		});

		test("should not match class prefixes", () => {
			const results = extractBareWords(".class");
			assert.strictEqual(results.length, 0);
		});

		test("should not match id prefixes", () => {
			const results = extractBareWords("#my-id");
			assert.strictEqual(results.length, 0);
		});

		test("should not match key=value pairs", () => {
			const results = extractBareWords('bc="blue"');
			assert.strictEqual(results.length, 0);
		});

		test("should not match key= (empty value)", () => {
			const results = extractBareWords("bc=");
			assert.strictEqual(results.length, 0);
		});

		test("should extract multiple bare words", () => {
			const results = extractBareWords(".class foo bar");
			assert.strictEqual(results.length, 2);
			assert.strictEqual(results[0].word, "foo");
			assert.strictEqual(results[1].word, "bar");
		});

		test("should extract bare word among mixed tokens", () => {
			const results = extractBareWords('.class #id bc="blue" myword');
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0].word, "myword");
		});

		test("should return correct offsets", () => {
			const content = ".class myword";
			const results = extractBareWords(content);
			assert.strictEqual(results.length, 1);
			assert.strictEqual(content.slice(results[0].start, results[0].end), "myword");
		});

		test("should handle empty content", () => {
			const results = extractBareWords("");
			assert.strictEqual(results.length, 0);
		});

		test("should skip quoted strings", () => {
			const results = extractBareWords('"hello" world');
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0].word, "world");
		});

		test("should not treat lone . as class prefix consuming next word", () => {
			const results = extractBareWords(". foo");
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0].word, "foo");
		});

		test("should not treat lone # as id prefix consuming next word", () => {
			const results = extractBareWords("# bar");
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0].word, "bar");
		});

		test("should not emit bare hyphen as a word", () => {
			const results = extractBareWords(".class - foo");
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0].word, "foo");
		});
	});
});
