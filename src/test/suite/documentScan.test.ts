import * as assert from "assert";
import * as vscode from "vscode";
import { getDocumentCodeBlockRanges, getDocumentTypstBlocks } from "../../utils/documentScan";

/** One document, as the cache sees it: a URI and a version. */
function document(uri: string, version: number): vscode.TextDocument {
	return { uri: vscode.Uri.file(uri), version } as vscode.TextDocument;
}

const TEXT = "```typst\n#circle()\n```\n\n```python\n1\n```\n";

suite("Document scan cache", () => {
	test("Should return the same ranges again at the same document version", () => {
		const held = document("/same-version.qmd", 1);
		const first = getDocumentCodeBlockRanges(held, () => TEXT);
		assert.strictEqual(
			getDocumentCodeBlockRanges(held, () => TEXT),
			first,
		);
		assert.strictEqual(first.length, 2);
	});

	test("Should read the text again when the document version moves", () => {
		const first = getDocumentCodeBlockRanges(document("/moved-version.qmd", 1), () => TEXT);
		const again = getDocumentCodeBlockRanges(document("/moved-version.qmd", 2), () => TEXT);
		assert.notStrictEqual(again, first);
	});

	test("Should read the text again when another document asks", () => {
		const first = getDocumentCodeBlockRanges(document("/one.qmd", 1), () => TEXT);
		getDocumentCodeBlockRanges(document("/two.qmd", 1), () => TEXT);
		assert.notStrictEqual(
			getDocumentCodeBlockRanges(document("/one.qmd", 1), () => TEXT),
			first,
		);
	});

	test("Should read nothing on a hit", () => {
		const held = document("/no-read.qmd", 1);
		getDocumentCodeBlockRanges(held, () => TEXT);
		getDocumentCodeBlockRanges(held, () => {
			assert.fail("a hit read the document text");
		});
	});

	test("Should hold the Typst blocks beside the ranges of one version", () => {
		// The two readers scan by different rules, so one entry holds both. A
		// reader asking must not forget what the other one already built.
		const held = document("/both.qmd", 1);
		const ranges = getDocumentCodeBlockRanges(held, () => TEXT);
		const blocks = getDocumentTypstBlocks(held, () => TEXT);
		assert.strictEqual(blocks.length, 1);
		assert.strictEqual(
			getDocumentCodeBlockRanges(held, () => TEXT),
			ranges,
		);
		assert.strictEqual(
			getDocumentTypstBlocks(held, () => TEXT),
			blocks,
		);
	});

	test("Should read the Typst blocks again when the document version moves", () => {
		const first = getDocumentTypstBlocks(document("/moved-blocks.qmd", 1), () => TEXT);
		assert.notStrictEqual(
			getDocumentTypstBlocks(document("/moved-blocks.qmd", 2), () => TEXT),
			first,
		);
	});
});
