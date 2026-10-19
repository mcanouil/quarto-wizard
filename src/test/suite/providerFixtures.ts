import * as path from "node:path";
import * as vscode from "vscode";
import { invalidateInstalledExtensionsCache } from "../../utils/installedExtensionsCache";
import { invalidateProjectRoots, setProjectRoots } from "../../utils/projectRootsRegistry";
import { invalidateWorkspaceSchemaIndex } from "../../utils/workspaceSchemaIndex";
import { makeRoot } from "./projectFixtures";

const FIXTURES = path.resolve(__dirname, "..", "..", "..", "test-fixtures", "providers");

/**
 * Point the project root registry at the provider fixture project, which holds
 * one installed extension (`acme/demo`) with a schema and snippets.
 * Pair with {@link releaseProviderProject}.
 */
export function useProviderProject(): void {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		throw new Error("The test workspace folder is missing; the provider fixtures need it.");
	}
	invalidateInstalledExtensionsCache();
	invalidateWorkspaceSchemaIndex();
	setProjectRoots([makeRoot(folder, "providers")]);
}

export function releaseProviderProject(): void {
	invalidateInstalledExtensionsCache();
	invalidateWorkspaceSchemaIndex();
	invalidateProjectRoots();
}

export async function openProviderFixture(name: string): Promise<vscode.TextDocument> {
	return vscode.workspace.openTextDocument(vscode.Uri.file(path.join(FIXTURES, name)));
}

/**
 * The position just after the first (or last) occurrence of `needle`.
 */
export function positionAfter(
	document: vscode.TextDocument,
	needle: string,
	which: "first" | "last" = "first",
): vscode.Position {
	const text = document.getText();
	const index = which === "first" ? text.indexOf(needle) : text.lastIndexOf(needle);
	if (index < 0) {
		throw new Error(`The fixture ${document.fileName} does not contain "${needle}".`);
	}
	return document.positionAt(index + needle.length);
}

/**
 * The position at the start of the first occurrence of `needle`, moved right
 * by `delta` characters.
 */
export function positionAt(document: vscode.TextDocument, needle: string, delta = 0): vscode.Position {
	const index = document.getText().indexOf(needle);
	if (index < 0) {
		throw new Error(`The fixture ${document.fileName} does not contain "${needle}".`);
	}
	return document.positionAt(index + delta);
}

/**
 * The position at the end of the line that follows the first line containing `needle`.
 */
export function endOfLineAfter(document: vscode.TextDocument, needle: string): vscode.Position {
	const found = positionAt(document, needle);
	return document.lineAt(found.line + 1).range.end;
}

export function labelOf(item: vscode.CompletionItem): string {
	return typeof item.label === "string" ? item.label : item.label.label;
}

export function labelsOf(items: readonly vscode.CompletionItem[] | undefined | null): string[] {
	return (items ?? []).map(labelOf);
}

export function hoverText(hover: vscode.Hover | null): string {
	if (!hover) {
		return "";
	}
	return hover.contents.map((content) => (typeof content === "string" ? content : content.value)).join("\n");
}
