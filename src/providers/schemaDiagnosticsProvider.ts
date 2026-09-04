import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { validateSchemaDefinition } from "@quarto-wizard/schema";
import type { SchemaDefinitionFinding, SchemaDefinitionSeverity } from "@quarto-wizard/schema";
import { getDocumentYaml } from "../utils/documentScan";
import type { AnnotatedYaml, YamlPathSegment } from "../utils/yamlAnnotated";
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
		// One parse serves both formats, because JSON is flow style YAML.
		const annotated = getDocumentYaml(document, content);
		const diagnostics = findings.map((finding) => this.findingToDiagnostic(finding, document, lines, annotated));

		this.diagnosticCollection.set(document.uri, diagnostics);
		logMessage(`Schema definition diagnostics: ${diagnostics.length} issue(s) in ${baseName}.`, "debug");
	}

	private findingToDiagnostic(
		finding: SchemaDefinitionFinding,
		document: vscode.TextDocument,
		lines: string[],
		annotated: AnnotatedYaml | undefined,
	): vscode.Diagnostic {
		const firstLine = new vscode.Range(0, 0, 0, lines[0]?.length ?? 0);
		let range = firstLine;

		if (finding.line !== undefined) {
			// A syntax error, which already carries its own place.
			const line = Math.min(finding.line, lines.length - 1);
			const col = finding.column ?? 0;
			range = new vscode.Range(line, col, line, lines[line]?.length ?? col);
		} else if (finding.keyPath && annotated) {
			range = locateKeyPath(document, annotated, finding.keyPath) ?? firstLine;
		}

		const severity = severityToVscode(finding.severity);
		const diagnostic = new vscode.Diagnostic(range, finding.message, severity);
		diagnostic.source = "quarto-wizard";
		diagnostic.code = finding.code;
		return diagnostic;
	}
}

/**
 * Split a key path that may carry the position of a sequence entry.
 *
 * `shortcodes.mysc.arguments[0]` becomes `["shortcodes", "mysc", "arguments", 0]`.
 * The position is kept, because the annotated parse knows where the entry itself
 * is written. The line walk this replaces stripped it and pointed at the key of
 * the sequence instead.
 *
 * @param keyPath - The dotted path a finding carries.
 */
function splitKeyPath(keyPath: string): YamlPathSegment[] {
	const segments: YamlPathSegment[] = [];
	for (const part of keyPath.split(".")) {
		const name = part.replace(/\[\d+\]/g, "");
		if (name.length > 0) {
			segments.push(name);
		}
		for (const index of part.matchAll(/\[(\d+)\]/g)) {
			segments.push(Number(index[1]));
		}
	}
	return segments;
}

/**
 * Where a finding goes, given the path it names.
 *
 * The whole path is tried first, then one segment shorter, and so on. A finding
 * about something that is not written, such as a required key that is missing,
 * names a path the document does not hold, and the nearest parent that is
 * written is the closest place to put it.
 *
 * @param document - The document the finding belongs to.
 * @param annotated - The parse of that document.
 * @param keyPath - The dotted path the finding carries.
 * @returns The range, or undefined when not even the root is written.
 */
function locateKeyPath(
	document: vscode.TextDocument,
	annotated: AnnotatedYaml,
	keyPath: string,
): vscode.Range | undefined {
	const segments = splitKeyPath(keyPath);
	for (let length = segments.length; length > 0; length--) {
		const node = annotated.nodeAt(segments.slice(0, length));
		const range = node?.keyRange ?? node?.range;
		if (range !== undefined) {
			return new vscode.Range(document.positionAt(range.start), document.positionAt(range.end));
		}
	}
	return undefined;
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
