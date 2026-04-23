import * as vscode from "vscode";
import { discoverQuartoProjectRoots, type QuartoProjectRoot } from "./quartoProjectDiscovery";

/**
 * Quick pick item used when prompting the user to choose between detected Quarto project roots.
 */
interface ProjectRootQuickPickItem extends vscode.QuickPickItem {
	root: QuartoProjectRoot;
}

/**
 * Resolves the Quarto project root the user wants to act on.
 *
 * The candidate list comes from {@link discoverQuartoProjectRoots}, so the returned path is
 * either a workspace folder root or a detected sub-folder containing `_quarto.{yml,yaml}`,
 * depending on the `quartoWizard.autoProjectDetection` setting.
 *
 * @returns The selected project root path, or `undefined` if no workspace folder is open or the
 *          user dismissed the picker.
 */
export async function selectWorkspaceFolder(): Promise<string | undefined> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		return undefined;
	}

	const roots = await discoverQuartoProjectRoots(workspaceFolders);
	if (roots.length === 0) {
		return undefined;
	}

	if (roots.length === 1) {
		return roots[0].fsPath;
	}

	const items: ProjectRootQuickPickItem[] = roots.map((root) => ({
		label: root.label,
		description: root.fsPath,
		root,
	}));

	const picked = await vscode.window.showQuickPick(items, {
		placeHolder: "Select a Quarto project folder",
		ignoreFocusOut: true,
		matchOnDescription: true,
	});

	return picked?.root.fsPath;
}
