import * as assert from "assert";
import { findTypstBlocks } from "../../utils/typst/typstBlocks";
import { buildPlainSource, buildRawSource, themeHeader, type TypstThemeKind } from "../../utils/typst/typstSource";

/** The page setup a preview injects above every block. */
const HEADER = "#set page(width: auto, height: auto, margin: 0.5em)";

/** The whole header as one string, which is what the builders take. */
function header(kind: TypstThemeKind, foreground: string, background: string): string {
	return themeHeader(kind, foreground, background).lines.join("\n");
}

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

		test("Should add nothing for an empty raw block above the target", () => {
			// An empty body has no line to contribute, so counting it would push
			// every diagnostic of the target down by one.
			const text = "```{=typst}\n```\n\n```{=typst}\n#circle()\n```\n";
			const blocks = findTypstBlocks(text);
			assert.deepStrictEqual(buildRawSource(blocks, blocks[1], HEADER), {
				source: `${HEADER}\n#circle()\n`,
				injectedLines: 1,
			});
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

	suite("themeHeader", () => {
		test("Should size the page to the block and keep a margin", () => {
			// A block is a fragment and not a document, so the page shrinks to it.
			// The margin is not decoration: on a `width: auto` page the glyphs of the
			// outermost characters clip at the edge of the viewBox without it.
			const { lines } = themeHeader("dark", "none", "none");
			assert.deepStrictEqual(lines, ["#set page(width: auto, height: auto, margin: 0.5em)"]);
		});

		const kinds: [TypstThemeKind, string][] = [
			["light", "#3b3b3b"],
			["dark", "#cccccc"],
			["high-contrast", "#ffffff"],
			["high-contrast-light", "#292929"],
		];

		for (const [kind, colour] of kinds) {
			test(`Should give a ${kind} theme its own text colour`, () => {
				// The extension host cannot read a theme colour value, so the kind is
				// all there is to derive one from.
				const { lines, foreground } = themeHeader(kind, "auto", "none");
				assert.strictEqual(foreground, `rgb("${colour}")`);
				assert.strictEqual(lines[1], `#set text(fill: rgb("${colour}"))`);
			});
		}

		test("Should write no text line when the foreground is none", () => {
			// This is what lets an author who sets the colour inside the block keep
			// the preview out of it entirely.
			const { lines, foreground } = themeHeader("dark", "none", "auto");
			assert.strictEqual(lines.length, 1);
			assert.strictEqual(foreground, "");
		});

		test("Should pass a Typst colour expression through unchanged", () => {
			// The value is Typst source and not a colour this module understands, so
			// anything that is neither `auto` nor `none` is written as it is.
			const { lines, foreground } = themeHeader("dark", "luma(80%)", "rgb(30, 30, 30)");
			assert.strictEqual(foreground, "luma(80%)");
			assert.deepStrictEqual(lines, [
				"#set page(width: auto, height: auto, margin: 0.5em, fill: rgb(30, 30, 30))",
				"#set text(fill: luma(80%))",
			]);
		});

		test("Should leave the page transparent when the background is auto", () => {
			// The surface behind the image already carries the editor background and
			// follows a theme change with no recompile, so the page stays out of it.
			const { lines } = themeHeader("dark", "none", "auto");
			assert.deepStrictEqual(lines, ["#set page(width: auto, height: auto, margin: 0.5em, fill: none)"]);
		});

		test("Should report the same foreground for two kinds that share a colour", () => {
			// A theme change recompiles only when this value changes, so a setting
			// that does not depend on the kind must report the same value for every
			// kind.
			assert.strictEqual(
				themeHeader("light", "black", "auto").foreground,
				themeHeader("dark", "black", "auto").foreground,
			);
		});

		test("Should count both header lines as injected lines", () => {
			// A diagnostic reports a position in the assembled source, so a header
			// that grows by a line and does not say so moves every reported line.
			const blocks = findTypstBlocks("```typst\n#circle()\n```\n");
			assert.strictEqual(buildPlainSource(blocks[0], header("dark", "auto", "auto")).injectedLines, 2);
		});
	});
});
