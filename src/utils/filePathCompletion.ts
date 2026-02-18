import * as vscode from "vscode";
import * as path from "path";
import type { FieldDescriptor } from "@quarto-wizard/schema";

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
	options?: { includeFolders?: boolean },
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
	const directories = options?.includeFolders ? new Set<string>() : null;

	for (const fileUri of files) {
		const relativePath = path.relative(documentDir, fileUri.fsPath).split(path.sep).join("/");
		const workspacePath = path.relative(workspaceRoot, fileUri.fsPath).split(path.sep).join("/");

		const item = new vscode.CompletionItem(relativePath, vscode.CompletionItemKind.File);
		item.detail = workspacePath;
		item.filterText = relativePath;
		item.sortText = "!2_" + relativePath;

		if (descriptor.description) {
			item.documentation = new vscode.MarkdownString(descriptor.description);
		}

		items.push(item);

		if (directories) {
			const dir = path.dirname(relativePath);
			if (dir !== ".") {
				const segments = dir.split("/");
				let cumulative = "";
				for (const segment of segments) {
					cumulative = cumulative ? `${cumulative}/${segment}` : segment;
					directories.add(cumulative);
				}
			}
		}
	}

	if (directories) {
		for (const dir of directories) {
			const label = `${dir}/`;
			const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Folder);
			item.filterText = label;
			item.sortText = "!2_" + label;
			item.command = { command: "editor.action.triggerSuggest", title: "Trigger Suggest" };
			items.push(item);
		}
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
