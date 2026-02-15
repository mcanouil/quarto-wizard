import * as vscode from "vscode";
import { checkForUpdates, formatExtensionId } from "@quarto-wizard/core";
import type { SchemaCache, FieldDescriptor, ShortcodeSchema } from "@quarto-wizard/core";
import { debounce } from "../utils/debounce";
import { logMessage } from "../utils/log";
import { getInstalledExtensionsRecord, getExtensionRepository, getExtensionContributes } from "../utils/extensions";
import { getRegistryUrl, getCacheTTL } from "../utils/extensionDetails";
import { getAuthConfig } from "../utils/auth";
import {
	WorkspaceFolderTreeItem,
	ExtensionTreeItem,
	SchemaTreeItem,
	SchemaSectionTreeItem,
	SchemaFieldTreeItem,
	SchemaShortcodeTreeItem,
	SchemaFormatTreeItem,
	type TreeItemType,
	type FolderCache,
} from "./extensionTreeItems";

/**
 * Provides data for the Quarto extensions tree view.
 */
export class QuartoExtensionTreeDataProvider implements vscode.TreeDataProvider<TreeItemType>, vscode.Disposable {
	private _onDidChangeTreeData: vscode.EventEmitter<TreeItemType | undefined | void> = new vscode.EventEmitter<
		TreeItemType | undefined | void
	>();
	readonly onDidChangeTreeData: vscode.Event<TreeItemType | undefined | void> = this._onDidChangeTreeData.event;

	// Consolidated cache for extension data per workspace folder
	private cache: Record<string, FolderCache> = {};

	// Guard against concurrent refresh operations
	private pendingRefresh: Promise<void> | null = null;

	constructor(
		private workspaceFolders: readonly vscode.WorkspaceFolder[],
		private schemaCache: SchemaCache,
	) {
		this.refreshAllExtensionsData();
	}

	dispose(): void {
		this.refresh.cancel();
		this._onDidChangeTreeData.dispose();
	}

	getTreeItem(element: TreeItemType): vscode.TreeItem {
		return element;
	}

	getChildren(element?: TreeItemType): Thenable<TreeItemType[]> {
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

		if (element instanceof ExtensionTreeItem) {
			return Promise.resolve(this.getExtensionDetailItems(element));
		}

		if (element instanceof SchemaTreeItem) {
			return Promise.resolve(this.getSchemaSectionItems(element));
		}

		if (element instanceof SchemaSectionTreeItem) {
			return Promise.resolve(this.getSectionChildItems(element));
		}

		if (element instanceof SchemaFormatTreeItem) {
			return Promise.resolve(this.getFormatFieldItems(element));
		}

		return Promise.resolve([]);
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

	private getExtensionDetailItems(element: ExtensionTreeItem): TreeItemType[] {
		const ext = element.extension;
		if (!ext) {
			return [];
		}
		const manifest = ext.manifest;
		const items: TreeItemType[] = [
			new ExtensionTreeItem(
				`Title: ${manifest.title || "N/A"}`,
				vscode.TreeItemCollapsibleState.None,
				element.workspaceFolder,
			),
			new ExtensionTreeItem(
				`Author: ${manifest.author || "N/A"}`,
				vscode.TreeItemCollapsibleState.None,
				element.workspaceFolder,
			),
			new ExtensionTreeItem(
				`Version: ${manifest.version || "N/A"}`,
				vscode.TreeItemCollapsibleState.None,
				element.workspaceFolder,
			),
			new ExtensionTreeItem(
				`Contributes: ${getExtensionContributes(ext) ?? "N/A"}`,
				vscode.TreeItemCollapsibleState.None,
				element.workspaceFolder,
			),
			new ExtensionTreeItem(
				`Repository: ${getExtensionRepository(ext) ?? "N/A"}`,
				vscode.TreeItemCollapsibleState.None,
				element.workspaceFolder,
			),
			new ExtensionTreeItem(
				`Source: ${manifest.source ?? "N/A"}`,
				vscode.TreeItemCollapsibleState.None,
				element.workspaceFolder,
			),
		];

		const schema = this.schemaCache.get(ext.directory);
		if (schema) {
			items.push(new SchemaTreeItem(ext.directory, schema));
		}

		return items;
	}

	private getSchemaSectionItems(element: SchemaTreeItem): SchemaSectionTreeItem[] {
		const schema = element.schema;
		const sections: SchemaSectionTreeItem[] = [];

		if (schema.options && Object.keys(schema.options).length > 0) {
			sections.push(new SchemaSectionTreeItem("Options", "options", schema, Object.keys(schema.options).length));
		}
		if (schema.shortcodes && Object.keys(schema.shortcodes).length > 0) {
			sections.push(
				new SchemaSectionTreeItem("Shortcodes", "shortcodes", schema, Object.keys(schema.shortcodes).length),
			);
		}
		if (schema.formats && Object.keys(schema.formats).length > 0) {
			sections.push(new SchemaSectionTreeItem("Formats", "formats", schema, Object.keys(schema.formats).length));
		}
		if (schema.projects && Object.keys(schema.projects).length > 0) {
			sections.push(new SchemaSectionTreeItem("Projects", "projects", schema, Object.keys(schema.projects).length));
		}
		if (schema.elementAttributes && Object.keys(schema.elementAttributes).length > 0) {
			sections.push(
				new SchemaSectionTreeItem(
					"Element Attributes",
					"elementAttributes",
					schema,
					Object.keys(schema.elementAttributes).length,
				),
			);
		}

		return sections;
	}

	private getSectionChildItems(element: SchemaSectionTreeItem): TreeItemType[] {
		const schema = element.schema;

		switch (element.kind) {
			case "options":
				return this.fieldItems(schema.options ?? {});
			case "shortcodes":
				return this.shortcodeItems(schema.shortcodes ?? {});
			case "formats":
				return this.formatItems(schema.formats ?? {});
			case "projects":
				return this.fieldItems(schema.projects ?? {});
			case "elementAttributes":
				return this.formatItems(schema.elementAttributes ?? {});
		}
	}

	private getFormatFieldItems(element: SchemaFormatTreeItem): SchemaFieldTreeItem[] {
		return this.fieldItems(element.fields);
	}

	private fieldItems(fields: Record<string, FieldDescriptor>): SchemaFieldTreeItem[] {
		return Object.entries(fields).map(([name, field]) => new SchemaFieldTreeItem(name, field, !!field.deprecated));
	}

	private shortcodeItems(shortcodes: Record<string, ShortcodeSchema>): SchemaShortcodeTreeItem[] {
		return Object.entries(shortcodes).map(([name, sc]) => new SchemaShortcodeTreeItem(name, sc));
	}

	private formatItems(formats: Record<string, Record<string, FieldDescriptor>>): SchemaFormatTreeItem[] {
		return Object.entries(formats).map(([name, fields]) => new SchemaFormatTreeItem(name, fields));
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
	refreshAfterAction(context: vscode.ExtensionContext, view?: vscode.TreeView<TreeItemType>): void {
		this.refreshAllExtensionsDataAsync()
			.then(async () => {
				try {
					await this.checkUpdate(context, view);
				} catch (error) {
					logMessage(
						`Failed to check for updates: ${error instanceof Error ? error.message : String(error)}.`,
						"error",
					);
				}
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
		view?: vscode.TreeView<TreeItemType>,
		silent = true,
	): Promise<number> {
		const auth = await getAuthConfig(context);
		const registryUrl = getRegistryUrl();
		const cacheTtl = getCacheTTL();
		const updatesAvailable: string[] = [];
		let totalUpdates = 0;

		for (const folder of this.workspaceFolders) {
			const workspacePath = folder.uri.fsPath;
			const folderCache = this.cache[workspacePath];
			if (!folderCache) continue;

			try {
				const updates = await checkForUpdates({
					projectDir: workspacePath,
					registryUrl,
					cacheTtl,
					auth: auth ?? undefined,
					timeout: 10000,
				});

				// Only reset after successful fetch to preserve previous state on error
				folderCache.latestVersions = {};

				for (const update of updates) {
					const extId = formatExtensionId(update.extension.id);
					const atIndex = update.source.lastIndexOf("@");
					const versionRef = atIndex > 0 ? update.source.substring(atIndex + 1) : update.latestVersion;

					folderCache.latestVersions[extId] = versionRef;
					updatesAvailable.push(`${folder.name}/${extId}`);
					totalUpdates++;
				}
			} catch (error) {
				logMessage(
					`Failed to check updates for ${workspacePath}: ${error instanceof Error ? error.message : String(error)}.`,
					"error",
				);
			}
		}

		if (updatesAvailable.length > 0 && !silent) {
			const message = `Updates available for the following extensions: ${updatesAvailable.join(", ")}.`;
			logMessage(message, "info");
		}

		if (view) {
			view.badge =
				totalUpdates > 0
					? {
							value: totalUpdates,
							tooltip: `${totalUpdates} update${totalUpdates === 1 ? "" : "s"} available`,
						}
					: undefined;
		}

		return totalUpdates;
	}
}
