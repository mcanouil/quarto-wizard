import * as assert from "assert";
import {
	findTypstBlocks,
	blockAtOffset,
	precedingRawBlocks,
	hasLateOptionLine,
	invalidatesPreview,
} from "../../utils/typst/typstBlocks";

/** A minimal document holding one fence with the given info string. */
function fence(info: string): string {
	return "```" + info + "\nx\n```\n";
}

suite("Typst Blocks Test Suite", () => {
	suite("findTypstBlocks classification", () => {
		// The three kinds behave differently and must never be conflated, so
		// every accepted spelling and every rejected one has its own case.
		const cases: [string, string | undefined][] = [
			["typst", "plain"],
			["{.typst}", "plain"],
			['{.typst filename="a.typ"}', "plain"],
			["{=typst}", "raw"],
			["{typst}", "cell"],
			["{{typst}}", undefined],
			["typ", undefined],
			["python", undefined],
		];

		for (const [info, kind] of cases) {
			test(`Should classify \`${info}\` as ${kind ?? "excluded"}`, () => {
				const found = findTypstBlocks(fence(info));
				assert.strictEqual(found[0]?.kind, kind);
			});
		}
	});

	// Each case below is one the module inherits from `getCodeBlockRanges`, and
	// one a second fence scanner would have had to earn again.
	suite("findTypstBlocks body derivation", () => {
		test("Should read a body written with CRLF line endings", () => {
			const found = findTypstBlocks("```typst\r\n#let a = 1\r\n#a\r\n```\r\n");
			assert.strictEqual(found.length, 1);
			assert.strictEqual(found[0].body, "#let a = 1\r\n#a\r\n");
		});

		test("Should remove the fence indent from every body line", () => {
			const found = findTypstBlocks("- item\n\n  ```typst\n  #let a = 1\n  #a\n  ```\n");
			assert.strictEqual(found.length, 1);
			assert.strictEqual(found[0].indent, 2);
			assert.strictEqual(found[0].body, "#let a = 1\n#a\n");
		});

		test("Should ignore a fence indented by four spaces at the top level", () => {
			// Four spaces at the top level is an indented code block, so this is a
			// documented example of a Typst block and not one. Compiling it would
			// run source the author wrote to be read.
			const text = "before\n\n    ```typst\n    #a\n    ```\n";
			assert.deepStrictEqual(findTypstBlocks(text), []);
		});

		test("Should remove the blockquote marker from every body line", () => {
			// Typst is whitespace sensitive and knows nothing about Markdown, so a
			// marker left on a body line is a syntax error in the compiled source.
			const found = findTypstBlocks("> ```typst\n> #let a = 1\n> #a\n> ```\n");
			assert.strictEqual(found.length, 1);
			assert.strictEqual(found[0].body, "#let a = 1\n#a\n");
		});

		test("Should remove the fence indent by column, not by character", () => {
			// The fence is indented by one tab, which is four columns. A body line
			// indented by a tab keeps whatever follows it, so four spaces of Typst
			// indent survive. Counting characters instead would eat the tab and
			// three of those spaces.
			const found = findTypstBlocks("1. Step\n\n\t```typst\n\t    #x\n\t```\n");
			assert.strictEqual(found.length, 1);
			assert.strictEqual(found[0].body, "    #x\n");
		});

		test("Should read a blockquoted cell with its options", () => {
			// The option reader sees the body after the markers are removed, which is
			// the one path where the two rules meet.
			const found = findTypstBlocks("> ```{typst}\n> //| width: 3\n> #x\n> ```\n");
			assert.strictEqual(found.length, 1);
			assert.deepStrictEqual(found[0].options, { width: "3" });
			assert.strictEqual(found[0].code, "#x\n");
		});

		test("Should keep CRLF line endings in a blockquoted block", () => {
			const found = findTypstBlocks("> ```typst\r\n> #a\r\n> ```\r\n");
			assert.strictEqual(found.length, 1);
			assert.strictEqual(found[0].body, "#a\r\n");
		});

		test("Should keep a marker the blockquote itself does not consume", () => {
			// The fence sits one quote deep, so Pandoc hands Typst the body with one
			// marker removed and the second one intact. Removing both would delete a
			// character the author wrote.
			const found = findTypstBlocks("> ```typst\n> > #x\n> ```\n");
			assert.strictEqual(found.length, 1);
			assert.strictEqual(found[0].body, "> #x\n");
		});

		test("Should read an unclosed block to the end of the text", () => {
			const found = findTypstBlocks("```typst\n#let a = 1\n");
			assert.strictEqual(found.length, 1);
			assert.strictEqual(found[0].body, "#let a = 1\n");
		});

		test("Should read an unclosed block whose fence is the last line", () => {
			const found = findTypstBlocks("text\n\n```typst");
			assert.strictEqual(found.length, 1);
			assert.strictEqual(found[0].kind, "plain");
			assert.strictEqual(found[0].body, "");
		});

		test("Should read a fence that starts at offset zero", () => {
			const found = findTypstBlocks("```typst\n#a\n```\n");
			assert.strictEqual(found.length, 1);
			assert.strictEqual(found[0].fenceLine, 0);
			assert.strictEqual(found[0].body, "#a\n");
		});

		test("Should ignore a Typst fence nested in a demonstration block", () => {
			const text = "````markdown\n```{typst}\n#a\n```\n````\n";
			assert.deepStrictEqual(findTypstBlocks(text), []);
		});

		test("Should ignore a fence inside the YAML front matter", () => {
			const text = '---\ntitle: "```typst"\n---\n\n```typst\n#a\n```\n';
			const found = findTypstBlocks(text);
			assert.strictEqual(found.length, 1);
			assert.strictEqual(found[0].body, "#a\n");
		});

		test("Should find a block below a fence line inside the front matter", () => {
			// A block scalar can hold a line that looks like a fence. Scanning the
			// whole document opens a phantom block there, and because that block
			// only closes on a bare fence line it swallows the opening fence of the
			// real block below, which then goes unreported.
			const text = "---\ndescription: |\n  text\n```\n---\n\n```typst\n#a\n```\n";
			const found = findTypstBlocks(text);
			assert.strictEqual(found.length, 1);
			assert.strictEqual(found[0].kind, "plain");
			assert.strictEqual(found[0].body, "#a\n");
		});

		test("Should find a block above a delimiter that opens no front matter", () => {
			// A blank second line means the document has no front matter, so the two
			// `---` lines are thematic breaks. Reading them as delimiters started the
			// scan below the second one and hid the block between them.
			const text = "---\n\n```typst\n#a\n```\n\n---\n";
			const found = findTypstBlocks(text);
			assert.strictEqual(found.length, 1);
			assert.strictEqual(found[0].kind, "plain");
			assert.strictEqual(found[0].body, "#a\n");
		});

		test("Should report offsets and line numbers past the front matter", () => {
			const text = "---\ntitle: t\n---\n\n```typst\n#a\n```\n";
			const found = findTypstBlocks(text);
			assert.strictEqual(found[0].fenceLine, 4);
			assert.strictEqual(text.slice(found[0].fenceStart, found[0].fenceStart + 8), "```typst");
			assert.strictEqual(text.slice(found[0].bodyStart, found[0].bodyEnd), "#a\n```");
		});

		test("Should read a tilde fence and keep a backtick line in its body", () => {
			// A tilde block closes only on tildes, so a backtick line inside it is
			// content. The bare-backtick rule does not apply to a tilde fence either.
			const found = findTypstBlocks("~~~typst\n#a\n```\n#b\n~~~\n");
			assert.strictEqual(found.length, 1);
			assert.strictEqual(found[0].kind, "plain");
			assert.strictEqual(found[0].body, "#a\n```\n#b\n");
		});

		test("Should keep the line endings of a CRLF cell in its code", () => {
			// `body` and `code` describe the same text, so one must not be
			// normalised while the other is not.
			const block = findTypstBlocks("```{typst}\r\n//| a: 1\r\n#x\r\n#y\r\n```\r\n")[0];
			assert.strictEqual(block.code, "#x\r\n#y\r\n");
		});

		test("Should report the fence line of each block", () => {
			const found = findTypstBlocks("intro\n\n```typst\n#a\n```\n\n```{=typst}\n#b\n```\n");
			assert.deepStrictEqual(
				found.map((block) => [block.kind, block.fenceLine]),
				[
					["plain", 2],
					["raw", 6],
				],
			);
		});
	});

	// A bug-compatible port of `_modules/code-cell.lua:84-122`. Each quirk is a
	// quirk of that pattern, so each test names the behaviour and cites the line
	// it ports. An upstream fix to any of them is a breaking change here.
	suite("findTypstBlocks comment-pipe options", () => {
		/** One cell block wrapping the given body. */
		function cell(body: string): string {
			return "```{typst}\n" + body + "\n```\n";
		}

		test("Should read a hyphenated key, which the key pattern allows (:89)", () => {
			assert.deepStrictEqual(findTypstBlocks(cell("//| fig-width: 3\n#a"))[0].options, { "fig-width": "3" });
		});

		test("Should end the run at an underscore key, which the key pattern rejects (:89)", () => {
			const block = findTypstBlocks(cell("//| my_key: v\n//| dpi: 300\n#a"))[0];
			assert.deepStrictEqual(block.options, {});
			assert.strictEqual(block.code, "//| my_key: v\n//| dpi: 300\n#a\n");
		});

		test("Should end the run at an empty value, which needs one character (:89)", () => {
			const block = findTypstBlocks(cell("//| dpi:\n//| width: 3\n#a"))[0];
			assert.deepStrictEqual(block.options, {});
		});

		test("Should read an empty value when a space follows the colon (:89)", () => {
			// The pattern backtracks, so the trailing space alone decides whether
			// the line parses. Verified against the Lua pattern itself.
			assert.deepStrictEqual(findTypstBlocks(cell("//| dpi: \n#a"))[0].options, { dpi: "" });
		});

		test("Should count only the leading run and keep a later option as code (:105-118)", () => {
			const block = findTypstBlocks(cell("//| dpi: 300\n#a\n//| width: 3"))[0];
			assert.deepStrictEqual(block.options, { dpi: "300" });
			assert.strictEqual(block.code, "#a\n//| width: 3\n");
		});

		test("Should read true and false as booleans (:95-98)", () => {
			assert.deepStrictEqual(findTypstBlocks(cell("//| a: true\n//| b: false\n#a"))[0].options, {
				a: true,
				b: false,
			});
		});

		test("Should strip one layer of matching quotes, either style (:100-101)", () => {
			assert.deepStrictEqual(findTypstBlocks(cell("//| a: \"q\"\n//| b: 'q'\n#a"))[0].options, { a: "q", b: "q" });
		});

		test("Should keep every other value as a trimmed string (:102)", () => {
			assert.deepStrictEqual(findTypstBlocks(cell("//| dpi: 300\n//| k:   spaced   \n#a"))[0].options, {
				dpi: "300",
				k: "spaced",
			});
		});

		test("Should allow whitespace around the prefix (:89)", () => {
			assert.deepStrictEqual(findTypstBlocks(cell("  //| a: 1\n//|b: 2\n#a"))[0].options, { a: "1", b: "2" });
		});

		test("Should read every option of a block written with CRLF", () => {
			// A deliberate deviation. Lua splits on `[^\r\n]*`, which yields an
			// empty line between each pair on CRLF, so the run would end after the
			// first option. That is unreachable in a render, because Pandoc does
			// not recognise a fenced block in a CRLF document at all, so matching
			// it here would only break the preview of a file an author can write.
			assert.deepStrictEqual(findTypstBlocks("```{typst}\r\n//| a: 1\r\n//| b: 2\r\n#x\r\n```\r\n")[0].options, {
				a: "1",
				b: "2",
			});
		});

		test("Should parse no options for a plain block and keep the lines verbatim", () => {
			const block = findTypstBlocks("```typst\n//| dpi: 300\n#a\n```\n")[0];
			assert.deepStrictEqual(block.options, {});
			assert.strictEqual(block.code, "//| dpi: 300\n#a\n");
		});

		test("Should parse no options for a raw block and keep the lines verbatim", () => {
			const block = findTypstBlocks("```{=typst}\n//| dpi: 300\n#a\n```\n")[0];
			assert.deepStrictEqual(block.options, {});
			assert.strictEqual(block.code, "//| dpi: 300\n#a\n");
		});
	});

	suite("hasLateOptionLine", () => {
		test("Should report a cell whose option line comes after the code", () => {
			const block = findTypstBlocks("```{typst}\n#a\n//| dpi: 300\n```\n")[0];
			assert.strictEqual(hasLateOptionLine(block), true);
		});

		test("Should not report a cell whose options are all in the leading run", () => {
			const block = findTypstBlocks("```{typst}\n//| dpi: 300\n#a\n```\n")[0];
			assert.strictEqual(hasLateOptionLine(block), false);
		});

		test("Should not report a plain or a raw block", () => {
			// A comment-pipe line is an ordinary Typst comment in both, so there is
			// nothing to warn about.
			const text = "```typst\n#a\n//| dpi: 300\n```\n\n```{=typst}\n#b\n//| dpi: 300\n```\n";
			for (const block of findTypstBlocks(text)) {
				assert.strictEqual(hasLateOptionLine(block), false, block.kind);
			}
		});

		test("Should not report a late line written without a space after the colon", () => {
			// The Lua guard at `:110` ends with a colon and one whitespace, while
			// the key pattern at `:89` does not, so upstream passes over this line
			// in silence. The port keeps that difference.
			const block = findTypstBlocks("```{typst}\n#a\n//| dpi:300\n```\n")[0];
			assert.strictEqual(hasLateOptionLine(block), false);
		});
	});

	suite("blockAtOffset", () => {
		const text = "intro\n\n```typst\n#a\n```\n\ntext\n\n```{=typst}\n#b\n```\n";
		const blocks = findTypstBlocks(text);

		test("Should find the block holding an offset inside a body", () => {
			assert.strictEqual(blockAtOffset(blocks, text.indexOf("#a"))?.kind, "plain");
			assert.strictEqual(blockAtOffset(blocks, text.indexOf("#b"))?.kind, "raw");
		});

		test("Should find the block when the cursor sits on its opening fence", () => {
			// A reader who puts the cursor on the fence means that block, and the
			// body range starts after the fence line, so the fence needs its own case.
			assert.strictEqual(blockAtOffset(blocks, text.indexOf("```typst"))?.kind, "plain");
		});

		test("Should find nothing outside every block", () => {
			assert.strictEqual(blockAtOffset(blocks, 0), undefined);
			assert.strictEqual(blockAtOffset(blocks, text.indexOf("text")), undefined);
		});
	});

	suite("precedingRawBlocks", () => {
		test("Should return every earlier raw block in document order", () => {
			const text = "```{=typst}\n#let a = 1\n```\n\n```{=typst}\n#let b = 2\n```\n\n```{=typst}\n#a\n```\n";
			const blocks = findTypstBlocks(text);
			assert.deepStrictEqual(
				precedingRawBlocks(blocks, blocks[2]).map((block) => block.code),
				["#let a = 1\n", "#let b = 2\n"],
			);
		});

		test("Should exclude a cell and a plain block sitting between raw blocks", () => {
			// Only a raw block reaches the Typst output, so only a raw block can
			// put a binding in scope for a later one.
			const text = "```{=typst}\n#let a = 1\n```\n\n```{typst}\n#x\n```\n\n```typst\n#y\n```\n\n```{=typst}\n#a\n```\n";
			const blocks = findTypstBlocks(text);
			const target = blocks[blocks.length - 1];
			assert.deepStrictEqual(
				precedingRawBlocks(blocks, target).map((block) => block.code),
				["#let a = 1\n"],
			);
		});

		test("Should return nothing when the target is the first raw block", () => {
			const blocks = findTypstBlocks("```{=typst}\n#a\n```\n");
			assert.deepStrictEqual(precedingRawBlocks(blocks, blocks[0]), []);
		});
	});

	suite("invalidatesPreview", () => {
		// A raw block, then prose, then a plain block and a second raw block, so
		// every case has something above it and something below it.
		const text = [
			"```{=typst}",
			"#let a = 1",
			"```",
			"",
			"prose",
			"",
			"```typst",
			"#circle()",
			"```",
			"",
			"```{=typst}",
			"#a",
			"```",
			"",
		].join("\n");
		const [firstRaw, plain, secondRaw] = findTypstBlocks(text);

		/** A one character insertion at an offset. */
		function insertion(offset: number): { rangeOffset: number; rangeLength: number } {
			return { rangeOffset: offset, rangeLength: 0 };
		}

		test("Should invalidate a plain block changed inside its body", () => {
			assert.strictEqual(invalidatesPreview(plain, insertion(text.indexOf("#circle"))), true);
		});

		test("Should invalidate a plain block changed on its opening fence", () => {
			// The info string decides the kind, so editing the fence can stop the
			// block being a Typst block at all.
			assert.strictEqual(invalidatesPreview(plain, insertion(plain.fenceStart)), true);
		});

		test("Should leave a plain block alone when the change is above it", () => {
			// A plain block is compiled on its own, so nothing outside it changes
			// what it renders.
			assert.strictEqual(invalidatesPreview(plain, insertion(text.indexOf("prose"))), false);
		});

		test("Should invalidate a raw block changed anywhere above it", () => {
			// A raw block compiles with every raw block before it, so a change above
			// it can bind, rebind or remove a name it uses.
			assert.strictEqual(invalidatesPreview(secondRaw, insertion(text.indexOf("#let"))), true);
		});

		test("Should invalidate a raw block when a change above it is not in a block", () => {
			// Prose is where a new fence is typed, and that new block would sit
			// above the target.
			assert.strictEqual(invalidatesPreview(secondRaw, insertion(text.indexOf("prose"))), true);
		});

		test("Should leave a raw block alone when the change is below it", () => {
			assert.strictEqual(invalidatesPreview(firstRaw, insertion(text.indexOf("prose"))), false);
		});

		test("Should invalidate a plain block changed on its closing fence", () => {
			// The body ends where the closing fence starts, so an edit exactly at
			// that offset removes or moves the end of the block.
			assert.strictEqual(invalidatesPreview(plain, insertion(plain.bodyEnd)), true);
		});

		test("Should invalidate a block a deletion reaches from above", () => {
			// The change starts outside the block and ends inside it, so testing its
			// start offset alone would miss it.
			const start = text.indexOf("prose");
			assert.strictEqual(
				invalidatesPreview(plain, { rangeOffset: start, rangeLength: text.indexOf("#circle") - start }),
				true,
			);
		});
	});
});
