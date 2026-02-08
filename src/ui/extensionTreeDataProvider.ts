import * as vscode from "vscode";
import * as semver from "semver";
import { normaliseVersion } from "@quarto-wizard/core";
import { debounce } from "../utils/debounce";
import { logMessage } from "../utils/log";
import { getInstalledExtensionsRecord, getExtensionRepository, getExtensionContributes } from "../utils/extensions";
import { getExtensionsDetails } from "../utils/extensionDetails";
import { WorkspaceFolderTreeItem, ExtensionTreeItem, type FolderCache } from "./extensionTreeItems";

/**
 * Provides data for the Quarto extensions tree view.
 */
export class QuartoExtensionTreeDataProvider implements vscode.TreeDataProvider<
	WorkspaceFolderTreeItem | ExtensionTreeItem
> {
	private _onDidChangeTreeData: vscode.EventEmitter<WorkspaceFolderTreeItem | ExtensionTreeItem | undefined | void> =
		new vscode.EventEmitter<WorkspaceFolderTreeItem | ExtensionTreeItem | undefined | void>();
	readonly onDidChangeTreeData: vscode.Event<WorkspaceFolderTreeItem | ExtensionTreeItem | undefined | void> =
		this._onDidChangeTreeData.event;

	// Consolidated cache for extension data per workspace folder
	private cache: Record<string, FolderCache> = {};

	// Guard against concurrent refresh operations
	private pendingRefresh: Promise<void> | null = null;

	constructor(private workspaceFolders: readonly vscode.WorkspaceFolder[]) {
		this.refreshAllExtensionsData();
	}

	getTreeItem(element: WorkspaceFolderTreeItem | ExtensionTreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(
		element?: WorkspaceFolderTreeItem | ExtensionTreeItem,
	): Thenable<(WorkspaceFolderTreeItem | ExtensionTreeItem)[]> {
		if (!element) {
			if (this.workspaceFolders.length === 0) {
				return Promise.resolve([
					new ExtensionTreeItem(
						"No workspace folders open.",
						vscode.TreeItemCollapsibleState.None,
						"",
						undefined,
						"info",
					),
				]);
			}
			return Promise.resolve(this.getWorkspaceFolderItems());
		}

		if (element instanceof WorkspaceFolderTreeItem) {
			return Promise.resolve(this.getExtensionItems(element.folderPath));
		}

		return Promise.resolve(this.getExtensionDetailItems(element));
	}

	private getWorkspaceFolderItems(): WorkspaceFolderTreeItem[] {
		if (this.workspaceFolders.length > 1) {
			return this.workspaceFolders.map((folder) => {
				return new WorkspaceFolderTreeItem(folder.name, folder.uri.fsPath);
			});
		}
		return this.workspaceFolders
			.filter((folder) => {
				const folderCache = this.cache[folder.uri.fsPath];
				return folderCache && Object.keys(folderCache.extensions).length > 0;
			})
			.map((folder) => new WorkspaceFolderTreeItem(folder.name, folder.uri.fsPath));
	}

	private getExtensionItems(workspacePath: string): ExtensionTreeItem[] {
		const folderCache = this.cache[workspacePath];
		if (!folderCache || Object.keys(folderCache.extensions).length === 0) {
			return [
				new ExtensionTreeItem(
					"No extensions installed.",
					vscode.TreeItemCollapsibleState.None,
					workspacePath,
					undefined,
					"info",
				),
			];
		}

		return Object.keys(folderCache.extensions).map(
			(ext) =>
				new ExtensionTreeItem(
					ext,
					vscode.TreeItemCollapsibleState.Collapsed,
					workspacePath,
					folderCache.extensions[ext],
					"package",
					folderCache.latestVersions[ext],
					folderCache.parseErrors.has(ext),
				),
		);
	}

	private getExtensionDetailItems(element: ExtensionTreeItem): ExtensionTreeItem[] {
		const ext = element.extension;
		if (!ext) {
			return [];
		}
		const manifest = ext.manifest;
		return [
			new ExtensionTreeItem(`Title: ${manifest.title}`, vscode.TreeItemCollapsibleState.None, element.workspaceFolder),
			new ExtensionTreeItem(
				`Author: ${manifest.author}`,
				vscode.TreeItemCollapsibleState.None,
				element.workspaceFolder,
			),
			new ExtensionTreeItem(
				`Version: ${manifest.version}`,
				vscode.TreeItemCollapsibleState.None,
				element.workspaceFolder,
			),
			new ExtensionTreeItem(
				`Contributes: ${getExtensionContributes(ext)}`,
				vscode.TreeItemCollapsibleState.None,
				element.workspaceFolder,
			),
			new ExtensionTreeItem(
				`Repository: ${getExtensionRepository(ext)}`,
				vscode.TreeItemCollapsibleState.None,
				element.workspaceFolder,
			),
			new ExtensionTreeItem(
				`Source: ${manifest.source}`,
				vscode.TreeItemCollapsibleState.None,
				element.workspaceFolder,
			),
		];
	}

	/**
	 * Refreshes the tree data with a debounce.
	 */
	refresh = debounce((): void => {
		this.refreshAllExtensionsData();
		this._onDidChangeTreeData.fire();
	}, 300); // Debounce refresh calls with a 300ms delay

	/**
	 * Forces a refresh of the tree data.
	 */
	forceRefresh(): void {
		this.refresh();
		this.refresh.flush();
	}

	/**
	 * Centralised method to handle post-action refresh and update checking.
	 * Ensures proper order: check for updates first, then refresh display.
	 */
	refreshAfterAction(
		context: vscode.ExtensionContext,
		view?: vscode.TreeView<WorkspaceFolderTreeItem | ExtensionTreeItem>,
	): void {
		this.refreshAllExtensionsDataAsync()
			.then(() => {
				this.checkUpdate(context, view).catch((error) => {
					logMessage(
						`Failed to check for updates: ${error instanceof Error ? error.message : String(error)}.`,
						"error",
					);
				});
				this._onDidChangeTreeData.fire();
			})
			.catch((error) => {
				logMessage(
					`Failed to refresh extensions data: ${error instanceof Error ? error.message : String(error)}.`,
					"error",
				);
			});
	}

	private refreshAllExtensionsData(): void {
		// Synchronous initialization - starts async refresh in background
		this.refreshAllExtensionsDataAsync().catch((error) => {
			logMessage(
				`Failed to refresh extensions data: ${error instanceof Error ? error.message : String(error)}.`,
				"error",
			);
		});
	}

	private async refreshAllExtensionsDataAsync(): Promise<void> {
		// If a refresh is already in progress, wait for it instead of starting another
		if (this.pendingRefresh) {
			return this.pendingRefresh;
		}

		const doRefresh = async (): Promise<void> => {
			const newCache: Record<string, FolderCache> = {};

			for (const folder of this.workspaceFolders) {
				const workspaceFolder = folder.uri.fsPath;
				const extensions = await getInstalledExtensionsRecord(workspaceFolder);

				const parseErrors = new Set<string>();
				for (const [extId, ext] of Object.entries(extensions)) {
					const manifest = ext.manifest;
					// Mark as parse error if essential fields are missing
					if (!manifest.title && !manifest.version && !manifest.contributes) {
						parseErrors.add(extId);
					}
				}

				newCache[workspaceFolder] = {
					extensions,
					latestVersions: this.cache[workspaceFolder]?.latestVersions || {},
					parseErrors,
				};
			}

			this.cache = newCache;
		};

		this.pendingRefresh = doRefresh().finally(() => {
			this.pendingRefresh = null;
		});

		return this.pendingRefresh;
	}

	/**
	 * Gets all outdated extensions across all workspace folders.
	 *
	 * @returns Array of objects with extension info and update details.
	 */
	getOutdatedExtensions(): {
		extensionId: string;
		workspaceFolder: string;
		repository: string | undefined;
		latestVersion: string;
	}[] {
		const outdated: {
			extensionId: string;
			workspaceFolder: string;
			repository: string | undefined;
			latestVersion: string;
		}[] = [];

		for (const folder of this.workspaceFolders) {
			const workspacePath = folder.uri.fsPath;
			const folderCache = this.cache[workspacePath];
			if (!folderCache) continue;

			for (const ext of Object.keys(folderCache.latestVersions)) {
				const version = folderCache.latestVersions[ext];
				if (version && version !== "unknown") {
					const extension = folderCache.extensions[ext];
					outdated.push({
						extensionId: ext,
						workspaceFolder: workspacePath,
						repository: extension ? getExtensionRepository(extension) : undefined,
						latestVersion: version,
					});
				}
			}
		}

		return outdated;
	}

	/**
	 * Gets all installed extensions in a workspace folder.
	 *
	 * @param workspaceFolder - The workspace folder path.
	 * @returns Array of extension IDs.
	 */
	getInstalledExtensions(workspaceFolder: string): string[] {
		const folderCache = this.cache[workspaceFolder];
		return folderCache ? Object.keys(folderCache.extensions) : [];
	}

	/**
	 * Checks for updates to the installed extensions.
	 *
	 * @param context - The extension context.
	 * @param view - The tree view.
	 * @param silent - Whether to show update messages.
	 * @returns The number of updates available.
	 */
	async checkUpdate(
		context: vscode.ExtensionContext,
		view?: vscode.TreeView<WorkspaceFolderTreeItem | ExtensionTreeItem>,
		silent = true,
	): Promise<number> {
		const extensionsDetails = await getExtensionsDetails(context);
		const updatesAvailable: string[] = [];
		let totalUpdates = 0;

		for (const folder of this.workspaceFolders) {
			const workspacePath = folder.uri.fsPath;
			const folderCache = this.cache[workspacePath];
			if (!folderCache) continue;

			// Reset latest versions for this folder
			folderCache.latestVersions = {};

			for (const [extId, ext] of Object.entries(folderCache.extensions)) {
				const repository = getExtensionRepository(ext);
				const matchingDetail = extensionsDetails.find((detail) => detail.id === repository);

				const version = ext.manifest.version;
				if (!version || version === "none") {
					continue;
				}

				if (matchingDetail?.version === "none") {
					folderCache.latestVersions[extId] = "unknown";
					continue;
				}

				const currentSemver = normaliseVersion(version);
				const latestSemver = matchingDetail ? normaliseVersion(matchingDetail.version) : null;

				if (matchingDetail && currentSemver && latestSemver && semver.lt(currentSemver, latestSemver)) {
					updatesAvailable.push(`${folder.name}/${extId}`);
					folderCache.latestVersions[extId] = matchingDetail.tag;
					totalUpdates++;
				}
			}
		}

		if (updatesAvailable.length > 0 && !silent) {
			const message = `Updates available for the following extensions: ${updatesAvailable.join(", ")}.`;
			logMessage(message, "info");
		}

		if (view) {
			view.badge = {
				value: totalUpdates,
				tooltip: `${totalUpdates} update${totalUpdates === 1 ? "" : "s"} available`,
			};
		}

		return totalUpdates;
	}
}
