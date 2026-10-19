import * as assert from "assert";
import * as path from "node:path";
import * as vscode from "vscode";
import { SchemaDiagnosticsProvider } from "../../providers/schemaDiagnosticsProvider";

const FIXTURES = path.resolve(__dirname, "..", "..", "..", "test-fixtures", "schema-diagnostics");

interface Finding {
	code: string;
	severity: vscode.DiagnosticSeverity;
	text: string;
	line: number;
}

suite("Schema Diagnostics Provider", () => {
	let provider: SchemaDiagnosticsProvider;

	setup(() => {
		provider = new SchemaDiagnosticsProvider();
	});

	teardown(() => {
		provider.dispose();
	});

	async function findingsOf(relativePath: string): Promise<Finding[]> {
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(FIXTURES, relativePath)));
		provider.revalidateAll();
		const seen = new Map<string, Finding>();
		for (const diagnostic of vscode.languages.getDiagnostics(document.uri)) {
			assert.strictEqual(diagnostic.source, "quarto-wizard");
			const finding = {
				code: String(diagnostic.code),
				severity: diagnostic.severity,
				text: document.getText(diagnostic.range),
				line: diagnostic.range.start.line,
			};
			seen.set(`${finding.code}@${finding.line}`, finding);
		}
		return [...seen.values()].sort((a, b) => a.line - b.line);
	}

	test("Reports each finding of an invalid schema at the key it concerns", async () => {
		const findings = await findingsOf("invalid/_schema.yml");
		assert.deepStrictEqual(findings, [
			{ code: "unknown-top-level-key", severity: vscode.DiagnosticSeverity.Warning, text: "bogus", line: 2 },
			{ code: "min-greater-than-max", severity: vscode.DiagnosticSeverity.Error, text: "depth", line: 5 },
			{ code: "empty-enum", severity: vscode.DiagnosticSeverity.Warning, text: "mode", line: 9 },
			{ code: "unknown-field-property", severity: vscode.DiagnosticSeverity.Warning, text: "colour", line: 14 },
		]);
	});

	test("Reports nothing for a valid schema", async () => {
		assert.deepStrictEqual(await findingsOf("valid/_schema.yml"), []);
	});

	test("Reports nothing when no _extension.yml sits beside the schema", async () => {
		assert.deepStrictEqual(await findingsOf("orphan/_schema.yml"), []);
	});

	test("Reports a syntax error as an error on its own line", async () => {
		const findings = await findingsOf("syntax/_schema.yml");
		assert.deepStrictEqual(findings, [
			{ code: "syntax-error", severity: vscode.DiagnosticSeverity.Error, text: "", line: 2 },
		]);
	});

	test("Validates a JSON schema file", async () => {
		const findings = await findingsOf("json/_schema.json");
		assert.deepStrictEqual(findings, [
			{ code: "min-greater-than-max", severity: vscode.DiagnosticSeverity.Error, text: "depth", line: 2 },
		]);
	});

	test("Does not validate a file that is not a schema definition", async () => {
		const document = await vscode.workspace.openTextDocument(
			vscode.Uri.file(path.join(FIXTURES, "invalid/_extension.yml")),
		);
		provider.revalidateAll();
		assert.deepStrictEqual(vscode.languages.getDiagnostics(document.uri), []);
	});
});
