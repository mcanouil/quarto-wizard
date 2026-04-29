import * as path from "node:path";
import * as vscode from "vscode";
import type { QuartoProjectRoot } from "../../utils/quartoProjectDiscovery";

export function makeFolder(name: string, fsPath: string, index = 0): vscode.WorkspaceFolder {
	return { uri: vscode.Uri.file(fsPath), name, index };
}

export function makeRoot(folder: vscode.WorkspaceFolder, ...subPath: string[]): QuartoProjectRoot {
	const fsPath = subPath.length === 0 ? folder.uri.fsPath : path.join(folder.uri.fsPath, ...subPath);
	const relative = subPath.join("/");
	const label = relative.length === 0 ? folder.name : `${folder.name}/${relative}`;
	return { fsPath, workspaceFolder: folder, label };
}
