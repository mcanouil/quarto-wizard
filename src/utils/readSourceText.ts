import * as path from "node:path";
import * as vscode from "vscode";

/**
 * A file read as text, preferring a copy open in the editor.
 *
 * An unsaved edit to `_quarto.yml`, to a `.typ` beside a block, or to a metadata
 * file drives the result the way an unsaved edit to the document itself does.
 */
export async function readSourceText(fsPath: string): Promise<string | undefined> {
	const target = path.normalize(fsPath);
	for (const open of vscode.workspace.textDocuments) {
		if (open.uri.scheme === "file" && path.normalize(open.uri.fsPath) === target) {
			return open.getText();
		}
	}
	try {
		const buffer = await vscode.workspace.fs.readFile(vscode.Uri.file(fsPath));
		return Buffer.from(buffer).toString("utf8");
	} catch {
		return undefined;
	}
}
