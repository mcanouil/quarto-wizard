import * as vscode from "vscode";
import * as path from "path";
import type { FieldDescriptor } from "@quarto-wizard/core";

/**
 * Whether a field descriptor declares file-path completion.
 */
export function isFilePathDescriptor(descriptor: FieldDescriptor): boolean {
	return descriptor.completion?.type === "file";
}

/**
 * Build file-path completion items for a descriptor with `completion.type === "file"`.
 * Searches the workspace for files matching the optional `extensions` filter.
 *
 * @param descriptor - Field descriptor with a file-path completion spec.
 * @param documentUri - URI of the document requesting completions (used to resolve the workspace folder).
 * @returns Completion items for matching workspace files.
 */
export async function buildFilePathCompletions(
	descriptor: FieldDescriptor,
	documentUri: vscode.Uri,
): Promise<vscode.CompletionItem[]> {
	if (!isFilePathDescriptor(descriptor)) {
		return [];
	}

	const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
	if (!workspaceFolder) {
		return [];
	}

	const extensions = descriptor.completion?.extensions;
	const pattern = buildGlobPattern(extensions);
	const relativePattern = new vscode.RelativePattern(workspaceFolder, pattern);

	const files = await vscode.workspace.findFiles(relativePattern, "**/node_modules/**", 1000);

	const items: vscode.CompletionItem[] = [];
	const workspaceRoot = workspaceFolder.uri.fsPath;
	const documentDir = path.dirname(documentUri.fsPath);

	for (const fileUri of files) {
		const relativePath = path.relative(documentDir, fileUri.fsPath);
		const workspacePath = path.relative(workspaceRoot, fileUri.fsPath);

		const item = new vscode.CompletionItem(relativePath, vscode.CompletionItemKind.File);
		item.detail = workspacePath;
		item.sortText = relativePath;

		if (descriptor.description) {
			item.documentation = new vscode.MarkdownString(descriptor.description);
		}

		items.push(item);
	}

	return items;
}

/**
 * Build a glob pattern from an optional list of file extensions.
 * When no extensions are specified, matches all files.
 */
function buildGlobPattern(extensions: string[] | undefined): string {
	if (!extensions || extensions.length === 0) {
		return "**/*";
	}

	// Strip leading dots and build a brace-expansion pattern.
	const stripped = extensions.map((ext) => ext.replace(/^\./, ""));

	if (stripped.length === 1) {
		return `**/*.${stripped[0]}`;
	}

	return `**/*.{${stripped.join(",")}}`;
}
