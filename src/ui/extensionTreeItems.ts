import * as vscode from "vscode";
import { getExtensionRepository, type InstalledExtension } from "../utils/extensions";

/**
 * Represents a tree item for a workspace folder.
 */
export class WorkspaceFolderTreeItem extends vscode.TreeItem {
	public workspaceFolder: string;

	constructor(
		public readonly label: string,
		public readonly folderPath: string,
	) {
		super(label, vscode.TreeItemCollapsibleState.Expanded);
		this.contextValue = "quartoExtensionWorkspaceFolder";
		this.iconPath = new vscode.ThemeIcon("folder");
		this.tooltip = folderPath;
		this.workspaceFolder = folderPath;
	}
}

/**
 * Represents a tree item for a Quarto extension.
 */
export class ExtensionTreeItem extends vscode.TreeItem {
	public latestVersion?: string;
	public workspaceFolder: string;
	public repository?: string;

	constructor(
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly workspacePath: string,
		public readonly extension?: InstalledExtension,
		icon?: string,
		latestVersion?: string,
		hasIssue?: boolean,
	) {
		super(label, collapsibleState);
		const needsUpdate = latestVersion !== undefined;
		const noSource = extension && !extension.manifest.source;
		const baseContextValue = "quartoExtensionItem";
		let contextValue = baseContextValue;

		// Set context value based on extension state for VS Code context menus
		// This determines which commands are available when right-clicking
		if (needsUpdate) {
			contextValue = baseContextValue + "Outdated"; // Shows "update" option
		} else if (noSource) {
			contextValue = baseContextValue + "NoSource"; // Cannot be updated, shows limited options
		}

		// Build tooltip with warning if there are issues
		let tooltipText = `${this.label}`;
		if (hasIssue) {
			tooltipText += "\n\nCould not parse extension manifest";
		} else if (noSource) {
			tooltipText += "\n\nNo source in manifest (cannot check for updates)";
		}
		this.tooltip = tooltipText;
		this.description = this.extension
			? `${this.extension.manifest.version}${needsUpdate ? ` (latest: ${latestVersion})` : ""}`
			: "";
		this.contextValue = this.extension ? contextValue : "quartoExtensionItemDetails";

		// Show warning icon if there are issues preventing full functionality
		if (hasIssue || noSource) {
			this.iconPath = new vscode.ThemeIcon("warning", new vscode.ThemeColor("problemsWarningIcon.foreground"));
		} else if (icon) {
			this.iconPath = new vscode.ThemeIcon(icon);
		}

		// Format version for installation commands
		this.latestVersion = latestVersion !== "unknown" ? `@${latestVersion}` : "";
		this.workspaceFolder = workspacePath;

		// Store repository for update commands
		if (extension) {
			this.repository = getExtensionRepository(extension);
		}

		// Set resource URI for the extension directory to enable "Reveal in Explorer" functionality
		if (this.extension) {
			this.resourceUri = vscode.Uri.joinPath(vscode.Uri.file(workspacePath), "_extensions", this.label);
		}
	}
}

/**
 * Cached data for a workspace folder.
 */
export interface FolderCache {
	extensions: Record<string, InstalledExtension>;
	latestVersions: Record<string, string>;
	parseErrors: Set<string>;
}
