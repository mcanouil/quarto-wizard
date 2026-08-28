import * as assert from "assert";
import { findTypstBlocks } from "../../utils/typst/typstBlocks";
import { buildPlainSource, buildRawSource } from "../../utils/typst/typstSource";

/** The page setup a preview injects above every block. */
const HEADER = "#set page(width: auto, height: auto, margin: 0.5em)";

/**
 * A raw block binding a name, a cell between the two, and a raw block using
 * that name.
 *
 * The three fences are deliberately of three different kinds, because the
 * accumulation rule is about kinds and not about position.
 */
const CHAIN = [
	"```{=typst}",
	"#let accent = red",
	"```",
	"",
	"Some prose.",
	"",
	"```{typst}",
	"//| width: 10cm",
	"#square()",
	"```",
	"",
	"```{=typst}",
	"#text(fill: accent)[Hello]",
	"```",
	"",
].join("\n");

suite("Typst Source Test Suite", () => {
	suite("buildPlainSource", () => {
		test("Should put the header above the body", () => {
			const blocks = findTypstBlocks("```typst\n#circle()\n```\n");
			assert.deepStrictEqual(buildPlainSource(blocks[0], HEADER), {
				source: `${HEADER}\n#circle()\n`,
				injectedLines: 1,
			});
		});

		test("Should inject nothing when the header is empty", () => {
			// An empty header must not push the body down by a line, or every
			// diagnostic would point one line too far.
			const blocks = findTypstBlocks("```typst\n#circle()\n```\n");
			assert.deepStrictEqual(buildPlainSource(blocks[0], ""), { source: "#circle()\n", injectedLines: 0 });
		});
	});

	suite("buildRawSource", () => {
		test("Should put every preceding raw block above the target, in document order", () => {
			// A raw block is passed through into the document's Typst context, so a
			// name bound by an earlier one is in scope for a later one. Compiled
			// alone, the target below fails on an unknown variable.
			const blocks = findTypstBlocks(CHAIN);
			assert.strictEqual(
				buildRawSource(blocks, blocks[2], HEADER).source,
				`${HEADER}\n#let accent = red\n#text(fill: accent)[Hello]\n`,
			);
		});

		test("Should leave a cell sitting between two raw blocks out of the source", () => {
			// The filter compiles a cell to an image of its own, so nothing it
			// contains reaches the Typst context of the raw blocks around it.
			const blocks = findTypstBlocks(CHAIN);
			assert.ok(!buildRawSource(blocks, blocks[2], HEADER).source.includes("#square()"));
		});

		test("Should count the header and every prepended body as injected lines", () => {
			// A diagnostic reports a position in the assembled source, so the count
			// is what maps it back to a line of the target block.
			const blocks = findTypstBlocks(CHAIN);
			assert.strictEqual(buildRawSource(blocks, blocks[2], HEADER).injectedLines, 2);
		});

		test("Should compile the first raw block of a document on its own", () => {
			const blocks = findTypstBlocks(CHAIN);
			assert.deepStrictEqual(buildRawSource(blocks, blocks[0], HEADER), {
				source: `${HEADER}\n#let accent = red\n`,
				injectedLines: 1,
			});
		});

		test("Should keep a comment-pipe line inside a raw block as code", () => {
			// Only a cell carries options. In a raw block the same spelling is an
			// ordinary Typst comment, and dropping it would change the source.
			const text = "```{=typst}\n//| width: 10cm\n#circle()\n```\n";
			const blocks = findTypstBlocks(text);
			assert.strictEqual(buildRawSource(blocks, blocks[0], HEADER).source, `${HEADER}\n//| width: 10cm\n#circle()\n`);
		});

		test("Should separate two bodies that do not end with a line ending", () => {
			// The closing fence of an unclosed block never arrives, so the last body
			// line has no line ending of its own and would otherwise be glued to the
			// first line of the target.
			const text = "```{=typst}\n#let a = 1\n```\n\n```{=typst}\n#a";
			const blocks = findTypstBlocks(text);
			assert.strictEqual(buildRawSource(blocks, blocks[1], "").source, "#let a = 1\n#a");
		});
	});
});
