import * as vscode from "vscode";
import type { SnippetCache, SnippetDefinition } from "@quarto-wizard/snippets";
import { snippetNamespace, qualifySnippetPrefix } from "@quarto-wizard/snippets";
import { discoverInstalledExtensions } from "@quarto-wizard/core";
import { logMessage } from "../utils/log";

/**
 * Provides snippet completions from installed Quarto extensions.
 *
 * Snippets are read from _snippets.json files in extension directories
 * and offered as IntelliSense completions in Quarto documents.
 * Each snippet prefix is qualified with the extension namespace to
 * prevent collisions (e.g., "mcanouil-iconify:iconify").
 */
class SnippetCompletionProvider implements vscode.CompletionItemProvider {
	private snippetCache: SnippetCache;

	constructor(snippetCache: SnippetCache) {
		this.snippetCache = snippetCache;
	}

	async provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
	): Promise<vscode.CompletionItem[] | null> {
		try {
			// Suppress suggestions when cursor is mid-token (same heuristic as shortcode provider)
			const text = document.getText();
			const offset = document.offsetAt(position);
			if (offset < text.length && /[\w"']/.test(text[offset])) {
				return null;
			}

			const items = await this.collectAllSnippets();
			if (items.length === 0) {
				return null;
			}
			return items;
		} catch (error) {
			logMessage(`Snippet completion error: ${error instanceof Error ? error.message : String(error)}.`, "warn");
			return null;
		}
	}

	private async collectAllSnippets(): Promise<vscode.CompletionItem[]> {
		const items: vscode.CompletionItem[] = [];
		const workspaceFolders = vscode.workspace.workspaceFolders;

		if (!workspaceFolders) {
			return items;
		}

		for (const folder of workspaceFolders) {
			try {
				const extensions = await discoverInstalledExtensions(folder.uri.fsPath);

				for (const ext of extensions) {
					const snippets = this.snippetCache.get(ext.directory);
					if (!snippets) {
						continue;
					}

					const namespace = snippetNamespace(ext.id);

					for (const [name, snippet] of Object.entries(snippets)) {
						const prefixes = Array.isArray(snippet.prefix) ? snippet.prefix : [snippet.prefix];

						for (const rawPrefix of prefixes) {
							const qualifiedPrefix = qualifySnippetPrefix(namespace, rawPrefix);
							const item = this.buildCompletionItem(name, snippet, qualifiedPrefix, ext.id.name);
							items.push(item);
						}
					}
				}
			} catch (error) {
				logMessage(
					`Failed to discover snippets in ${folder.uri.fsPath}: ${error instanceof Error ? error.message : String(error)}.`,
					"warn",
				);
			}
		}

		return items;
	}

	private buildCompletionItem(
		name: string,
		snippet: SnippetDefinition,
		qualifiedPrefix: string,
		extensionName: string,
	): vscode.CompletionItem {
		const item = new vscode.CompletionItem(qualifiedPrefix, vscode.CompletionItemKind.Snippet);

		const body = Array.isArray(snippet.body) ? snippet.body.join("\n") : snippet.body;
		item.insertText = new vscode.SnippetString(body);

		item.detail = `${name} (${extensionName})`;

		if (snippet.description) {
			item.documentation = new vscode.MarkdownString(snippet.description);
		}

		item.sortText = `~snippet_${qualifiedPrefix}`;

		return item;
	}
}

/**
 * Register the snippet completion provider for Quarto documents.
 *
 * @param context - The extension context.
 * @param snippetCache - Shared snippet cache instance.
 */
export function registerSnippetCompletionProvider(context: vscode.ExtensionContext, snippetCache: SnippetCache): void {
	const selector: vscode.DocumentSelector = { language: "quarto" };
	const provider = new SnippetCompletionProvider(snippetCache);
	const disposable = vscode.languages.registerCompletionItemProvider(selector, provider);
	context.subscriptions.push(disposable);

	logMessage("Snippet completion provider registered.", "debug");
}
