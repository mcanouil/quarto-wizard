import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { validateSchemaDefinition } from "@quarto-wizard/core";
import type { SchemaDefinitionFinding, SchemaDefinitionSeverity } from "@quarto-wizard/core";
import { getYamlIndentLevel } from "../utils/yamlPosition";
import { debounce } from "../utils/debounce";
import { logMessage } from "../utils/log";

/**
 * Map of schema file base names to their format for validation.
 */
const SCHEMA_FILENAMES: Record<string, "yaml" | "json"> = {
	"_schema.yml": "yaml",
	"_schema.yaml": "yaml",
	"_schema.json": "json",
};

/**
 * Provides diagnostics for Quarto extension schema definition files
 * (_schema.yml, _schema.yaml, _schema.json) by validating their
 * structure and content.
 *
 * Only activates when `_extension.yml` or `_extension.yaml` exists
 * in the same directory as the schema file.
 */
export class SchemaDiagnosticsProvider implements vscode.Disposable {
	private diagnosticCollection: vscode.DiagnosticCollection;
	private disposables: vscode.Disposable[] = [];
	private debouncedValidate: ReturnType<typeof debounce>;

	constructor() {
		this.diagnosticCollection = vscode.languages.createDiagnosticCollection("quarto-schema-definition");

		this.debouncedValidate = debounce((document: vscode.TextDocument) => {
			this.validateDocument(document);
		}, 500);

		// Validate on save.
		this.disposables.push(
			vscode.workspace.onDidSaveTextDocument((document) => {
				if (this.isRelevantDocument(document)) {
					this.validateDocument(document);
				}
			}),
		);

		// Validate on change (debounced).
		this.disposables.push(
			vscode.workspace.onDidChangeTextDocument((event) => {
				if (this.isRelevantDocument(event.document)) {
					this.debouncedValidate(event.document);
				}
			}),
		);

		// Clear diagnostics when a document is closed.
		this.disposables.push(
			vscode.workspace.onDidCloseTextDocument((document) => {
				this.diagnosticCollection.delete(document.uri);
			}),
		);

		// Validate all open relevant documents on activation.
		for (const document of vscode.workspace.textDocuments) {
			if (this.isRelevantDocument(document)) {
				this.validateDocument(document);
			}
		}
	}

	dispose(): void {
		this.debouncedValidate.cancel();
		this.diagnosticCollection.dispose();
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}

	/**
	 * Force revalidation of all open schema definition documents.
	 * Useful after schema file changes detected by the file watcher.
	 */
	revalidateAll(): void {
		for (const document of vscode.workspace.textDocuments) {
			if (this.isRelevantDocument(document)) {
				this.validateDocument(document);
			}
		}
	}

	private isRelevantDocument(document: vscode.TextDocument): boolean {
		const baseName = path.basename(document.fileName);
		return baseName in SCHEMA_FILENAMES;
	}

	/**
	 * Check whether _extension.yml or _extension.yaml exists in the
	 * same directory as the given document.
	 */
	private hasAdjacentExtensionYml(document: vscode.TextDocument): boolean {
		const dir = path.dirname(document.fileName);
		return fs.existsSync(path.join(dir, "_extension.yml")) || fs.existsSync(path.join(dir, "_extension.yaml"));
	}

	private validateDocument(document: vscode.TextDocument): void {
		if (!this.hasAdjacentExtensionYml(document)) {
			this.diagnosticCollection.set(document.uri, []);
			return;
		}

		const baseName = path.basename(document.fileName);
		const format = SCHEMA_FILENAMES[baseName];
		if (!format) {
			return;
		}

		const content = document.getText();
		const findings = validateSchemaDefinition(content, format);

		if (findings.length === 0) {
			this.diagnosticCollection.set(document.uri, []);
			return;
		}

		const lines = content.split("\n");
		const diagnostics = findings.map((finding) => this.findingToDiagnostic(finding, lines, format));

		this.diagnosticCollection.set(document.uri, diagnostics);
		logMessage(`Schema definition diagnostics: ${diagnostics.length} issue(s) in ${baseName}.`, "debug");
	}

	private findingToDiagnostic(
		finding: SchemaDefinitionFinding,
		lines: string[],
		format: "yaml" | "json",
	): vscode.Diagnostic {
		let range: vscode.Range;

		if (finding.line !== undefined) {
			// Syntax errors with explicit line/column.
			const line = Math.min(finding.line, lines.length - 1);
			const col = finding.column ?? 0;
			range = new vscode.Range(line, col, line, lines[line]?.length ?? col);
		} else if (finding.keyPath) {
			// Structural/semantic findings with a key path.
			const lineNum =
				format === "json" ? this.findKeyLineJson(finding.keyPath, lines) : this.findKeyLineYaml(finding.keyPath, lines);
			if (lineNum >= 0) {
				range = new vscode.Range(lineNum, 0, lineNum, lines[lineNum].length);
			} else {
				range = new vscode.Range(0, 0, 0, lines[0]?.length ?? 0);
			}
		} else {
			range = new vscode.Range(0, 0, 0, lines[0]?.length ?? 0);
		}

		const severity = severityToVscode(finding.severity);
		const diagnostic = new vscode.Diagnostic(range, finding.message, severity);
		diagnostic.source = "quarto-wizard";
		diagnostic.code = finding.code;
		return diagnostic;
	}

	/**
	 * Find the line number for a dot-separated key path in YAML content.
	 * Uses indentation-walking, mirroring the approach in YamlDiagnosticsProvider.
	 */
	private findKeyLineYaml(keyPath: string, lines: string[]): number {
		const keys = splitKeyPath(keyPath);
		let searchStart = 0;
		let expectedMinIndent = 0;

		for (let pathIdx = 0; pathIdx < keys.length; pathIdx++) {
			const targetKey = keys[pathIdx];
			let found = false;

			for (let i = searchStart; i < lines.length; i++) {
				const line = lines[i];
				const trimmed = line.trim();
				if (trimmed === "" || trimmed.startsWith("#")) {
					continue;
				}

				const indent = getYamlIndentLevel(line);

				if (pathIdx > 0 && indent < expectedMinIndent) {
					break;
				}

				const keyMatch = /^\s*(?:- )?([^\s:][^:]*?)\s*:/.exec(line);
				if (keyMatch && keyMatch[1] === targetKey && indent >= expectedMinIndent) {
					if (pathIdx === keys.length - 1) {
						return i;
					}
					searchStart = i + 1;
					expectedMinIndent = indent + 1;
					found = true;
					break;
				}
			}

			if (!found) {
				return -1;
			}
		}

		return -1;
	}

	/**
	 * Find the line number for a dot-separated key path in JSON content.
	 * Tracks brace depth to match nested keys. Depth is measured at the
	 * start of each line so that opening braces on the same line as a key
	 * do not inflate the depth used for matching.
	 */
	private findKeyLineJson(keyPath: string, lines: string[]): number {
		const keys = splitKeyPath(keyPath);
		let targetDepth = 0;
		let currentDepth = 0;
		let keyIdx = 0;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const depthAtLineStart = currentDepth;

			for (const ch of line) {
				if (ch === "{" || ch === "[") {
					currentDepth++;
				} else if (ch === "}" || ch === "]") {
					currentDepth--;
				}
			}

			if (keyIdx >= keys.length) {
				break;
			}

			// Match against depth at start of line so that opening braces
			// belonging to the matched key's value do not affect the check.
			const pattern = new RegExp(`"${escapeRegExp(keys[keyIdx])}"\\s*:`);
			if (pattern.test(line) && depthAtLineStart >= targetDepth + 1) {
				if (keyIdx === keys.length - 1) {
					return i;
				}
				keyIdx++;
				targetDepth = depthAtLineStart;
			}
		}

		return -1;
	}
}

/**
 * Split a key path that may contain array index notation.
 * "shortcodes.mysc.arguments[0]" becomes ["shortcodes", "mysc", "arguments"].
 * Array indices are stripped because we point to the parent key line.
 */
function splitKeyPath(keyPath: string): string[] {
	return keyPath
		.replace(/\[\d+\]/g, "")
		.split(".")
		.filter((s) => s.length > 0);
}

/**
 * Escape a string for use in a regular expression.
 */
function escapeRegExp(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Convert a SchemaDefinitionSeverity to a vscode.DiagnosticSeverity.
 */
function severityToVscode(severity: SchemaDefinitionSeverity): vscode.DiagnosticSeverity {
	switch (severity) {
		case "error":
			return vscode.DiagnosticSeverity.Error;
		case "warning":
			return vscode.DiagnosticSeverity.Warning;
		case "information":
			return vscode.DiagnosticSeverity.Information;
	}
}
