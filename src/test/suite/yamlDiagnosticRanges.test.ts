import * as assert from "assert";
import * as vscode from "vscode";
import {
	DiagnosticRanges,
	YamlDiagnosticsProvider,
	validateSingleValue,
} from "../../providers/yamlDiagnosticsProvider";
import { getDocumentYaml } from "../../utils/documentScan";
import type { SchemaCache, FieldDescriptor } from "@quarto-wizard/schema";
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

	test("Should read a binary number as Quarto does for a number field", () => {
		assert.deepStrictEqual(validateSingleValue("count", "0b101", { type: "number" }), []);
	});

	test("Should report a non-finite number for a number field", () => {
		assert.deepStrictEqual(validateSingleValue("count", ".inf", { type: "number" }), [
			'expected type "number", got string.',
		]);
		assert.deepStrictEqual(validateSingleValue("count", Infinity, { type: "number" }), [
			'expected type "number", got string.',
		]);
	});

	test("Should keep the text of a field that takes a string and a number", () => {
		assert.deepStrictEqual(validateSingleValue("label", "0b101", { type: ["number", "string"] }), []);
	});

	test("Should read a top-level binary number as Quarto does", () => {
		assert.strictEqual(YamlDiagnosticsProvider.typeFinding("count", "0b101", { type: "number" }), undefined);
	});

	test("Should report a top-level non-finite number with the type error", () => {
		assert.strictEqual(
			YamlDiagnosticsProvider.typeFinding("count", Infinity, { type: "number" }),
			'Option "count": expected type "number", got string ".inf".',
		);
	});

	test("Should keep the text of a top-level field that takes a string and a number", () => {
		assert.strictEqual(
			YamlDiagnosticsProvider.typeFinding("label", "0b101", { type: ["number", "string"] }),
			undefined,
		);
	});

	test("Should accept a quoted decimal string on a top-level number field, as Lua does", () => {
		assert.strictEqual(YamlDiagnosticsProvider.typeFinding("count", "5", { type: "number" }), undefined);
	});

	test("Should read the remaining text as Lua tonumber does on a number field", () => {
		for (const text of ["0x1p4", " 300", "0xA.8p0"]) {
			assert.strictEqual(YamlDiagnosticsProvider.typeFinding("count", text, { type: "number" }), undefined, text);
			assert.deepStrictEqual(validateSingleValue("count", text, { type: "number" }), [], text);
		}
	});
});

suite("YAML required options", () => {
	async function missing(written: string, fields: Record<string, FieldDescriptor>): Promise<string[]> {
		const document = await documentOf(`opts:\n  ${written}: 1\n`);
		const annotated = getDocumentYaml(document, document.getText());
		assert.notStrictEqual(annotated, undefined);
		const provider = new YamlDiagnosticsProvider({} as SchemaCache);
		try {
			const diagnostics: vscode.Diagnostic[] = [];
			(provider as unknown as { validateFields: (...args: unknown[]) => void }).validateFields(
				{ [written]: 1 },
				fields,
				["opts"],
				new DiagnosticRanges(document, annotated!),
				diagnostics,
			);
			return diagnostics.map((diagnostic) => diagnostic.message).filter((message) => message.includes("missing"));
		} finally {
			provider.dispose();
		}
	}

	const required: Record<string, FieldDescriptor> = { "fig-width": { type: "number", required: true, aliases: ["w"] } };

	test("Should not report a required option written as an alias", async () => {
		assert.deepStrictEqual(await missing("w", required), []);
	});

	test("Should not report a required option written with the other separator", async () => {
		assert.deepStrictEqual(await missing("fig_width", required), []);
	});

	test("Should validate a value written with the other separator against the declared option", async () => {
		const document = await documentOf("opts:\n  fig_width: abc\n");
		const annotated = getDocumentYaml(document, document.getText());
		const provider = new YamlDiagnosticsProvider({} as SchemaCache);
		try {
			const diagnostics: vscode.Diagnostic[] = [];
			(provider as unknown as { validateFields: (...args: unknown[]) => void }).validateFields(
				{ fig_width: "abc" },
				{ "fig-width": { type: "number" } },
				["opts"],
				new DiagnosticRanges(document, annotated!),
				diagnostics,
			);
			assert.strictEqual(diagnostics.length, 1);
			assert.ok(!diagnostics[0].message.includes("Unknown"), diagnostics[0].message);
		} finally {
			provider.dispose();
		}
	});

	test("Should report a required option that is not written", async () => {
		assert.deepStrictEqual(await missing("other", required), ['Required option "fig-width" is missing.']);
	});
});
