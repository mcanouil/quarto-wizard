import * as vscode from "vscode";
import type { SchemaCache, FieldDescriptor, DeprecatedSpec, ShortcodeSchema } from "@quarto-wizard/core";
import { parseAttributeAtPosition } from "../utils/elementAttributeParser";
import { parseShortcodeAtPosition } from "../utils/shortcodeParser";
import {
	type ElementAttributeSchemas,
	collectElementAttributeSchemas,
	mergeApplicableAttributes,
	resolveElementAttribute,
} from "./elementAttributeCompletionProvider";
import { collectShortcodeSchemas, resolveShortcodeAttribute } from "./shortcodeCompletionProvider";
import { logMessage } from "../utils/log";
import { debounce } from "../utils/debounce";

/**
 * Describes a span of unnecessary whitespace around an `=` sign
 * that should be removed.
 */
export interface SpaceAroundEquals {
	/** Start offset in the source text. */
	start: number;
	/** End offset (exclusive) in the source text. */
	end: number;
	/** The corrected text that should replace the range. */
	replacement: string;
}

/**
 * Find all occurrences of spaces around `=` in key-value assignments
 * within the given text.
 *
 * Tracks quoted strings (single and double, with backslash escaping)
 * so that `=` signs inside quoted values are not flagged.
 *
 * Returns one entry per assignment where spaces exist on either or
 * both sides of the `=`.
 */
export function findSpacesAroundEquals(text: string): SpaceAroundEquals[] {
	const results: SpaceAroundEquals[] = [];
	let i = 0;

	while (i < text.length) {
		const ch = text[i];

		// Skip quoted strings.
		if (ch === '"' || ch === "'") {
			i = skipQuotedString(text, i);
			continue;
		}

		if (ch !== "=") {
			i++;
			continue;
		}

		// We found an `=` outside of quotes.
		// Look backward for trailing spaces after an identifier.
		let spacesBefore = 0;
		let j = i - 1;
		while (j >= 0 && text[j] === " ") {
			spacesBefore++;
			j--;
		}

		// The character before the spaces must be a word character
		// (part of an identifier) for this to be a key-value assignment.
		if (j < 0 || !/[\w-]/.test(text[j])) {
			i++;
			continue;
		}

		// Look forward for leading spaces before the value.
		let spacesAfter = 0;
		let k = i + 1;
		while (k < text.length && text[k] === " ") {
			spacesAfter++;
			k++;
		}

		// There must be a value character after the spaces (or a quote).
		if (k >= text.length) {
			i++;
			continue;
		}

		if (spacesBefore === 0 && spacesAfter === 0) {
			i++;
			continue;
		}

		// Build the identifier preceding the spaces.
		const idEnd = j + 1;
		let idStart = idEnd;
		while (idStart > 0 && /[\w-]/.test(text[idStart - 1])) {
			idStart--;
		}
		const identifier = text.slice(idStart, idEnd);

		// The replacement collapses spaces: `identifier=`.
		// We include the identifier and `=` but not the value so that
		// the replacement range is self-contained.
		const rangeStart = idStart;
		const rangeEnd = k;
		const replacement = `${identifier}=`;

		results.push({ start: rangeStart, end: rangeEnd, replacement });

		i = k;
	}

	return results;
}

/**
 * Advance past a quoted string, handling backslash escapes.
 * Returns the index after the closing quote (or end of text).
 */
function skipQuotedString(text: string, start: number): number {
	const quote = text[start];
	let i = start + 1;
	while (i < text.length) {
		if (text[i] === "\\") {
			i += 2;
			continue;
		}
		if (text[i] === quote) {
			return i + 1;
		}
		i++;
	}
	return i;
}

/**
 * Pattern for Pandoc element attribute blocks:
 * - Span: `]{...}`
 * - Code: `` `...`{...} ``
 * - Div: `:::{...}` or `::: {...}`
 * - Header: `# ... {...}`
 */
const ELEMENT_ATTRIBUTE_RE = /\{[^}]*\}/g;

/**
 * Pattern for Quarto shortcode blocks: `{{< ... >}}`
 */
const SHORTCODE_RE = /\{\{<[^>]*>\}\}/g;

interface BlockMatch {
	content: string;
	contentOffset: number;
	type: "element" | "shortcode";
	/** Absolute offset of the full match start (the opening delimiter). */
	matchStart: number;
}

/**
 * Extract all attribute blocks and shortcode blocks from document text.
 */
function extractBlocks(text: string): BlockMatch[] {
	const blocks: BlockMatch[] = [];

	for (const match of text.matchAll(ELEMENT_ATTRIBUTE_RE)) {
		if (match.index === undefined) {
			continue;
		}
		// Content is everything between { and }.
		const content = match[0].slice(1, -1);
		const contentOffset = match.index + 1;
		blocks.push({ content, contentOffset, type: "element", matchStart: match.index });
	}

	for (const match of text.matchAll(SHORTCODE_RE)) {
		if (match.index === undefined) {
			continue;
		}
		// Content is everything between {{< and >}}.
		const content = match[0].slice(3, -3);
		const contentOffset = match.index + 3;
		blocks.push({ content, contentOffset, type: "shortcode", matchStart: match.index });
	}

	return blocks;
}

// ---------------------------------------------------------------------------
// Value-location helpers
// ---------------------------------------------------------------------------

/**
 * Offsets of a key=value pair within block content, relative to the content start.
 */
export interface KeyValueOffset {
	keyStart: number;
	keyEnd: number;
	valueStart: number;
	valueEnd: number;
}

/**
 * Locate a `key=value` or `key="value"` assignment within block content.
 * Walks character by character, skipping quoted strings, to avoid false matches.
 *
 * @returns Offsets relative to content start, or null if the key is not found.
 */
export function findKeyValueOffset(content: string, key: string): KeyValueOffset | null {
	let i = 0;

	while (i < content.length) {
		// Skip whitespace.
		while (i < content.length && /\s/.test(content[i])) {
			i++;
		}

		if (i >= content.length) {
			break;
		}

		// Skip class (.name) and id (#name) prefixes.
		if (content[i] === "." || content[i] === "#") {
			i++;
			while (i < content.length && /[\w-]/.test(content[i])) {
				i++;
			}
			continue;
		}

		// Read a word token.
		const wordStart = i;
		while (i < content.length && /[\w-]/.test(content[i])) {
			i++;
		}

		if (i === wordStart) {
			// Not a word character; skip quoted strings or other characters.
			if (content[i] === '"' || content[i] === "'") {
				i = skipQuotedString(content, i);
			} else {
				i++;
			}
			continue;
		}

		const word = content.slice(wordStart, i);

		// Check for `=`.
		if (i < content.length && content[i] === "=") {
			const eqPos = i;
			i++; // skip =

			// Read value.
			let valueStart: number;
			let valueEnd: number;

			if (i < content.length && content[i] === '"') {
				// Quoted value: include the quotes in the range.
				valueStart = i;
				i++; // skip opening quote
				while (i < content.length && content[i] !== '"') {
					if (content[i] === "\\" && i + 1 < content.length) {
						i++;
					}
					i++;
				}
				if (i < content.length) {
					i++; // skip closing quote
				}
				valueEnd = i;
			} else {
				// Unquoted value.
				valueStart = i;
				while (i < content.length && !/\s/.test(content[i])) {
					i++;
				}
				valueEnd = i;
			}

			if (word === key) {
				return {
					keyStart: wordStart,
					keyEnd: eqPos,
					valueStart,
					valueEnd,
				};
			}
		}
		// Otherwise word without = (positional argument); continue.
	}

	return null;
}

/**
 * Offsets of a positional argument within shortcode content.
 */
export interface ArgumentOffset {
	start: number;
	end: number;
}

/**
 * Locate the Nth positional argument token in shortcode content.
 * Skips the shortcode name (first token) and any key=value pairs.
 *
 * @returns Offsets relative to content start, or null if index is out of range.
 */
export function findArgumentOffset(content: string, argIndex: number): ArgumentOffset | null {
	let i = 0;
	let positionalCount = 0;
	let isFirst = true;

	while (i < content.length) {
		// Skip whitespace.
		while (i < content.length && /\s/.test(content[i])) {
			i++;
		}

		if (i >= content.length) {
			break;
		}

		// Read a token.
		const tokenStart = i;

		if (content[i] === '"') {
			// Quoted token.
			i++; // skip opening quote
			while (i < content.length && content[i] !== '"') {
				if (content[i] === "\\" && i + 1 < content.length) {
					i++;
				}
				i++;
			}
			if (i < content.length) {
				i++; // skip closing quote
			}
		} else {
			// Unquoted token: read until whitespace.
			while (i < content.length && !/\s/.test(content[i])) {
				if (content[i] === "=" && i > tokenStart) {
					// This is a key=value; skip the value part.
					i++; // skip =
					if (i < content.length && content[i] === '"') {
						i++;
						while (i < content.length && content[i] !== '"') {
							if (content[i] === "\\" && i + 1 < content.length) {
								i++;
							}
							i++;
						}
						if (i < content.length) {
							i++;
						}
					} else {
						while (i < content.length && !/\s/.test(content[i])) {
							i++;
						}
					}
					break;
				}
				i++;
			}
		}

		const tokenEnd = i;
		const token = content.slice(tokenStart, tokenEnd);

		// The first token is the shortcode name; skip it.
		if (isFirst) {
			isFirst = false;
			continue;
		}

		// Skip key=value tokens (they contain = after the first char).
		if (token.includes("=")) {
			continue;
		}

		// This is a positional argument.
		if (positionalCount === argIndex) {
			return { start: tokenStart, end: tokenEnd };
		}
		positionalCount++;
	}

	return null;
}

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
 * Validate a single inline attribute value against a field descriptor.
 *
 * All inline values are strings, so type checking requires coercion.
 * Types that cannot be represented inline (array, object, content) are skipped.
 *
 * @returns An array of findings (may be empty if valid).
 */
export function validateInlineValue(
	key: string,
	value: string,
	descriptor: FieldDescriptor,
): InlineValidationFinding[] {
	const findings: InlineValidationFinding[] = [];

	// Deprecated check.
	if (descriptor.deprecated) {
		findings.push({
			message: buildDeprecatedMessage(key, descriptor.deprecated),
			severity: "warning",
			code: "schema-deprecated",
		});
	}

	// Type check (coerce from string).
	if (descriptor.type) {
		switch (descriptor.type) {
			case "number": {
				const num = Number(value);
				if (!Number.isFinite(num)) {
					findings.push({
						message: `Attribute "${key}": expected type "number", got string "${value}".`,
						severity: "error",
						code: "schema-type-mismatch",
					});
					return findings;
				}
				break;
			}
			case "boolean": {
				const lower = value.toLowerCase();
				if (lower !== "true" && lower !== "false") {
					findings.push({
						message: `Attribute "${key}": expected type "boolean" ("true" or "false"), got string "${value}".`,
						severity: "error",
						code: "schema-type-mismatch",
					});
					return findings;
				}
				break;
			}
			case "string":
				// Always valid.
				break;
			case "array":
			case "object":
			case "content":
				// Not representable inline; skip all further checks.
				return findings;
		}
	}

	// Enum check.
	if (descriptor.enum) {
		const match = descriptor.enumCaseInsensitive
			? descriptor.enum.some((v) => String(v).toLowerCase() === value.toLowerCase())
			: descriptor.enum.some((v) => String(v) === value);
		if (!match) {
			findings.push({
				message: `Attribute "${key}": value "${value}" is not in the allowed values (${descriptor.enum.map(String).join(", ")}).`,
				severity: "error",
				code: "schema-enum-invalid",
			});
		}
	}

	// Numeric range check (only when value coerces to a number).
	const numericValue = Number(value);
	if (Number.isFinite(numericValue)) {
		if (descriptor.min !== undefined && numericValue < descriptor.min) {
			findings.push({
				message: `Attribute "${key}": value ${numericValue} is below the minimum of ${descriptor.min}.`,
				severity: "error",
				code: "schema-range",
			});
		}
		if (descriptor.max !== undefined && numericValue > descriptor.max) {
			findings.push({
				message: `Attribute "${key}": value ${numericValue} exceeds the maximum of ${descriptor.max}.`,
				severity: "error",
				code: "schema-range",
			});
		}
	}

	// Pattern check (skip patterns exceeding 1024 chars to mitigate ReDoS risk).
	if (descriptor.pattern && descriptor.pattern.length <= 1024) {
		try {
			const regex = descriptor.patternExact ? new RegExp(`^${descriptor.pattern}$`) : new RegExp(descriptor.pattern);
			if (!regex.test(value)) {
				findings.push({
					message: `Attribute "${key}": value "${value}" does not match the required pattern "${descriptor.pattern}".`,
					severity: "error",
					code: "schema-pattern",
				});
			}
		} catch {
			// Invalid regex in schema; skip validation.
		}
	}

	// String length checks.
	if (descriptor.minLength !== undefined && value.length < descriptor.minLength) {
		findings.push({
			message: `Attribute "${key}": value length ${value.length} is below the minimum of ${descriptor.minLength}.`,
			severity: "error",
			code: "schema-length",
		});
	}
	if (descriptor.maxLength !== undefined && value.length > descriptor.maxLength) {
		findings.push({
			message: `Attribute "${key}": value length ${value.length} exceeds the maximum of ${descriptor.maxLength}.`,
			severity: "error",
			code: "schema-length",
		});
	}

	return findings;
}

/**
 * Build a human-readable deprecation message matching the YAML provider's logic.
 */
function buildDeprecatedMessage(key: string, deprecated: boolean | string | DeprecatedSpec): string {
	if (typeof deprecated === "string") {
		return `Attribute "${key}" is deprecated: ${deprecated}.`;
	}
	if (typeof deprecated === "object") {
		const parts = [`Attribute "${key}" is deprecated`];
		if (deprecated.since) {
			parts[0] += ` since ${deprecated.since}`;
		}
		if (deprecated.message) {
			parts.push(deprecated.message);
		} else if (deprecated.replaceWith) {
			parts.push(`Use "${deprecated.replaceWith}" instead.`);
		}
		return parts.join(". ") + (parts[parts.length - 1].endsWith(".") ? "" : ".");
	}
	return `Attribute "${key}" is deprecated.`;
}

// ---------------------------------------------------------------------------
// Diagnostic codes
// ---------------------------------------------------------------------------

const DIAGNOSTIC_CODE = "spaces-around-equals";

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

	private isRelevantDocument(document: vscode.TextDocument): boolean {
		return document.languageId === "quarto" || document.fileName.endsWith(".qmd");
	}

	private async validateDocument(document: vscode.TextDocument): Promise<void> {
		const version = ++this.validationVersion;
		const text = document.getText();
		const blocks = extractBlocks(text);
		const diagnostics: vscode.Diagnostic[] = [];

		// Phase 1: spaces-around-equals (synchronous, always runs).
		for (const block of blocks) {
			const findings = findSpacesAroundEquals(block.content);

			for (const finding of findings) {
				const absoluteStart = block.contentOffset + finding.start;
				const absoluteEnd = block.contentOffset + finding.end;

				const startPos = document.positionAt(absoluteStart);
				const endPos = document.positionAt(absoluteEnd);
				const range = new vscode.Range(startPos, endPos);

				const diagnostic = new vscode.Diagnostic(
					range,
					'Remove spaces around "=" in attribute assignment.',
					vscode.DiagnosticSeverity.Error,
				);
				diagnostic.code = DIAGNOSTIC_CODE;
				diagnostic.source = "quarto-wizard";

				diagnostics.push(diagnostic);
			}
		}

		// Phase 2: schema-based validation (async).
		try {
			const [elementSchemas, shortcodeSchemas] = await Promise.all([
				collectElementAttributeSchemas(this.schemaCache),
				collectShortcodeSchemas(this.schemaCache),
			]);

			// A newer validation was started while we awaited; discard this result.
			if (version !== this.validationVersion) {
				return;
			}

			const hasElementSchemas = Object.keys(elementSchemas).length > 0;
			const hasShortcodeSchemas = shortcodeSchemas.size > 0;

			if (hasElementSchemas || hasShortcodeSchemas) {
				for (const block of blocks) {
					if (block.type === "element" && hasElementSchemas) {
						this.validateElementBlock(block, text, elementSchemas, document, diagnostics);
					} else if (block.type === "shortcode" && hasShortcodeSchemas) {
						this.validateShortcodeBlock(block, text, shortcodeSchemas, document, diagnostics);
					}
				}
			}
		} catch (error) {
			logMessage(`Inline schema validation error: ${error instanceof Error ? error.message : String(error)}.`, "warn");
		}

		this.diagnosticCollection.set(document.uri, diagnostics);
	}

	private validateElementBlock(
		block: BlockMatch,
		text: string,
		schemas: ElementAttributeSchemas,
		document: vscode.TextDocument,
		diagnostics: vscode.Diagnostic[],
	): void {
		// Use the parser as a context filter: the offset just inside the closing `}`.
		const blockEndOffset = block.contentOffset + block.content.length;
		const parsed = parseAttributeAtPosition(text, blockEndOffset);
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
				// Unknown attribute.
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

			const findings = validateInlineValue(key, value, entry.descriptor);
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

	private validateShortcodeBlock(
		block: BlockMatch,
		text: string,
		schemas: Map<string, ShortcodeSchema>,
		document: vscode.TextDocument,
		diagnostics: vscode.Diagnostic[],
	): void {
		// Use the parser as a context filter.
		const blockEndOffset = block.contentOffset + block.content.length;
		const parsed = parseShortcodeAtPosition(text, blockEndOffset);
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

				const findings = validateInlineValue(key, value, descriptor);
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
	}
}

/**
 * Code action provider that offers quick fixes for
 * `spaces-around-equals` diagnostics.
 */
export class InlineAttributeCodeActionProvider implements vscode.CodeActionProvider {
	static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

	provideCodeActions(
		document: vscode.TextDocument,
		_range: vscode.Range,
		context: vscode.CodeActionContext,
	): vscode.CodeAction[] {
		const actions: vscode.CodeAction[] = [];

		for (const diagnostic of context.diagnostics) {
			if (diagnostic.code !== DIAGNOSTIC_CODE) {
				continue;
			}

			const text = document.getText();
			const blocks = extractBlocks(text);

			// Find the matching finding for this diagnostic range.
			const diagStart = document.offsetAt(diagnostic.range.start);

			for (const block of blocks) {
				const findings = findSpacesAroundEquals(block.content);
				for (const finding of findings) {
					const absoluteStart = block.contentOffset + finding.start;
					if (absoluteStart !== diagStart) {
						continue;
					}

					const action = new vscode.CodeAction('Remove spaces around "="', vscode.CodeActionKind.QuickFix);
					action.diagnostics = [diagnostic];
					action.isPreferred = true;

					const edit = new vscode.WorkspaceEdit();
					edit.replace(document.uri, diagnostic.range, finding.replacement);
					action.edit = edit;

					actions.push(action);
				}
			}
		}

		return actions;
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
