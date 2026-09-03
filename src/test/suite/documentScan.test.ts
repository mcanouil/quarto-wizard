import * as assert from "assert";
import * as vscode from "vscode";
import { getDocumentCodeBlockRanges, getDocumentTypstBlocks } from "../../utils/documentScan";

/** One document, as the cache sees it: an identity, a URI and a version. */
function document(uri: string, version = 1): { document: vscode.TextDocument; edit: () => void } {
	const held = { uri: vscode.Uri.file(uri), version };
	return { document: held as vscode.TextDocument, edit: () => held.version++ };
}

const TEXT = "```typst\n#circle()\n```\n\n```python\n1\n```\n";

suite("Document scan cache", () => {
	test("Should return the same ranges again at the same document version", () => {
		const { document: held } = document("/same-version.qmd");
		const first = getDocumentCodeBlockRanges(held, TEXT);
		assert.strictEqual(getDocumentCodeBlockRanges(held, TEXT), first);
		assert.strictEqual(first.length, 2);
	});

	test("Should read the text again when the document version moves", () => {
		const { document: held, edit } = document("/moved-version.qmd");
		const first = getDocumentCodeBlockRanges(held, TEXT);
		edit();
		assert.notStrictEqual(getDocumentCodeBlockRanges(held, TEXT), first);
	});

	test("Should keep what one document holds while another is read", () => {
		// Two sweeps read every open document in turn, and two editors side by side
		// alternate, so a single entry would be rebuilt on every other call.
		const { document: one } = document("/one.qmd");
		const { document: two } = document("/two.qmd");
		const first = getDocumentCodeBlockRanges(one, TEXT);
		getDocumentCodeBlockRanges(two, TEXT);
		assert.strictEqual(getDocumentCodeBlockRanges(one, TEXT), first);
	});

	test("Should read the text again for the document that took a reused name", () => {
		// The key is the document and not its URI. An untitled name is handed out
		// again once the document holding it closes, and the document taking it
		// starts at version one with other text, so a URI and a version together
		// name two documents. This is what a preview answered from the image of
		// the document before it, and the whole suite passes without this case.
		const first = getDocumentCodeBlockRanges(document("/untitled-1").document, TEXT);
		const again = getDocumentCodeBlockRanges(document("/untitled-1").document, TEXT);
		assert.notStrictEqual(again, first);
	});

	test("Should hold the Typst blocks beside the ranges of one version", () => {
		// The two readers scan by different rules, so one entry holds both. A
		// reader asking must not forget what the other one already built.
		const { document: held } = document("/both.qmd");
		const ranges = getDocumentCodeBlockRanges(held, TEXT);
		const blocks = getDocumentTypstBlocks(held, () => TEXT);
		assert.strictEqual(blocks.length, 1);
		assert.strictEqual(getDocumentCodeBlockRanges(held, TEXT), ranges);
		assert.strictEqual(
			getDocumentTypstBlocks(held, () => TEXT),
			blocks,
		);
	});

	test("Should read nothing on a Typst block hit", () => {
		const { document: held } = document("/no-read.qmd");
		getDocumentTypstBlocks(held, () => TEXT);
		getDocumentTypstBlocks(held, () => {
			assert.fail("a hit read the document text");
		});
	});

	test("Should read the Typst blocks again when the document version moves", () => {
		const { document: held, edit } = document("/moved-blocks.qmd");
		const first = getDocumentTypstBlocks(held, () => TEXT);
		edit();
		assert.notStrictEqual(
			getDocumentTypstBlocks(held, () => TEXT),
			first,
		);
	});
});
