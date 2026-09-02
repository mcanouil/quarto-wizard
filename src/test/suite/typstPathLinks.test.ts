import * as assert from "assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { TypstPathLinks } from "../../providers/typstPathLinks";

/** The document of a directory written for one case. */
async function open(directory: string, name: string, content: string): Promise<vscode.TextDocument> {
	const file = path.join(directory, name);
	fs.writeFileSync(file, content, "utf8");
	return vscode.workspace.openTextDocument(vscode.Uri.file(file));
}

suite("Typst Path Links Test Suite", () => {
	let directory: string;
	let provider: TypstPathLinks;

	setup(() => {
		// Spelled as the editor spells it. Every path under test reaches the
		// assertion through a `Uri`, and on Windows that lower-cases the drive
		// letter, so a raw temporary directory differs from it by that letter alone.
		directory = vscode.Uri.file(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "typst-links-")))).fsPath;
		provider = new TypstPathLinks();
	});

	teardown(() => {
		provider.dispose();
		fs.rmSync(directory, { recursive: true, force: true });
	});

	test("Should link a `file:` that names a file that is there", async () => {
		fs.writeFileSync(path.join(directory, "_plot.typ"), "#circle()\n", "utf8");
		const document = await open(directory, "post.qmd", "```{typst}\n//| file: _plot.typ\n```\n");

		const links = await provider.provideDocumentLinks(document);

		assert.strictEqual(links.length, 1);
		assert.strictEqual(links[0].target?.fsPath, path.join(directory, "_plot.typ"));
		assert.strictEqual(document.getText(links[0].range), "_plot.typ");
	});

	test("Should link a `preamble:` written in the front matter", async () => {
		fs.writeFileSync(path.join(directory, "_pre.typ"), "#set text(size: 9pt)\n", "utf8");
		const document = await open(directory, "post.qmd", "---\ntypst-render:\n  preamble: _pre.typ\n---\n");

		const links = await provider.provideDocumentLinks(document);

		assert.strictEqual(links.length, 1);
		assert.strictEqual(links[0].target?.fsPath, path.join(directory, "_pre.typ"));
	});

	test("Should offer no link for a path that leads to no file", async () => {
		const document = await open(directory, "post.qmd", "```{typst}\n//| file: _absent.typ\n```\n");

		assert.deepStrictEqual(await provider.provideDocumentLinks(document), []);
	});

	test("Should warn about a path in a document that leads to no file", async () => {
		const document = await open(directory, "post.qmd", "```{typst}\n//| file: _absent.typ\n```\n");

		const found = await provider.refresh(document);

		assert.strictEqual(found.length, 1);
		assert.strictEqual(found[0].code, "typst-missing-path");
		assert.strictEqual(found[0].severity, vscode.DiagnosticSeverity.Warning);
		assert.strictEqual(document.getText(found[0].range), "_absent.typ");
	});

	test("Should not warn about a relative path in a configuration file", async () => {
		// Every document below the file resolves the path against its own
		// directory, so the file itself cannot say the path leads nowhere.
		const document = await open(directory, "_quarto.yml", "typst-render:\n  preamble: _absent.typ\n");

		assert.deepStrictEqual(await provider.refresh(document), []);
	});

	test("Should write no warning for a document that names no path", async () => {
		const document = await open(directory, "post.qmd", "```{typst}\n#circle()\n```\n");

		assert.deepStrictEqual(await provider.refresh(document), []);
	});
});
