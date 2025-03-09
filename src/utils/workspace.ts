import * as vscode from "vscode";

/**
 * Prompts the user to select a workspace folder if multiple workspace folders are detected.
 *
 * @returns {Promise<string | undefined>} - The selected workspace folder path or undefined if no selection is made.
 */
export async function selectWorkspaceFolder(): Promise<string | undefined> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		return undefined;
	}

	if (workspaceFolders.length === 1) {
		return workspaceFolders[0].uri.fsPath;
	}

	const selectedFolder = await vscode.window.showQuickPick(
		workspaceFolders.map((folder) => folder.name),
		{
			placeHolder: "Select a workspace folder",
		}
	);

	return selectedFolder ? workspaceFolders.find((folder) => folder.name === selectedFolder)?.uri.fsPath : undefined;
}
