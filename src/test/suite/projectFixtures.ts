import * as path from "node:path";
import * as vscode from "vscode";
import type { EmbeddingParent } from "@quarto-wizard/core";
import type { EmbeddedExtensionRoot, OwningProjectRoot } from "../../utils/quartoProjectDiscovery";

export function makeFolder(name: string, fsPath: string, index = 0): vscode.WorkspaceFolder {
	return { uri: vscode.Uri.file(fsPath), name, index };
}

export function makeRoot(folder: vscode.WorkspaceFolder, ...subPath: string[]): OwningProjectRoot {
	const fsPath = subPath.length === 0 ? folder.uri.fsPath : path.join(folder.uri.fsPath, ...subPath);
	const relative = subPath.join("/");
	const label = relative.length === 0 ? folder.name : `${folder.name}/${relative}`;
	return {
		kind: "project",
		fsPath,
		workspaceFolder: folder,
		label,
		relativePath: relative || ".",
		quartoIgnored: false,
		readOnly: false,
	};
}

export function makeEmbeddedRoot(
	folder: vscode.WorkspaceFolder,
	embeddedIn: EmbeddingParent,
	...subPath: string[]
): EmbeddedExtensionRoot {
	return {
		...makeRoot(folder, ...subPath),
		kind: "embedded",
		embeddedIn,
		readOnly: embeddedIn.source !== undefined,
	};
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
