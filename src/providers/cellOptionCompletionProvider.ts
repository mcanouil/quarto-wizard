import * as vscode from "vscode";
import type { SchemaCache } from "@quarto-wizard/schema";
import { getErrorMessage } from "@quarto-wizard/core";
import { cellLanguage, cellLanguageKey, cellOptionLineAt, readCellOptions } from "../utils/cellOptions";
import { getDocumentFencedBlocks } from "../utils/documentScan";
import { buildAttributeDoc } from "../utils/schemaDocumentation";
import type { FencedBlock } from "../utils/yamlPosition";
import { logMessage } from "../utils/log";
import { collectCellOptionSchemas } from "./cellOptionSchemas";
import {
	attributeKeyItems,
	attributeValueItems,
	firstDeclarations,
	resolveElementAttribute,
	type AttributeWithSource,
} from "./elementAttributeCompletionProvider";

const VALUE_CONTEXT = /^([A-Za-z0-9_-]+):\s+/;
const KEY_CONTEXT = /^[A-Za-z0-9_-]*$/;

interface CellContext {
	block: FencedBlock;
	language: string;
}

/**
 * The executable cell that holds the offset.
 * The body of a block starts after its opening fence line, so the info string is never inside it.
 */
function findCell(document: vscode.TextDocument, text: string, offset: number): CellContext | undefined {
	const block = getDocumentFencedBlocks(document, text).find(
		(candidate) => offset >= candidate.start && offset <= candidate.end,
	);
	if (!block) {
		return undefined;
	}
	const language = cellLanguage(block.info);
	if (!language) {
		return undefined;
	}
	return { block, language };
}

/**
 * The merged cell options of the installed extensions for a language, if any extension declares a `cells` group for it.
 */
async function findCellOptions(
	schemaCache: SchemaCache,
	language: string,
): Promise<Record<string, AttributeWithSource> | undefined> {
	const schemas = await collectCellOptionSchemas(schemaCache);
	const declarations = schemas[cellLanguageKey(language)];
	return declarations === undefined ? undefined : firstDeclarations(declarations);
}

/**
 * Provides autocompletion for comment-pipe options in executable cells (`//| key: value`).
 *
 * Completion is offered only on a line of the leading option run that already has
 * the prefix of the cell language and its pipe.
 */
export class CellOptionCompletionProvider implements vscode.CompletionItemProvider {
	constructor(private readonly schemaCache: SchemaCache) {}

	async provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
	): Promise<vscode.CompletionItem[] | null> {
		try {
			const text = document.getText();
			const offset = document.offsetAt(position);

			// The cursor is in the middle of an existing token and not at a boundary.
			if (offset < text.length && /[\w"']/.test(text[offset])) {
				return null;
			}

			const cell = findCell(document, text, offset);
			const line = cell && cellOptionLineAt(text, cell.block, cell.language, offset);
			if (!cell || !line) {
				return null;
			}
			const options = await findCellOptions(this.schemaCache, cell.language);
			if (!options) {
				return null;
			}

			const value = VALUE_CONTEXT.exec(line.typed);
			if (value) {
				const entry = resolveElementAttribute(options, value[1]);
				return entry ? await attributeValueItems(entry, document.uri) : null;
			}
			if (!KEY_CONTEXT.test(line.typed)) {
				return null;
			}

			const occupied = new Set<string>();
			for (const option of readCellOptions(text, cell.block, cell.language)) {
				if (option.keyRange.start < line.start || option.keyRange.start > offset) {
					occupied.add(option.key);
				}
			}
			return attributeKeyItems(options, occupied, ": ");
		} catch (error) {
			logMessage(`Cell option completion error: ${getErrorMessage(error)}.`, "warn");
			return null;
		}
	}
}

/**
 * Provides hover information for comment-pipe options in executable cells.
 */
export class CellOptionHoverProvider implements vscode.HoverProvider {
	constructor(private readonly schemaCache: SchemaCache) {}

	async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | null> {
		try {
			const text = document.getText();
			const offset = document.offsetAt(position);

			const cell = findCell(document, text, offset);
			if (!cell) {
				return null;
			}
			const option = readCellOptions(text, cell.block, cell.language).find(
				(candidate) =>
					(offset >= candidate.keyRange.start && offset <= candidate.keyRange.end) ||
					(candidate.valueRange !== undefined &&
						offset >= candidate.valueRange.start &&
						offset <= candidate.valueRange.end),
			);
			if (!option) {
				return null;
			}
			const options = await findCellOptions(this.schemaCache, cell.language);
			const entry = options && resolveElementAttribute(options, option.key);
			const docs = entry && buildAttributeDoc(entry.descriptor, entry.source);
			return docs ? new vscode.Hover(docs) : null;
		} catch (error) {
			logMessage(`Cell option hover error: ${getErrorMessage(error)}.`, "warn");
			return null;
		}
	}
}

/**
 * Register the cell option completion and hover providers.
 *
 * @param context - The extension context.
 * @param schemaCache - Shared schema cache instance.
 */
export function registerCellOptionProviders(context: vscode.ExtensionContext, schemaCache: SchemaCache): void {
	const selector: vscode.DocumentSelector = { language: "quarto" };

	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(selector, new CellOptionCompletionProvider(schemaCache), " ", "|"),
		vscode.languages.registerHoverProvider(selector, new CellOptionHoverProvider(schemaCache)),
	);

	logMessage("Cell option completion and hover providers registered.", "debug");
}
