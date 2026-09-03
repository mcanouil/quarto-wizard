import * as assert from "assert";
import * as vscode from "vscode";
import { DiagnosticRanges } from "../../providers/yamlDiagnosticsProvider";
import { getDocumentYaml } from "../../utils/documentScan";
import type { YamlPathSegment } from "../../utils/yamlAnnotated";

/** A document held in memory, the way the preview suites build one. */
async function documentOf(content: string, language = "yaml"): Promise<vscode.TextDocument> {
	return vscode.workspace.openTextDocument({ language, content });
}

/** What a diagnostic would underline, which is the part a user sees. */
async function underlined(
	content: string,
	path: readonly YamlPathSegment[],
	half: "key" | "value",
	language = "yaml",
): Promise<string | undefined> {
	const document = await documentOf(content, language);
	const annotated = getDocumentYaml(document, document.getText());
	assert.notStrictEqual(annotated, undefined, "the document should parse");
	const where = new DiagnosticRanges(document, annotated!);
	const range = half === "key" ? where.key(path) : where.value(path);
	return range === undefined ? undefined : document.getText(range);
}

suite("YAML Diagnostic Ranges Test Suite", () => {
	test("Should underline the value and not the whole line", async () => {
		const content = "extensions:\n  modal:\n    size: enormous\n";
		assert.strictEqual(await underlined(content, ["extensions", "modal", "size"], "value"), "enormous");
	});

	test("Should underline the key when the finding is about the key", async () => {
		const content = "extensions:\n  modal:\n    size: enormous\n";
		assert.strictEqual(await underlined(content, ["extensions", "modal", "size"], "key"), "size");
	});

	test("Should underline inside a flow style mapping, which the line walk dropped", async () => {
		const content = "format: {html: {toc: 3}}\n";
		assert.strictEqual(await underlined(content, ["format", "html", "toc"], "value"), "3");
	});

	test("Should underline the entry of a sequence and not the whole sequence", async () => {
		const content = "extensions:\n  modal:\n    sizes:\n      - small\n      - enormous\n";
		assert.strictEqual(await underlined(content, ["extensions", "modal", "sizes", 1], "value"), "enormous");
	});

	test("Should fall back to the key when no value is written", async () => {
		const content = "extensions:\n  modal:\n    size:\n";
		assert.strictEqual(await underlined(content, ["extensions", "modal", "size"], "value"), "size");
	});

	test("Should underline a value written in front matter of a Quarto document", async () => {
		const content = "---\nformat:\n  html:\n    toc: 3\n---\n\nBody\n";
		assert.strictEqual(await underlined(content, ["format", "html", "toc"], "value", "quarto"), "3");
	});

	test("Should report nothing for a path the document does not write", async () => {
		const content = "extensions:\n  modal:\n    size: large\n";
		assert.strictEqual(await underlined(content, ["extensions", "modal", "colour"], "value"), undefined);
	});

	test("Should follow a duplicated key to the value that wins", async () => {
		// The value cannot be built, exactly as `yaml.load` refused it before, but
		// the positions still hold, and the second occurrence is the live one.
		const content = "format:\n  html:\n    toc: 1\nother: x\nformat:\n  html:\n    toc: 2\n";
		assert.strictEqual(await underlined(content, ["format", "html", "toc"], "value"), "2");
	});
});
