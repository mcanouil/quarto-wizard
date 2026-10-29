import * as vscode from "vscode";
import type { QuartoProjectRoot } from "../utils/quartoProjectDiscovery";
import type { ProjectVisibility } from "../utils/projectVisibility";

const VIEW_ID = "quartoWizard.detectedProjects";
const SELECT_COMMAND = "quartoWizard.detectedProjects.select";
const SAVE_COMMAND = "quartoWizard.detectedProjects.saveToSettings";

type ProjectCounts = (fsPath: string) => { extensions: number; updates: number };

interface FolderNode {
	readonly kind: "folder";
	readonly folder: vscode.WorkspaceFolder;
	readonly roots: readonly QuartoProjectRoot[];
}

interface ProjectNode {
	readonly kind: "project";
	readonly root: QuartoProjectRoot;
}

export type DetectedProjectNode = FolderNode | ProjectNode;

function pluralise(count: number, singular: string): string {
	return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function projectName(root: QuartoProjectRoot): string {
	return root.relativePath === "." ? root.workspaceFolder.name : root.relativePath;
}

function projectDescription(root: QuartoProjectRoot, counts: { extensions: number; updates: number }): string {
	const parts = [pluralise(counts.extensions, "extension"), pluralise(counts.updates, "update")];
	if (root.quartoIgnored) {
		parts.push(".quartoignore");
	}
	if (root.embeddedIn) {
		parts.push("embedded");
	}
	return parts.join(" · ");
}

/**
 * Lists every detected Quarto project with a checkbox that shows or hides it in the Extensions Installed view.
 */
export class DetectedProjectsProvider implements vscode.TreeDataProvider<DetectedProjectNode> {
	private readonly emitter = new vscode.EventEmitter<void>();
	private roots: readonly QuartoProjectRoot[] = [];

	readonly onDidChangeTreeData: vscode.Event<void> = this.emitter.event;

	constructor(
		private readonly visibility: ProjectVisibility,
		private readonly counts: ProjectCounts,
	) {}

	setRoots(roots: readonly QuartoProjectRoot[]): void {
		this.roots = roots;
		this.emitter.fire();
	}

	refresh(): void {
		this.emitter.fire();
	}

	getChildren(element?: DetectedProjectNode): DetectedProjectNode[] {
		if (element?.kind === "project") {
			return [];
		}
		if (element) {
			return element.roots.map((root) => ({ kind: "project", root }));
		}
		const folders = new Map<string, FolderNode>();
		for (const root of this.roots) {
			const key = root.workspaceFolder.uri.toString();
			const existing = folders.get(key);
			folders.set(key, {
				kind: "folder",
				folder: root.workspaceFolder,
				roots: [...(existing?.roots ?? []), root],
			});
		}
		if (folders.size > 1) {
			return [...folders.values()];
		}
		return this.roots.map((root) => ({ kind: "project", root }));
	}

	getTreeItem(element: DetectedProjectNode): vscode.TreeItem {
		if (element.kind === "folder") {
			const item = new vscode.TreeItem(element.folder.name, vscode.TreeItemCollapsibleState.Expanded);
			item.iconPath = new vscode.ThemeIcon("root-folder");
			return item;
		}
		const { root } = element;
		const item = new vscode.TreeItem(projectName(root), vscode.TreeItemCollapsibleState.None);
		item.id = `${root.workspaceFolder.uri.toString()}#${root.relativePath}`;
		item.description = projectDescription(root, this.counts(root.fsPath));
		item.tooltip = root.fsPath;
		item.checkboxState = this.visibility.isVisible(root)
			? vscode.TreeItemCheckboxState.Checked
			: vscode.TreeItemCheckboxState.Unchecked;
		return item;
	}

	dispose(): void {
		this.emitter.dispose();
	}
}

interface ProjectPickItem extends vscode.QuickPickItem {
	readonly root: QuartoProjectRoot;
}

function showProjectPicker(visibility: ProjectVisibility, roots: readonly QuartoProjectRoot[]): void {
	const items: ProjectPickItem[] = roots.map((root) => ({
		label: projectName(root),
		description: root.workspaceFolder.name,
		detail: root.fsPath,
		root,
	}));
	const picker = vscode.window.createQuickPick<ProjectPickItem>();
	picker.canSelectMany = true;
	picker.title = "Select Projects to Show";
	picker.placeholder = "Tick the projects to show in the Extensions Installed view";
	picker.matchOnDescription = true;
	picker.items = items;
	picker.selectedItems = items.filter((item) => visibility.isVisible(item.root));
	picker.onDidAccept(() => {
		const selected = new Set(picker.selectedItems.map((item) => item.root));
		picker.hide();
		const toShow = roots.filter((root) => selected.has(root) && !visibility.isVisible(root));
		const toHide = roots.filter((root) => !selected.has(root) && visibility.isVisible(root));
		void (async () => {
			if (toShow.length > 0) {
				await visibility.setVisible(toShow, true);
			}
			if (toHide.length > 0) {
				await visibility.setVisible(toHide, false);
			}
		})();
	});
	picker.onDidHide(() => picker.dispose());
	picker.show();
}

/**
 * Registers the Detected Projects view, its checkbox handling, and its commands.
 */
export function registerDetectedProjectsView(
	context: vscode.ExtensionContext,
	provider: DetectedProjectsProvider,
	visibility: ProjectVisibility,
	getRoots: () => readonly QuartoProjectRoot[],
): void {
	const view = vscode.window.createTreeView(VIEW_ID, {
		treeDataProvider: provider,
		manageCheckboxStateManually: true,
	});
	context.subscriptions.push(
		view,
		provider,
		visibility.onDidChange(() => provider.refresh()),
		view.onDidChangeCheckboxState(async (event) => {
			for (const [node, state] of event.items) {
				if (node.kind === "project") {
					await visibility.setVisible([node.root], state === vscode.TreeItemCheckboxState.Checked);
				}
			}
		}),
		vscode.commands.registerCommand(SELECT_COMMAND, () => showProjectPicker(visibility, getRoots())),
		vscode.commands.registerCommand(SAVE_COMMAND, () => visibility.saveToWorkspaceSettings(getRoots())),
	);
}
