import * as vscode from "vscode";
import type { SchemaCache, FieldDescriptor, ShortcodeSchema, ClassDefinition } from "@quarto-wizard/schema";
import type { SnippetCache } from "@quarto-wizard/snippets";
import { snippetNamespace } from "@quarto-wizard/snippets";
import { checkForUpdates, formatExtensionId, getErrorMessage, type SourceType } from "@quarto-wizard/core";
import { REGISTRY_FETCH_TIMEOUT_MS } from "../constants";
import { debounce } from "../utils/debounce";
import { logMessage } from "../utils/log";
import { getInstalledExtensionsRecord, getExtensionContributes, getEffectiveSourceType } from "../utils/extensions";
import { getRegistryUrl, getCacheTTL } from "../utils/extensionDetails";
import { getAuthConfig } from "../utils/auth";
import { getQuartoVersionInfo, type QuartoVersionInfo } from "../services/quartoVersion";
import { validateQuartoRequirement } from "../utils/versionValidation";
import {
	WorkspaceFolderTreeItem,
	ExtensionTreeItem,
	SchemaTreeItem,
	SchemaErrorTreeItem,
	SchemaSectionTreeItem,
	SchemaFieldTreeItem,
	SchemaShortcodeTreeItem,
	SchemaFormatTreeItem,
	SchemaClassTreeItem,
	SnippetsTreeItem,
	SnippetsErrorTreeItem,
	SnippetItemTreeItem,
	type TreeItemType,
	type FolderCache,
	type ExtensionCompatibility,
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

	// Guard against concurrent update-check operations
	private pendingCheck: Promise<number> | null = null;

	constructor(
		private workspaceFolders: readonly vscode.WorkspaceFolder[],
		private schemaCache: SchemaCache,
		private snippetCache: SnippetCache,
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

		if (element instanceof SchemaShortcodeTreeItem) {
			return Promise.resolve(this.getShortcodeChildItems(element));
		}

		if (element instanceof SnippetsTreeItem) {
			return Promise.resolve(this.getSnippetItems(element));
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

		return Object.keys(folderCache.extensions).map((ext) => {
			const compatibilityWarning =
				folderCache.compatibility[ext]?.status === "incompatible"
					? folderCache.compatibility[ext].warningMessage
					: undefined;
			return new ExtensionTreeItem(
				ext,
				vscode.TreeItemCollapsibleState.Collapsed,
				workspacePath,
				folderCache.extensions[ext],
				"package",
				folderCache.latestVersions[ext],
				folderCache.parseErrors.has(ext),
				compatibilityWarning,
			);
		});
	}

	private getExtensionDetailItems(element: ExtensionTreeItem): TreeItemType[] {
		const ext = element.extension;
		if (!ext) {
			return [];
		}
		const manifest = ext.manifest;
		const compatibility = this.getExtensionCompatibility(
			element.workspaceFolder,
			element.label,
			manifest.quartoRequired,
		);
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
				`Quarto required: ${manifest.quartoRequired || "N/A"}`,
				vscode.TreeItemCollapsibleState.None,
				element.workspaceFolder,
			),
			new ExtensionTreeItem(
				`Compatibility: ${compatibility.detail}`,
				vscode.TreeItemCollapsibleState.None,
				element.workspaceFolder,
			),
			new ExtensionTreeItem(
				`Contributes: ${getExtensionContributes(ext) ?? "N/A"}`,
				vscode.TreeItemCollapsibleState.None,
				element.workspaceFolder,
			),
			new ExtensionTreeItem(
				`Source: ${manifest.source ?? "N/A"}`,
				vscode.TreeItemCollapsibleState.None,
				element.workspaceFolder,
			),
			new ExtensionTreeItem(
				`Source type: ${getEffectiveSourceType(ext) ?? "N/A"}`,
				vscode.TreeItemCollapsibleState.None,
				element.workspaceFolder,
			),
		];

		const schema = this.schemaCache.get(ext.directory);
		if (schema) {
			items.push(new SchemaTreeItem(ext.directory, schema));
		} else {
			const schemaError = this.schemaCache.getError(ext.directory);
			if (schemaError) {
				items.push(new SchemaErrorTreeItem(schemaError));
			}
		}

		const snippets = this.snippetCache.get(ext.directory);
		if (snippets && Object.keys(snippets).length > 0) {
			items.push(new SnippetsTreeItem(ext.id, snippets));
		} else {
			const snippetError = this.snippetCache.getError(ext.directory);
			if (snippetError) {
				items.push(new SnippetsErrorTreeItem(snippetError));
			}
		}

		return items;
	}

	private getExtensionCompatibility(
		workspaceFolder: string,
		extensionId: string,
		quartoRequired: string | undefined,
	): ExtensionCompatibility {
		const compatibility = this.cache[workspaceFolder]?.compatibility[extensionId];
		if (compatibility) {
			return compatibility;
		}
		return this.fallbackCompatibility(quartoRequired);
	}

	private evaluateCompatibility(
		quartoRequired: string | undefined,
		quartoInfo: QuartoVersionInfo,
	): ExtensionCompatibility {
		if (!quartoRequired) {
			return {
				status: "not-specified",
				detail: "not specified",
			};
		}
		if (!quartoInfo.available || !quartoInfo.version) {
			return this.fallbackCompatibility(quartoRequired);
		}
		const validation = validateQuartoRequirement(quartoRequired, quartoInfo.version);
		if (!validation.valid) {
			const warningMessage = validation.message ?? `This extension requires Quarto ${quartoRequired}.`;
			return {
				status: "incompatible",
				detail: "incompatible",
				warningMessage,
			};
		}
		return {
			status: "compatible",
			detail: "compatible",
		};
	}

	private fallbackCompatibility(quartoRequired: string | undefined): ExtensionCompatibility {
		if (!quartoRequired) {
			return {
				status: "not-specified",
				detail: "not specified",
			};
		}
		return {
			status: "unknown",
			detail: "unknown (Quarto unavailable)",
		};
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
		if (schema.projects && schema.projects.length > 0) {
			sections.push(new SchemaSectionTreeItem("Projects", "projects", schema, schema.projects.length));
		}
		if (schema.attributes && Object.keys(schema.attributes).length > 0) {
			sections.push(
				new SchemaSectionTreeItem("Attributes", "attributes", schema, Object.keys(schema.attributes).length),
			);
		}
		if (schema.classes && Object.keys(schema.classes).length > 0) {
			sections.push(new SchemaSectionTreeItem("Classes", "classes", schema, Object.keys(schema.classes).length));
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
				return (schema.projects ?? []).map(
					(name) => new SchemaFieldTreeItem(name, { type: "string", const: name }, false),
				);
			case "attributes":
				return this.formatItems(schema.attributes ?? {});
			case "classes":
				return this.classItems(schema.classes ?? {});
		}
	}

	private getFormatFieldItems(element: SchemaFormatTreeItem): SchemaFieldTreeItem[] {
		return this.fieldItems(element.fields);
	}

	private getShortcodeChildItems(element: SchemaShortcodeTreeItem): SchemaFieldTreeItem[] {
		const items: SchemaFieldTreeItem[] = [];
		for (const arg of element.shortcode.arguments ?? []) {
			items.push(new SchemaFieldTreeItem(arg.name, arg, !!arg.deprecated, "symbol-parameter"));
		}
		for (const [name, attr] of Object.entries(element.shortcode.attributes ?? {})) {
			items.push(new SchemaFieldTreeItem(name, attr, !!attr.deprecated));
		}
		return items;
	}

	private getSnippetItems(element: SnippetsTreeItem): SnippetItemTreeItem[] {
		const namespace = snippetNamespace(element.extensionId);
		return Object.entries(element.snippets).map(([name, snippet]) => new SnippetItemTreeItem(name, snippet, namespace));
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

	private classItems(classes: Record<string, ClassDefinition>): SchemaClassTreeItem[] {
		return Object.entries(classes).map(([name, classDef]) => new SchemaClassTreeItem(name, classDef));
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
					logMessage(`Failed to check for updates: ${getErrorMessage(error)}.`, "error");
				}
				this._onDidChangeTreeData.fire();
			})
			.catch((error) => {
				logMessage(`Failed to refresh extensions data: ${getErrorMessage(error)}.`, "error");
			});
	}

	private refreshAllExtensionsData(): void {
		// Synchronous initialization - starts async refresh in background
		this.refreshAllExtensionsDataAsync().catch((error) => {
			logMessage(`Failed to refresh extensions data: ${getErrorMessage(error)}.`, "error");
		});
	}

	private async refreshAllExtensionsDataAsync(): Promise<void> {
		// If a refresh is already in progress, wait for it instead of starting another
		if (this.pendingRefresh) {
			return this.pendingRefresh;
		}

		const doRefresh = async (): Promise<void> => {
			const newCache: Record<string, FolderCache> = {};
			const quartoInfo = await getQuartoVersionInfo();

			for (const folder of this.workspaceFolders) {
				const workspaceFolder = folder.uri.fsPath;
				const extensions = await getInstalledExtensionsRecord(workspaceFolder);

				const parseErrors = new Set<string>();
				const compatibility: Record<string, ExtensionCompatibility> = {};
				for (const [extId, ext] of Object.entries(extensions)) {
					const manifest = ext.manifest;
					compatibility[extId] = this.evaluateCompatibility(manifest.quartoRequired, quartoInfo);
					// Mark as parse error if essential fields are missing
					if (!manifest.title && !manifest.version && !manifest.contributes) {
						parseErrors.add(extId);
					}
				}

				newCache[workspaceFolder] = {
					extensions,
					latestVersions: this.cache[workspaceFolder]?.latestVersions || {},
					parseErrors,
					compatibility,
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
		source: string | undefined;
		sourceType: SourceType | undefined;
		latestVersion: string;
	}[] {
		const outdated: {
			extensionId: string;
			workspaceFolder: string;
			source: string | undefined;
			sourceType: SourceType | undefined;
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
						source: extension?.manifest.source,
						sourceType: extension ? getEffectiveSourceType(extension) : undefined,
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
		// If a check is already in progress, wait for it instead of starting another
		if (this.pendingCheck) {
			return this.pendingCheck;
		}

		const doCheck = async (): Promise<number> => {
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
						timeout: REGISTRY_FETCH_TIMEOUT_MS,
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
					logMessage(`Failed to check updates for ${workspacePath}: ${getErrorMessage(error)}.`, "error");
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
		};

		this.pendingCheck = doCheck().finally(() => {
			this.pendingCheck = null;
		});

		return this.pendingCheck;
	}
}
