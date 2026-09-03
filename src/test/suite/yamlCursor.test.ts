import * as assert from "assert";
import * as vscode from "vscode";
import { getDocumentYaml } from "../../utils/documentScan";
import { keyPathOf } from "../../utils/yamlAnnotated";
import { yamlCursorAt } from "../../utils/yamlCursor";

/** The cursor is written as `|` in the content, the way a user would point at it. */
async function cursorAt(marked: string, language = "yaml") {
	const offset = marked.indexOf("|");
	assert.notStrictEqual(offset, -1, "the content should mark the cursor");
	const content = marked.slice(0, offset) + marked.slice(offset + 1);
	const document = await vscode.workspace.openTextDocument({ language, content });
	// The parse is often absent here, because a key half typed into a document
	// leaves it unparsable, which is the state a completion is asked for in.
	const annotated = getDocumentYaml(document, content);
	const cursor = yamlCursorAt(document, document.positionAt(offset), content, annotated);
	return cursor === undefined ? undefined : { path: keyPathOf(cursor.path), isValuePosition: cursor.isValuePosition };
}

suite("YAML Cursor Test Suite", () => {
	test("Should offer the keys of the mapping while a key is being typed", async () => {
		assert.deepStrictEqual(await cursorAt("extensions:\n  mod|"), {
			path: ["extensions"],
			isValuePosition: false,
		});
	});

	test("Should stay in the parent when the sibling above has children", async () => {
		const marked = "options:\n  size:\n    type: string\n  co|";
		assert.deepStrictEqual(await cursorAt(marked), { path: ["options"], isValuePosition: false });
	});

	test("Should stay in the parent when the sibling above has a value", async () => {
		const marked = "extensions:\n  iconify: x\n  mo|";
		assert.deepStrictEqual(await cursorAt(marked), { path: ["extensions"], isValuePosition: false });
	});

	test("Should offer the children of a key on a blank line below it", async () => {
		assert.deepStrictEqual(await cursorAt("extensions:\n  iconify:\n    |"), {
			path: ["extensions", "iconify"],
			isValuePosition: false,
		});
	});

	test("Should offer the siblings of a key on a blank line at its indent", async () => {
		assert.deepStrictEqual(await cursorAt("extensions:\n  iconify:\n  |"), {
			path: ["extensions"],
			isValuePosition: false,
		});
	});

	test("Should offer the root keys on a blank line at the margin", async () => {
		assert.deepStrictEqual(await cursorAt("extensions:\n  iconify:\n|"), { path: [], isValuePosition: false });
	});

	test("Should read a cursor after the colon as a value position", async () => {
		assert.deepStrictEqual(await cursorAt("extensions:\n  modal:\n    size: lar|"), {
			path: ["extensions", "modal", "size"],
			isValuePosition: true,
		});
	});

	test("Should read a cursor after the colon with no value written yet", async () => {
		assert.deepStrictEqual(await cursorAt("extensions:\n  modal:\n    size: |"), {
			path: ["extensions", "modal", "size"],
			isValuePosition: true,
		});
	});

	test("Should not read a colon inside a quoted key as the separator", async () => {
		// The first colon of the line sits inside the key, so a rule that compares
		// the cursor against it reads a cursor on the key as a value position and
		// offers the values of that key. The cursor is writing a key, so the keys
		// of the mapping holding it are what belong there.
		assert.deepStrictEqual(await cursorAt('"a: b"|: x\n'), { path: [], isValuePosition: false });
	});

	test("Should read the front matter of a Quarto document", async () => {
		assert.deepStrictEqual(await cursorAt("---\nformat:\n  htm|\n---\n\nBody\n", "quarto"), {
			path: ["format"],
			isValuePosition: false,
		});
	});
});
