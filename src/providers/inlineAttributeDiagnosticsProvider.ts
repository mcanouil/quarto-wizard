import * as vscode from "vscode";
import type { SchemaCache, FieldDescriptor, ShortcodeSchema } from "@quarto-wizard/schema";
import { typeIncludes, formatType, validateFieldValue, coerceFieldValue } from "@quarto-wizard/schema";
import { parseAttributeAtPosition } from "../utils/elementAttributeParser";
import type { TextRange } from "../utils/yamlPosition";
import { parseShortcodeAtPosition } from "../utils/shortcodeParser";
import {
	type ElementAttributeSchemas,
	collectElementAttributeSchemas,
	mergeApplicableAttributes,
	resolveElementAttribute,
} from "./elementAttributeCompletionProvider";
import { collectShortcodeSchemas, resolveShortcodeAttribute } from "./shortcodeCompletionProvider";
import { getErrorMessage } from "@quarto-wizard/core";
import {
	type BlockMatch,
	type KeyValueOffset,
	extractBareWords,
	extractBlocks,
	findArgumentOffset,
	findEmptyValueAssignments,
	findKeyValueOffset,
	findSpacesAroundEquals,
} from "../utils/inlineAttributeText";
import { cellLanguage, readCellOptions } from "../utils/cellOptions";
import { type CellOptionSchemas, type CellOptionWithSource, collectCellOptionSchemas } from "./cellOptionSchemas";
import type { FencedBlock } from "../utils/yamlPosition";
import { getDocumentFencedBlocks } from "../utils/documentScan";
import { logMessage } from "../utils/log";
import { debounce } from "../utils/debounce";

// ---------------------------------------------------------------------------
// Inline value validation (pure, no VS Code dependency)
// ---------------------------------------------------------------------------

/**
 * Severity levels for inline validation findings, mirroring VS Code diagnostic severities.
 */
export type InlineValidationSeverity = "error" | "warning" | "information";

/**
 * A single validation finding from `validateInlineValue`.
 */
export interface InlineValidationFinding {
	message: string;
	severity: InlineValidationSeverity;
	code: string;
}

/**
 * The attribute that replaces a deprecated one, with its descriptor.
 */
export interface InlineReplacement {
	key: string;
	descriptor: FieldDescriptor;
}

/**
 * Find the replacement of an attribute deprecated with `replaceWith`.
 * There is none when the replacement is not declared, or when the attribute
 * list already writes it, under its name or one of its aliases.
 */
function findInlineReplacement(
	descriptor: FieldDescriptor,
	written: Record<string, string>,
	resolve: (name: string) => FieldDescriptor | undefined,
): InlineReplacement | undefined {
	const key = typeof descriptor.deprecated === "object" ? descriptor.deprecated.replaceWith : undefined;
	if (!key) {
		return undefined;
	}
	const replacement = resolve(key);
	if (!replacement) {
		return undefined;
	}
	const names = [key, ...(replacement.aliases ?? [])];
	if (names.some((name) => name in written)) {
		return undefined;
	}
	return { key, descriptor: replacement };
}

/**
 * Validate a single inline attribute value against a field descriptor.
 *
 * All inline values are strings, so type checking requires coercion.
 * Types that cannot be represented inline (array, object, content) are skipped.
 * The value checks are those of `validateFieldValue`, run on the value coerced
 * to the declared type, as the Lua validator coerces it.
 * A descriptor deprecated with `replaceWith` gets the deprecation finding, and
 * its value is checked against the replacement when one is given, as the Lua
 * validator moves the value to the replacement.
 *
 * @param replacement - The replacement of a deprecated attribute, when the
 * attribute list does not write it.
 * @param noun - What the key names in messages: an attribute of an attribute
 * list, or an option of a cell.
 * @returns An array of findings (may be empty if valid).
 */
export function validateInlineValue(
	key: string,
	value: string,
	descriptor: FieldDescriptor,
	replacement?: InlineReplacement,
	noun: "Attribute" | "Option" = "Attribute",
): InlineValidationFinding[] {
	const coerced = coerceFieldValue(value, descriptor.type);
	const findings: InlineValidationFinding[] = validateFieldValue(key, coerced, descriptor).map((finding) => ({
		...finding,
		message:
			finding.code === "schema-deprecated" ? `${noun} ${finding.message}` : `${noun} "${key}": ${finding.message}`,
	}));

	if (typeof descriptor.deprecated === "object" && descriptor.deprecated.replaceWith) {
		if (replacement) {
			findings.push(
				...validateInlineValue(replacement.key, value, replacement.descriptor, undefined, noun).filter(
					(finding) => finding.code !== "schema-deprecated",
				),
			);
		}
		return findings;
	}

	// Type check (coerce from string).
	if (descriptor.type) {
		// Early exit when the type has no inline-representable members.
		const hasInlineType =
			typeIncludes(descriptor.type, "string") ||
			typeIncludes(descriptor.type, "number") ||
			typeIncludes(descriptor.type, "integer") ||
			typeIncludes(descriptor.type, "boolean");
		if (!hasInlineType) {
			return findings;
		}

		// If "string" is in the union, any string value is valid. Otherwise the
		// text is valid only when it coerces to a number, an integer or a
		// boolean that the union declares, and coercion leaves anything else text.
		if (!typeIncludes(descriptor.type, "string")) {
			if (typeof coerced === "string") {
				findings.push({
					message: `${noun} "${key}": expected type "${formatType(descriptor.type)}", got string "${value}".`,
					severity: "error",
					code: "schema-type-mismatch",
				});
				return findings;
			}
		}
	}

	// Const check.
	if (descriptor.const !== undefined) {
		if (value !== String(descriptor.const)) {
			findings.push({
				message: `${noun} "${key}": value must be ${JSON.stringify(descriptor.const)}.`,
				severity: "error",
				code: "schema-const",
			});
		}
	}

	return findings;
}

// ---------------------------------------------------------------------------
// Diagnostic codes
// ---------------------------------------------------------------------------

const SPACES_AROUND_EQUALS_CODE = "spaces-around-equals";
const EMPTY_VALUE_CODE = "empty-attribute-value";
const BARE_ATTRIBUTE_CODE = "schema-bare-attribute";

/**
 * Convert inline validation findings into VS Code diagnostics for a
 * key-value pair, appending them to the given diagnostics array.
 * Deprecated and required-missing findings target the key range;
 * all other findings target the value range.
 */
function appendKeyValueDiagnostics(
	findings: InlineValidationFinding[],
	kv: KeyValueOffset,
	block: BlockMatch,
	document: vscode.TextDocument,
	diagnostics: vscode.Diagnostic[],
): void {
	for (const finding of findings) {
		const isKeyLevel = finding.code === "schema-deprecated" || finding.code === "schema-required-missing";
		const absStart = block.contentOffset + (isKeyLevel ? kv.keyStart : kv.valueStart);
		const absEnd = block.contentOffset + (isKeyLevel ? kv.keyEnd : kv.valueEnd);
		const range = new vscode.Range(document.positionAt(absStart), document.positionAt(absEnd));
		const diagnostic = new vscode.Diagnostic(range, finding.message, toVsSeverity(finding.severity));
		diagnostic.code = finding.code;
		diagnostic.source = "quarto-wizard";
		diagnostics.push(diagnostic);
	}
}

/**
 * Map inline validation severity to VS Code diagnostic severity.
 */
function toVsSeverity(severity: InlineValidationSeverity): vscode.DiagnosticSeverity {
	switch (severity) {
		case "error":
			return vscode.DiagnosticSeverity.Error;
		case "warning":
			return vscode.DiagnosticSeverity.Warning;
		case "information":
			return vscode.DiagnosticSeverity.Information;
	}
}

/**
 * Provides diagnostics for spaces around `=` in Pandoc attribute blocks
 * and Quarto shortcodes, and validates attribute values against extension schemas.
 *
 * Also registers a code action provider that offers quick fixes
 * to remove the unnecessary spaces.
 */
export class InlineAttributeDiagnosticsProvider implements vscode.Disposable {
	private diagnosticCollection: vscode.DiagnosticCollection;
	private disposables: vscode.Disposable[] = [];
	private debouncedValidate: ReturnType<typeof debounce>;
	private schemaCache: SchemaCache;
	private validationVersion = 0;

	constructor(schemaCache: SchemaCache) {
		this.schemaCache = schemaCache;
		this.diagnosticCollection = vscode.languages.createDiagnosticCollection("quarto-inline-attributes");

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

		// Re-validate open documents when a lint setting is toggled.
		this.disposables.push(
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration("quartoWizard.lint")) {
					this.revalidateOpenDocuments();
				}
			}),
		);

		// Validate all open relevant documents on activation.
		this.revalidateOpenDocuments();
	}

	private revalidateOpenDocuments(): void {
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

	private isRelevantDocument(document: vscode.TextDocument): boolean {
		return document.languageId === "quarto" || document.fileName.endsWith(".qmd");
	}

	private async validateDocument(document: vscode.TextDocument): Promise<void> {
		if (document.isClosed) {
			return;
		}

		const version = ++this.validationVersion;
		const text = document.getText();
		const codeBlockRanges = getDocumentFencedBlocks(document, text);
		const blocks = extractBlocks(text, codeBlockRanges);
		const diagnostics: vscode.Diagnostic[] = [];

		// Phase 1: syntax-level diagnostics (synchronous, always runs).
		for (const block of blocks) {
			for (const finding of findSpacesAroundEquals(block.content)) {
				const absStart = block.contentOffset + finding.start;
				const absEnd = block.contentOffset + finding.end;
				const range = new vscode.Range(document.positionAt(absStart), document.positionAt(absEnd));
				const diagnostic = new vscode.Diagnostic(
					range,
					'Remove spaces around "=" in attribute assignment.',
					vscode.DiagnosticSeverity.Error,
				);
				diagnostic.code = SPACES_AROUND_EQUALS_CODE;
				diagnostic.source = "quarto-wizard";
				diagnostics.push(diagnostic);
			}

			for (const finding of findEmptyValueAssignments(block.content)) {
				const absStart = block.contentOffset + finding.start;
				const absEnd = block.contentOffset + finding.end;
				const range = new vscode.Range(document.positionAt(absStart), document.positionAt(absEnd));
				const diagnostic = new vscode.Diagnostic(
					range,
					`Attribute "${finding.key}" has no value. Use ${finding.key}="" for an explicit empty value.`,
					vscode.DiagnosticSeverity.Warning,
				);
				diagnostic.code = EMPTY_VALUE_CODE;
				diagnostic.source = "quarto-wizard";
				diagnostics.push(diagnostic);
			}
		}

		// Phase 2: schema-based validation (async).
		try {
			const [elementSchemas, shortcodeSchemas, cellSchemas] = await Promise.all([
				collectElementAttributeSchemas(this.schemaCache),
				collectShortcodeSchemas(this.schemaCache),
				collectCellOptionSchemas(this.schemaCache),
			]);

			// A newer validation was started while we awaited; discard this result.
			if (version !== this.validationVersion) {
				return;
			}

			const hasElementSchemas = Object.keys(elementSchemas).length > 0;
			const hasShortcodeSchemas = shortcodeSchemas.size > 0;

			if (hasElementSchemas || hasShortcodeSchemas) {
				const reportUnknown = vscode.workspace
					.getConfiguration("quartoWizard.lint", document.uri)
					.get<boolean>("unknownAttributes", false);
				for (const block of blocks) {
					if (block.type === "element" && hasElementSchemas) {
						this.validateElementBlock(
							block,
							text,
							elementSchemas,
							document,
							diagnostics,
							codeBlockRanges,
							reportUnknown,
						);
					} else if (block.type === "shortcode" && hasShortcodeSchemas) {
						this.validateShortcodeBlock(block, text, shortcodeSchemas, document, diagnostics, codeBlockRanges);
					}
				}
			}

			for (const fenced of codeBlockRanges) {
				this.validateCellBlock(fenced, text, cellSchemas, document, diagnostics);
			}
		} catch (error) {
			logMessage(`Inline schema validation error: ${getErrorMessage(error)}.`, "warn");
		}

		this.setDiagnostics(document, diagnostics);
	}

	private setDiagnostics(document: vscode.TextDocument, diagnostics: vscode.Diagnostic[]): void {
		if (document.isClosed) {
			this.diagnosticCollection.delete(document.uri);
			return;
		}
		this.diagnosticCollection.set(document.uri, diagnostics);
	}

	private validateCellBlock(
		block: FencedBlock,
		text: string,
		schemas: CellOptionSchemas,
		document: vscode.TextDocument,
		diagnostics: vscode.Diagnostic[],
	): void {
		const language = cellLanguage(block.info);
		const options = language === undefined ? undefined : schemas[language];
		if (language === undefined || options === undefined) {
			return;
		}
		const lines = readCellOptions(text, block, language);
		if (lines === undefined) {
			return;
		}

		const toRange = (range: TextRange): vscode.Range =>
			new vscode.Range(document.positionAt(range.start), document.positionAt(range.end));
		const report = (range: TextRange, message: string, severity: InlineValidationSeverity, code: string): void => {
			const diagnostic = new vscode.Diagnostic(toRange(range), message, toVsSeverity(severity));
			diagnostic.code = code;
			diagnostic.source = "quarto-wizard";
			diagnostics.push(diagnostic);
		};

		const written: Record<string, string> = Object.create(null);
		for (const line of lines) {
			written[line.key] = line.value ?? "";
		}

		for (const line of lines) {
			const entry = resolveElementAttribute(options, line.key) as CellOptionWithSource | undefined;
			if (!entry) {
				continue;
			}
			if (entry.conflicts.length > 0 && entry.contested.includes(line.key)) {
				const names = [entry.source, ...entry.conflicts];
				const list = `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
				report(
					line.keyRange,
					`\`${line.key}\` for \`{${language}}\` cells is declared by ${list}. ${entry.source} applies.`,
					"warning",
					"schema-cell-option-conflict",
				);
			}
			if (line.value === undefined || line.valueRange === undefined) {
				continue;
			}
			const findings = validateInlineValue(
				line.key,
				line.value,
				entry.descriptor,
				findInlineReplacement(entry.descriptor, written, (name) => resolveElementAttribute(options, name)?.descriptor),
				"Option",
			);
			for (const finding of findings) {
				const keyLevel = finding.code === "schema-deprecated" || finding.code === "schema-required-missing";
				report(keyLevel ? line.keyRange : line.valueRange, finding.message, finding.severity, finding.code);
			}
		}

		for (const [name, { descriptor }] of Object.entries(options)) {
			if (descriptor.required && ![name, ...(descriptor.aliases ?? [])].some((key) => key in written)) {
				report(
					{ start: block.fenceStart, end: block.fenceStart + 1 },
					`Required option "${name}" is missing.`,
					"error",
					"schema-required-missing",
				);
			}
		}
	}

	private validateElementBlock(
		block: BlockMatch,
		text: string,
		schemas: ElementAttributeSchemas,
		document: vscode.TextDocument,
		diagnostics: vscode.Diagnostic[],
		codeBlockRanges: readonly TextRange[],
		reportUnknown: boolean,
	): void {
		// Use the parser as a context filter: the offset just inside the closing `}`.
		const blockEndOffset = block.contentOffset + block.content.length;
		const parsed = parseAttributeAtPosition(text, blockEndOffset, codeBlockRanges);
		if (!parsed) {
			return;
		}

		const applicable = mergeApplicableAttributes(schemas, parsed.classes, parsed.ids, parsed.elementType);
		if (Object.keys(applicable).length === 0) {
			return;
		}

		// Validate required attributes.
		for (const [attrName, { descriptor }] of Object.entries(applicable)) {
			if (descriptor.required && !(attrName in parsed.attributes)) {
				// Check aliases too.
				const aliasPresent = descriptor.aliases?.some((a) => a in parsed.attributes);
				if (!aliasPresent) {
					const startPos = document.positionAt(block.matchStart);
					const endPos = document.positionAt(block.matchStart + 1);
					const range = new vscode.Range(startPos, endPos);
					const diagnostic = new vscode.Diagnostic(
						range,
						`Required attribute "${attrName}" is missing.`,
						vscode.DiagnosticSeverity.Error,
					);
					diagnostic.code = "schema-required-missing";
					diagnostic.source = "quarto-wizard";
					diagnostics.push(diagnostic);
				}
			}
		}

		// Validate each attribute value.
		for (const [key, value] of Object.entries(parsed.attributes)) {
			const entry = resolveElementAttribute(applicable, key);
			if (!entry) {
				if (!reportUnknown) {
					continue;
				}
				// Unknown attribute (opt-in via quartoWizard.lint.unknownAttributes).
				const kv = findKeyValueOffset(block.content, key);
				if (kv) {
					const absStart = block.contentOffset + kv.keyStart;
					const absEnd = block.contentOffset + kv.keyEnd;
					const range = new vscode.Range(document.positionAt(absStart), document.positionAt(absEnd));
					const diagnostic = new vscode.Diagnostic(
						range,
						`Unknown attribute "${key}".`,
						vscode.DiagnosticSeverity.Information,
					);
					diagnostic.code = "schema-unknown-attribute";
					diagnostic.source = "quarto-wizard";
					diagnostics.push(diagnostic);
				}
				continue;
			}

			const findings = validateInlineValue(
				key,
				value,
				entry.descriptor,
				findInlineReplacement(
					entry.descriptor,
					parsed.attributes,
					(name) => resolveElementAttribute(applicable, name)?.descriptor,
				),
			);
			if (findings.length === 0) {
				continue;
			}

			const kv = findKeyValueOffset(block.content, key);
			if (!kv) {
				continue;
			}

			appendKeyValueDiagnostics(findings, kv, block, document, diagnostics);
		}

		// Validate bare words that match known attribute names.
		const bareWords = extractBareWords(block.content);
		for (const bw of bareWords) {
			const entry = resolveElementAttribute(applicable, bw.word);
			if (!entry) {
				continue;
			}
			const absStart = block.contentOffset + bw.start;
			const absEnd = block.contentOffset + bw.end;
			const range = new vscode.Range(document.positionAt(absStart), document.positionAt(absEnd));
			const diagnostic = new vscode.Diagnostic(
				range,
				`Attribute "${bw.word}" requires a value assignment. Use ${bw.word}="value".`,
				vscode.DiagnosticSeverity.Warning,
			);
			diagnostic.code = BARE_ATTRIBUTE_CODE;
			diagnostic.source = "quarto-wizard";
			diagnostics.push(diagnostic);
		}
	}

	private validateShortcodeBlock(
		block: BlockMatch,
		text: string,
		schemas: Map<string, ShortcodeSchema>,
		document: vscode.TextDocument,
		diagnostics: vscode.Diagnostic[],
		codeBlockRanges: readonly TextRange[],
	): void {
		// Use the parser as a context filter.
		const blockEndOffset = block.contentOffset + block.content.length;
		const parsed = parseShortcodeAtPosition(text, blockEndOffset, codeBlockRanges);
		if (!parsed || !parsed.name) {
			return;
		}

		const schema = schemas.get(parsed.name);
		if (!schema) {
			return;
		}

		// Validate named attributes.
		if (schema.attributes) {
			// Validate required attributes.
			for (const [attrName, descriptor] of Object.entries(schema.attributes)) {
				if (descriptor.required && !(attrName in parsed.attributes)) {
					const aliasPresent = descriptor.aliases?.some((a) => a in parsed.attributes);
					if (!aliasPresent) {
						const startPos = document.positionAt(block.matchStart);
						const endPos = document.positionAt(block.matchStart + 3);
						const range = new vscode.Range(startPos, endPos);
						const diagnostic = new vscode.Diagnostic(
							range,
							`Required attribute "${attrName}" is missing.`,
							vscode.DiagnosticSeverity.Error,
						);
						diagnostic.code = "schema-required-missing";
						diagnostic.source = "quarto-wizard";
						diagnostics.push(diagnostic);
					}
				}
			}

			for (const [key, value] of Object.entries(parsed.attributes)) {
				const descriptor = resolveShortcodeAttribute(schema, key);
				if (!descriptor) {
					// Shortcodes may pass through unknown keys; skip.
					continue;
				}

				const findings = validateInlineValue(
					key,
					value,
					descriptor,
					findInlineReplacement(descriptor, parsed.attributes, (name) => resolveShortcodeAttribute(schema, name)),
				);
				if (findings.length === 0) {
					continue;
				}

				const kv = findKeyValueOffset(block.content, key);
				if (!kv) {
					continue;
				}

				appendKeyValueDiagnostics(findings, kv, block, document, diagnostics);
			}
		}

		// Validate positional arguments.
		if (schema.arguments) {
			for (let i = 0; i < parsed.arguments.length && i < schema.arguments.length; i++) {
				const argDescriptor = schema.arguments[i];
				const argValue = parsed.arguments[i];
				const argName = argDescriptor.name || `argument ${i + 1}`;

				const findings = validateInlineValue(argName, argValue, argDescriptor);
				if (findings.length === 0) {
					continue;
				}

				const argOffset = findArgumentOffset(block.content, i);
				if (!argOffset) {
					continue;
				}

				for (const finding of findings) {
					const absStart = block.contentOffset + argOffset.start;
					const absEnd = block.contentOffset + argOffset.end;
					const range = new vscode.Range(document.positionAt(absStart), document.positionAt(absEnd));
					const diagnostic = new vscode.Diagnostic(range, finding.message, toVsSeverity(finding.severity));
					diagnostic.code = finding.code;
					diagnostic.source = "quarto-wizard";
					diagnostics.push(diagnostic);
				}
			}
		}

		// Validate positional arguments beyond defined slots that match
		// known attribute names (bare words used as attributes).
		if (schema.attributes) {
			const positionalSlots = schema.arguments?.length ?? 0;
			for (let i = positionalSlots; i < parsed.arguments.length; i++) {
				const argValue = parsed.arguments[i];
				const descriptor = resolveShortcodeAttribute(schema, argValue);
				if (!descriptor) {
					continue;
				}

				const argOffset = findArgumentOffset(block.content, i);
				if (!argOffset) {
					continue;
				}

				const absStart = block.contentOffset + argOffset.start;
				const absEnd = block.contentOffset + argOffset.end;
				const range = new vscode.Range(document.positionAt(absStart), document.positionAt(absEnd));
				const diagnostic = new vscode.Diagnostic(
					range,
					`Attribute "${argValue}" requires a value assignment. Use ${argValue}="value".`,
					vscode.DiagnosticSeverity.Warning,
				);
				diagnostic.code = BARE_ATTRIBUTE_CODE;
				diagnostic.source = "quarto-wizard";
				diagnostics.push(diagnostic);
			}
		}
	}
}

/**
 * Code action provider that offers quick fixes for syntax-level
 * diagnostics (spaces around `=`, empty-value assignments).
 */
export class InlineAttributeCodeActionProvider implements vscode.CodeActionProvider {
	static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

	provideCodeActions(
		document: vscode.TextDocument,
		_range: vscode.Range,
		context: vscode.CodeActionContext,
	): vscode.CodeAction[] {
		const actions: vscode.CodeAction[] = [];
		const relevant = context.diagnostics.filter(
			(d) => d.code === SPACES_AROUND_EQUALS_CODE || d.code === EMPTY_VALUE_CODE,
		);
		if (relevant.length === 0) {
			return actions;
		}

		const text = document.getText();
		const blocks = extractBlocks(text, getDocumentFencedBlocks(document, text));

		for (const diagnostic of relevant) {
			for (const block of blocks) {
				if (diagnostic.code === SPACES_AROUND_EQUALS_CODE) {
					this.addFixActions(
						document,
						diagnostic,
						actions,
						'Remove spaces around "="',
						findSpacesAroundEquals(block.content),
						block.contentOffset,
					);
				} else if (diagnostic.code === EMPTY_VALUE_CODE) {
					this.addFixActions(
						document,
						diagnostic,
						actions,
						undefined,
						findEmptyValueAssignments(block.content),
						block.contentOffset,
					);
				}
			}
		}

		return actions;
	}

	/**
	 * Add quick-fix code actions for findings that match the diagnostic range.
	 * When `title` is undefined, a dynamic label `Replace with <replacement>` is used.
	 */
	private addFixActions(
		document: vscode.TextDocument,
		diagnostic: vscode.Diagnostic,
		actions: vscode.CodeAction[],
		title: string | undefined,
		findings: readonly { start: number; replacement: string }[],
		contentOffset: number,
	): void {
		const diagStart = document.offsetAt(diagnostic.range.start);

		for (const finding of findings) {
			const absoluteStart = contentOffset + finding.start;
			if (absoluteStart !== diagStart) {
				continue;
			}

			const actionTitle = title ?? `Replace with ${finding.replacement}`;
			const action = new vscode.CodeAction(actionTitle, vscode.CodeActionKind.QuickFix);
			action.diagnostics = [diagnostic];
			action.isPreferred = true;

			const edit = new vscode.WorkspaceEdit();
			edit.replace(document.uri, diagnostic.range, finding.replacement);
			action.edit = edit;

			actions.push(action);
		}
	}
}

/**
 * Register the inline attribute diagnostics and code action providers.
 *
 * @param context - The extension context.
 * @param schemaCache - Shared schema cache instance.
 */
export function registerInlineAttributeDiagnostics(context: vscode.ExtensionContext, schemaCache: SchemaCache): void {
	const provider = new InlineAttributeDiagnosticsProvider(schemaCache);
	context.subscriptions.push(provider);

	const selector: vscode.DocumentSelector = { language: "quarto" };
	const codeActionProvider = vscode.languages.registerCodeActionsProvider(
		selector,
		new InlineAttributeCodeActionProvider(),
		{
			providedCodeActionKinds: InlineAttributeCodeActionProvider.providedCodeActionKinds,
		},
	);
	context.subscriptions.push(codeActionProvider);

	logMessage("Inline attribute diagnostics provider registered.", "debug");
}
