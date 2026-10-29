import * as path from "node:path";
import * as vscode from "vscode";
import type { EmbeddingParent } from "@quarto-wizard/core";
import { buildRoot, type EmbeddedExtensionRoot, type OwningProjectRoot } from "../../utils/quartoProjectDiscovery";

export function makeFolder(name: string, fsPath: string, index = 0): vscode.WorkspaceFolder {
	return { uri: vscode.Uri.file(fsPath), name, index };
}

function rootPaths(folder: vscode.WorkspaceFolder, subPath: string[]): [string, string] {
	const fsPath = subPath.length === 0 ? folder.uri.fsPath : path.join(folder.uri.fsPath, ...subPath);
	return [fsPath, subPath.join("/") || "."];
}

export function makeRoot(folder: vscode.WorkspaceFolder, ...subPath: string[]): OwningProjectRoot {
	return buildRoot(folder, ...rootPaths(folder, subPath), false);
}

export function makeEmbeddedRoot(
	folder: vscode.WorkspaceFolder,
	embeddedIn: EmbeddingParent,
	...subPath: string[]
): EmbeddedExtensionRoot {
	return buildRoot(folder, ...rootPaths(folder, subPath), false, embeddedIn);
}

export class FakeMemento implements vscode.Memento {
	private readonly values = new Map<string, unknown>();

	keys(): readonly string[] {
		return [...this.values.keys()];
	}

	get<T>(key: string, defaultValue?: T): T | undefined {
		return this.values.has(key) ? (this.values.get(key) as T) : defaultValue;
	}

	async update(key: string, value: unknown): Promise<void> {
		if (value === undefined) {
			this.values.delete(key);
		} else {
			this.values.set(key, value);
		}
	}
}
