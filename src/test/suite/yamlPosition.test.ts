import * as assert from "assert";
import {
	getCodeBlockRanges,
	findFencedBlocks,
	getInlineCodeSpanRanges,
	getYamlFrontMatterRange,
	isInCodeBlockRange,
	hasUnquotedBacktick,
} from "../../utils/yamlPosition";

suite("YAML Position Utils Test Suite", () => {
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

		test("should recognise backtick fence when backticks are inside double-quoted info string", () => {
			const text = '```{.r code-summary="Show `theme_brand()` implementation"}\namount = 0.25\n```';
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 1);
			assert.ok(text.slice(ranges[0].start, ranges[0].end).includes("amount = 0.25"));
		});

		test("should recognise backtick fence when backticks are inside single-quoted info string", () => {
			const text = "```{.r code-summary='Show `x` usage'}\ncode here\n```";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 1);
			assert.ok(text.slice(ranges[0].start, ranges[0].end).includes("code here"));
		});

		test("should reject backtick fence with backticks both inside and outside quotes", () => {
			// The first line has a bare backtick outside quotes so it is not a valid fence.
			const text = '```{.r code-summary="Show `x`"} `bare\ncontent';
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 0);
		});

		test("should detect a backtick-fenced code block with CRLF line endings", () => {
			const text = "before\r\n```\r\ncode\r\n```\r\nafter";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 1);
			// Range includes trailing \r on the closing fence line.
			assert.strictEqual(text.slice(ranges[0].start, ranges[0].end), "code\r\n```\r");
		});

		test("should exclude opening fence header with info string and CRLF", () => {
			const text = "text\r\n```{r}\r\nx <- 1\r\n```\r\nmore";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 1);
			// The {r} header is NOT inside the range.
			assert.strictEqual(text.slice(ranges[0].start, ranges[0].end), "x <- 1\r\n```\r");
		});

		test("should cover curly-brace content inside code block body with CRLF", () => {
			const text = "text\r\n```{r}\r\nfunction(x) {\r\n  x + 1\r\n}\r\n```\r\nafter";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 1);
			const block = text.slice(ranges[0].start, ranges[0].end);
			assert.ok(block.includes("function(x) {"));
			assert.ok(block.includes("}"));
			assert.ok(!block.includes("```{r}"));
		});

		test("should handle multiple code blocks with CRLF", () => {
			const text = "a\r\n```\r\nb\r\n```\r\nc\r\n~~~\r\nd\r\n~~~\r\ne";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 2);
		});

		test("should detect indented fenced code block (2-space indent)", () => {
			const text = "- item\n\n  ```{r}\n  x = 1\n  ```\n";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 1);
			const body = text.substring(ranges[0].start, ranges[0].end);
			assert.ok(body.includes("x = 1"));
		});

		test("should detect indented fenced code block (4-space indent)", () => {
			const text = "- item\n\n    ```{r}\n    x = 1\n    ```\n";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 1);
			const body = text.substring(ranges[0].start, ranges[0].end);
			assert.ok(body.includes("x = 1"));
		});

		test("should detect indented tilde-fenced code block", () => {
			const text = "- item\n\n  ~~~python\n  x = 1\n  ~~~\n";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 1);
			const body = text.substring(ranges[0].start, ranges[0].end);
			assert.ok(body.includes("x = 1"));
		});

		test("should detect indented fenced code block with CRLF", () => {
			const text = "- item\r\n\r\n  ```{r}\r\n  x = 1\r\n  ```\r\n";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 1);
			const body = text.substring(ranges[0].start, ranges[0].end);
			assert.ok(body.includes("x = 1"));
		});

		test("should not treat a four-space indented fence at the top level as a fence", () => {
			// Four spaces at the top level is an indented code block, so the fence is
			// literal text. Treating it as live is how a documented example of a
			// fence ends up linted, and compiled, as if it were code.
			const text = "before\n\n    ```{r}\n    x = 1\n    ```\n\nafter";
			assert.deepStrictEqual(getCodeBlockRanges(text), []);
		});

		test("should detect a three-space indented fence at the top level", () => {
			const text = "before\n\n   ```{r}\n   x = 1\n   ```\n";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 1);
			assert.ok(text.substring(ranges[0].start, ranges[0].end).includes("x = 1"));
		});

		test("should detect a four-space indented fence inside an ordered list item", () => {
			// `1. ` opens an item whose content starts at column three, so a fence at
			// column four is indented by one relative to the item and is live. This
			// is the ordinary shape of a Quarto document, so the indent limit is
			// measured against the open item and not against the document.
			const text = "1. Step one\n\n    ```{r}\n    x = 1\n    ```\n";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 1);
			assert.ok(text.substring(ranges[0].start, ranges[0].end).includes("x = 1"));
		});

		test("should stop allowing the list indent after the list ends", () => {
			const text = "- item\n\nback at the margin\n\n    ```{r}\n    x = 1\n    ```\n";
			assert.deepStrictEqual(getCodeBlockRanges(text), []);
		});

		test("should detect a fenced code block inside a blockquote", () => {
			// Pandoc reads this as a real code block, and every reader built on this
			// function used to skip it entirely.
			const text = "> ```{r}\n> x <- 1\n> ```\nafter";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 1);
			assert.strictEqual(text.slice(ranges[0].start, ranges[0].end), "> x <- 1\n> ```");
		});

		test("should detect a fenced code block inside a nested blockquote", () => {
			const text = "> > ~~~python\n> > x = 1\n> > ~~~\n";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 1);
			assert.strictEqual(text.slice(ranges[0].start, ranges[0].end), "> > x = 1\n> > ~~~");
		});

		test("should not close a top-level block on a quoted fence line", () => {
			// Inside a fenced block every line is content, and container parsing does
			// not resume until the block closes. Stripping the marker first and then
			// testing for a closing fence closes the block on its own content.
			const text = "```\n> ```\nstill code\n```\nafter";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 1);
			assert.ok(text.slice(ranges[0].start, ranges[0].end).includes("still code"));
		});

		test("should not close a quoted block on a more deeply quoted fence line", () => {
			const text = "> ```\n> > ```\n> still code\n> ```\n";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 1);
			assert.ok(text.slice(ranges[0].start, ranges[0].end).includes("still code"));
		});

		test("should detect a blockquoted fence with CRLF line endings", () => {
			const text = "> ```{r}\r\n> x <- 1\r\n> ```\r\n";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 1);
			assert.strictEqual(text.slice(ranges[0].start, ranges[0].end), "> x <- 1\r\n> ```\r");
		});

		test("should detect a tab-indented fence inside a list item", () => {
			// A tab advances to the next multiple of four, so this fence sits at
			// column four, one past the content column of `1. `. It is live, and
			// losing it is the failure direction this reader is meant to avoid.
			const text = "1. Step one\n\n\t```{r}\n\tx = 1\n\t```\n";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 1);
			assert.ok(text.substring(ranges[0].start, ranges[0].end).includes("x = 1"));
		});

		test("should open a container for a list item with nothing on its line", () => {
			// `1.` alone is a valid empty item, and its content starts one column
			// past the marker. Reading it as ordinary prose drops the allowance and
			// loses the fence indented under it.
			const text = "1.\n\n    ```{r}\n    x = 1\n    ```\n";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 1);
			assert.ok(text.substring(ranges[0].start, ranges[0].end).includes("x = 1"));
		});

		test("should open a container for an empty item with trailing whitespace", () => {
			// An editor leaves a space after the marker as a matter of course, so
			// this shape is at least as common as the bare marker.
			const text = "1. \n\n    ```{r}\n    x = 1\n    ```\n";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 1);
			assert.ok(text.substring(ranges[0].start, ranges[0].end).includes("x = 1"));
		});

		test("should keep the list indent across a lazy continuation line", () => {
			// The second line continues the paragraph of the item, so the item is
			// still open and the fence under it is live. Reading the continuation as
			// a new block at the margin closes the item and loses the fence.
			const text = "1. Step\ncontinuation\n\n    ```{r}\n    x = 1\n    ```\n";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 1);
			assert.ok(text.substring(ranges[0].start, ranges[0].end).includes("x = 1"));
		});

		test("should open a container for a list item written with a tab", () => {
			const text = "-\titem\n\n    ```{r}\n    x = 1\n    ```\n";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 1);
			assert.ok(text.substring(ranges[0].start, ranges[0].end).includes("x = 1"));
		});

		test("should not treat a tab-indented fence at the top level as a fence", () => {
			const text = "before\n\n\t```{r}\n\tx = 1\n\t```\n";
			assert.deepStrictEqual(getCodeBlockRanges(text), []);
		});

		test("should end a blockquoted block where the quote ends", () => {
			// A line without the marker ends the blockquote, and the code block goes
			// with it. Lazy continuation applies to a paragraph and not to the
			// content of a code block.
			const text = "> ```\n> code\nafter\n";
			const ranges = getCodeBlockRanges(text);
			assert.strictEqual(ranges.length, 1);
			assert.strictEqual(text.slice(ranges[0].start, ranges[0].end), "> code");
		});
	});

	suite("findFencedBlocks", () => {
		test("should report the indent, the fence run and the info string of a plain fence", () => {
			const text = "before\n```{r}\nx <- 1\n```\nafter";
			const found = findFencedBlocks(text);
			assert.strictEqual(found.length, 1);
			assert.strictEqual(found[0].indent, 0);
			assert.strictEqual(found[0].fence, "```");
			assert.strictEqual(found[0].info, "{r}");
			assert.strictEqual(found[0].quoteDepth, 0);
			assert.strictEqual(found[0].fenceLine, 1);
			assert.strictEqual(text.slice(found[0].fenceStart, found[0].start), "```{r}\n");
			assert.strictEqual(text.slice(found[0].start, found[0].end), "x <- 1\n```");
		});

		test("should report the whole run of a tilde fence", () => {
			// The run decides which lines close the block, so a reader that keeps it
			// does not have to match the fence a second time.
			const text = "~~~~{=typst}\n#x\n~~~~\n";
			const found = findFencedBlocks(text);
			assert.strictEqual(found.length, 1);
			assert.strictEqual(found[0].fence, "~~~~");
			assert.strictEqual(found[0].info, "{=typst}");
			assert.strictEqual(found[0].fenceLine, 0);
			assert.strictEqual(found[0].fenceStart, 0);
		});

		test("should report the indent of a fence inside a list item", () => {
			const text = "1. Step\n\n   ```python\n   x = 1\n   ```\n";
			const found = findFencedBlocks(text);
			assert.strictEqual(found.length, 1);
			assert.strictEqual(found[0].indent, 3);
			assert.strictEqual(found[0].info, "python");
			assert.strictEqual(found[0].fenceLine, 2);
		});

		test("should report the indent of a tab-indented fence in columns", () => {
			// A tab advances to the next multiple of four, so the fence owns four
			// columns and not one character.
			const text = "1. Step one\n\n\t```{r}\n\tx = 1\n\t```\n";
			const found = findFencedBlocks(text);
			assert.strictEqual(found.length, 1);
			assert.strictEqual(found[0].indent, 4);
		});

		test("should report how many blockquote markers the fence line carries", () => {
			// A reader that de-indents the body needs the marker count as well as the
			// indent, because both are structure rather than content.
			const text = "> > ~~~python\n> > x = 1\n> > ~~~\n";
			const found = findFencedBlocks(text);
			assert.strictEqual(found.length, 1);
			assert.strictEqual(found[0].quoteDepth, 2);
			assert.strictEqual(found[0].indent, 0);
			assert.strictEqual(found[0].info, "python");
		});

		test("should read a tab-indented fence inside a blockquote", () => {
			// The marker `> ` takes two columns, so the tab advances from column two
			// to column four and gives the fence two columns of indent. Counting the
			// tab from the start of the quoted content charges it four, which is one
			// past the limit, and the block is lost.
			const text = "> \t```{r}\n> \tx <- 1\n> \t```\n";
			const found = findFencedBlocks(text);
			assert.strictEqual(found.length, 1);
			assert.strictEqual(found[0].indent, 2);
			assert.strictEqual(found[0].info, "{r}");
			assert.strictEqual(found[0].quoteDepth, 1);
		});

		test("should give the marker one column of a tab that follows it", () => {
			// CommonMark grants the blockquote marker one column of the tab after
			// `>`. The rest is content, so the fence carries two columns of indent
			// here as well.
			const text = ">\t```{r}\n>\tx <- 1\n>\t```\n";
			const found = findFencedBlocks(text);
			assert.strictEqual(found.length, 1);
			assert.strictEqual(found[0].indent, 2);
			assert.strictEqual(found[0].info, "{r}");
		});

		test("should report the fence line of an unclosed block that ends the text", () => {
			const text = "before\n```typst";
			const found = findFencedBlocks(text);
			assert.strictEqual(found.length, 1);
			assert.strictEqual(found[0].fenceStart, text.indexOf("```typst"));
			assert.strictEqual(found[0].fenceLine, 1);
			assert.strictEqual(found[0].start, text.length);
			assert.strictEqual(found[0].end, text.length);
		});

		test("should give getCodeBlockRanges the same offsets it reports itself", () => {
			const text = "```\na\n```\nbetween\n\n> ```{r}\n> b\n> ```\n";
			assert.deepStrictEqual(
				getCodeBlockRanges(text).map((range) => [range.start, range.end]),
				findFencedBlocks(text).map((block) => [block.start, block.end]),
			);
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

		test("should return true for offset inside code block body with CRLF", () => {
			const text = "before\r\n```\r\ncode\r\n```\r\nafter";
			const ranges = getCodeBlockRanges(text);
			// "code" starts after "before\r\n```\r\n" = 13 chars.
			const codeOffset = text.indexOf("code");
			assert.strictEqual(isInCodeBlockRange(ranges, codeOffset), true);
		});

		test("should return false for {r} on fence header with CRLF", () => {
			const text = "text\r\n```{r}\r\nx <- 1\r\n```\r\nmore";
			const ranges = getCodeBlockRanges(text);
			const braceOffset = text.indexOf("{r}");
			assert.strictEqual(isInCodeBlockRange(ranges, braceOffset), false);
		});

		test("should return true for curly braces inside code body with CRLF", () => {
			const text = "text\r\n```{r}\r\nfunction(x) {\r\n  x + 1\r\n}\r\n```\r\nafter";
			const ranges = getCodeBlockRanges(text);
			const innerBrace = text.indexOf("function(x) {") + "function(x) ".length;
			assert.strictEqual(isInCodeBlockRange(ranges, innerBrace), true);
		});
	});

	suite("getInlineCodeSpanRanges", () => {
		test("should detect a single-backtick inline code span", () => {
			const text = "before `code` after";
			const ranges = getInlineCodeSpanRanges(text, []);
			assert.strictEqual(ranges.length, 1);
			assert.strictEqual(text.slice(ranges[0].start, ranges[0].end), "`code`");
		});

		test("should cover a curly-brace attribute block inside backticks", () => {
			const text = 'see `{key = "value"}` here';
			const ranges = getInlineCodeSpanRanges(text, []);
			assert.strictEqual(ranges.length, 1);
			const braceStart = text.indexOf("{");
			assert.ok(braceStart >= ranges[0].start && braceStart < ranges[0].end);
		});

		test("should require matching backtick run length", () => {
			// Single backtick start cannot close on a double-backtick run.
			const text = "a `one`` not closed";
			const ranges = getInlineCodeSpanRanges(text, []);
			assert.strictEqual(ranges.length, 0);
		});

		test("should allow single backticks inside a double-backtick span", () => {
			const text = "a ``has ` inside`` end";
			const ranges = getInlineCodeSpanRanges(text, []);
			assert.strictEqual(ranges.length, 1);
			assert.strictEqual(text.slice(ranges[0].start, ranges[0].end), "``has ` inside``");
		});

		test("should leave a {...} after the closing backticks outside the range", () => {
			// Pandoc inline code with attribute: `code`{=html}
			const text = "x `code`{=html} y";
			const ranges = getInlineCodeSpanRanges(text, []);
			assert.strictEqual(ranges.length, 1);
			const attrStart = text.indexOf("{=html}");
			assert.ok(attrStart >= ranges[0].end);
		});

		test("should return empty array for unclosed backtick run", () => {
			const text = "no closer `here";
			const ranges = getInlineCodeSpanRanges(text, []);
			assert.strictEqual(ranges.length, 0);
		});

		test("should skip backticks inside fenced code block ranges", () => {
			const text = "```\n`x`\n```\n`y`";
			const fenced = getCodeBlockRanges(text);
			const ranges = getInlineCodeSpanRanges(text, fenced);
			assert.strictEqual(ranges.length, 1);
			assert.strictEqual(text.slice(ranges[0].start, ranges[0].end), "`y`");
		});

		test("should return empty array for text with no backticks", () => {
			assert.deepStrictEqual(getInlineCodeSpanRanges("plain text", []), []);
		});

		test("should detect multiple inline code spans", () => {
			const text = "`a` and `b` and `c`";
			const ranges = getInlineCodeSpanRanges(text, []);
			assert.strictEqual(ranges.length, 3);
		});
	});

	suite("getYamlFrontMatterRange", () => {
		test("should cover the opening, body, and closing delimiter lines", () => {
			const text = "---\ntitle: Test\n---\nbody\n";
			const range = getYamlFrontMatterRange(text);
			assert.ok(range);
			assert.strictEqual(range!.start, 0);
			assert.strictEqual(text.slice(range!.start, range!.end), "---\ntitle: Test\n---");
		});

		test("should return undefined when line 0 is not a fence", () => {
			const text = "no front matter here\n---\nfoo\n---\n";
			assert.strictEqual(getYamlFrontMatterRange(text), undefined);
		});

		test("should return undefined when there is no closing fence", () => {
			const text = "---\ntitle: Test\nbody\n";
			assert.strictEqual(getYamlFrontMatterRange(text), undefined);
		});

		test("should return undefined when the second line closes the block", () => {
			const text = "---\n---\nbody\n";
			assert.strictEqual(getYamlFrontMatterRange(text), undefined);
		});

		test("should return undefined when the second line is blank", () => {
			const text = "---\n\n---\nbody\n";
			assert.strictEqual(getYamlFrontMatterRange(text), undefined);
		});

		test("should return undefined for a two line document", () => {
			const text = "---\ntitle: Test";
			assert.strictEqual(getYamlFrontMatterRange(text), undefined);
		});

		test("should return undefined when a CRLF second line is blank", () => {
			// The guard reads the second line through `trim`, which removes the
			// carriage return, so a CRLF document follows the same rule.
			const text = "---\r\n\r\n---\r\nbody\r\n";
			assert.strictEqual(getYamlFrontMatterRange(text), undefined);
		});

		test("should return undefined when a CRLF second line closes the block", () => {
			const text = "---\r\n---\r\nbody\r\n";
			assert.strictEqual(getYamlFrontMatterRange(text), undefined);
		});

		test("should return undefined for empty text", () => {
			assert.strictEqual(getYamlFrontMatterRange(""), undefined);
		});

		test("should handle CRLF line endings", () => {
			const text = "---\r\ntitle: Test\r\n---\r\nbody\r\n";
			const range = getYamlFrontMatterRange(text);
			assert.ok(range);
			assert.strictEqual(range!.start, 0);
			assert.strictEqual(text.slice(range!.start, range!.end), "---\r\ntitle: Test\r\n---\r");
		});

		test("should cover multi-line block scalars within the front matter", () => {
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
				"body",
			].join("\n");
			const range = getYamlFrontMatterRange(text);
			assert.ok(range);
			const closingFenceOffset = text.lastIndexOf("---");
			assert.ok(closingFenceOffset >= range!.start && closingFenceOffset < range!.end);
		});
	});

	suite("hasUnquotedBacktick", () => {
		test("should return false for empty string", () => {
			assert.strictEqual(hasUnquotedBacktick(""), false);
		});

		test("should return true for bare backtick", () => {
			assert.strictEqual(hasUnquotedBacktick("foo`bar"), true);
		});

		test("should return false when backtick is inside double quotes", () => {
			assert.strictEqual(hasUnquotedBacktick('{.r code-summary="Show `theme_brand()` implementation"}'), false);
		});

		test("should return false when backtick is inside single quotes", () => {
			assert.strictEqual(hasUnquotedBacktick("{.r code-summary='Show `theme_brand()` implementation'}"), false);
		});

		test("should return true when backtick is outside quotes even if some are inside", () => {
			assert.strictEqual(hasUnquotedBacktick('{.r code-summary="Show `x`"} `bare'), true);
		});

		test("should return false when no backticks are present", () => {
			assert.strictEqual(hasUnquotedBacktick('{.r code-summary="no ticks"}'), false);
		});

		test("should return false for backtick inside double quotes only", () => {
			assert.strictEqual(hasUnquotedBacktick('"`"'), false);
		});

		test("should return false for backtick inside single quotes only", () => {
			assert.strictEqual(hasUnquotedBacktick("'`'"), false);
		});
	});
});
