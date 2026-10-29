import * as vscode from "vscode";
import type { SchemaCache, FieldDescriptor, ShortcodeSchema, ClassDefinition } from "@quarto-wizard/schema";
import type { SnippetCache } from "@quarto-wizard/snippets";
import { snippetNamespace } from "@quarto-wizard/snippets";
import { checkForUpdates, formatExtensionId, getErrorMessage, type UpdateCheckResult } from "@quarto-wizard/core";
import { REGISTRY_FETCH_TIMEOUT_MS } from "../constants";
import { debounce } from "../utils/debounce";
import { logMessage } from "../utils/log";
import {
	getInstalledExtensionsRecord,
	getExtensionContributes,
	getEffectiveSourceType,
	getExtensionRepository,
	type InstalledExtension,
} from "../utils/extensions";
import { getCacheTTL, getRegistryUrl } from "../utils/extensionDetails";
import type { QuartoProjectRoot } from "../utils/quartoProjectDiscovery";
import type { ProjectVisibility } from "../utils/projectVisibility";
import { getAuthConfig } from "../utils/auth";
import { getQuartoVersionInfo, type QuartoVersionInfo } from "../services/quartoVersion";
import { validateQuartoRequirement } from "../utils/versionValidation";
import { buildProjectTree, type ProjectTreeNode } from "./projectTreeBuilder";
import {
	WorkspaceFolderTreeItem,
	ProjectGroupTreeItem,
	type ProjectFolderItem,
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
	type ExtensionEmbedding,
	describeCheckSource,
} from "./extensionTreeItems";

/**
 * Context key that tells the view title which action goes with the view message.
 */
const UPDATE_CHECK_CONTEXT_KEY = "quartoWizard.extensionsInstalled.updateCheck";

const UPDATE_CHECK_MESSAGES = {
	github: "Updates checked against GitHub.",
	registry: "Updates checked against the registry. Sign in to GitHub to see new tags straight away.",
	failed: "Update check failed. Show log.",
} as const;

type UpdateCheckState = keyof typeof UPDATE_CHECK_MESSAGES;

const ALL_PROJECTS_HIDDEN_MESSAGE = "All detected projects are hidden. Tick them in the Detected Projects view.";

/**
 * Provides data for the Quarto extensions tree view.
 */
export class QuartoExtensionTreeDataProvider implements vscode.TreeDataProvider<TreeItemType>, vscode.Disposable {
	private _onDidChangeTreeData: vscode.EventEmitter<TreeItemType | undefined | void> = new vscode.EventEmitter<
		TreeItemType | undefined | void
	>();
	readonly onDidChangeTreeData: vscode.Event<TreeItemType | undefined | void> = this._onDidChangeTreeData.event;

	private readonly _onDidChangeCounts = new vscode.EventEmitter<void>();
	/** Fires when the extension or update counts of any project can have changed. */
	readonly onDidChangeCounts: vscode.Event<void> = this._onDidChangeCounts.event;

	// Consolidated cache for extension data per workspace folder
	private cache: Record<string, FolderCache> = {};

	// Memoised hierarchical project tree, invalidated when projectRoots changes
	private projectTreeCache: ProjectTreeNode[] | null = null;

	// Guard against concurrent refresh operations
	private pendingRefresh: Promise<void> | null = null;

	// Guard against concurrent update-check operations
	private pendingCheck: Promise<number> | null = null;

	private readonly visibilityListener: vscode.Disposable;

	private updateCheckMessage: string | undefined;

	private projectRootsByPath: Map<string, QuartoProjectRoot>;

	constructor(
		private projectRoots: readonly QuartoProjectRoot[],
		private schemaCache: SchemaCache,
		private snippetCache: SnippetCache,
		private readonly visibility: ProjectVisibility,
	) {
		this.projectRootsByPath = new Map(projectRoots.map((root) => [root.fsPath, root]));
		this.visibilityListener = visibility.onDidChange(() => {
			this.projectTreeCache = null;
			this._onDidChangeTreeData.fire();
		});
		this.refreshAllExtensionsData();
	}

	/**
	 * Replaces the set of Quarto project roots. Returns `true` when the new set differs from
	 * the previous one. The caller decides whether to trigger a refresh, so this method does
	 * not fire the change event itself: a typical follow-up is `refreshAfterAction(...)`.
	 */
	setProjectRoots(projectRoots: readonly QuartoProjectRoot[]): boolean {
		if (sameProjectRoots(this.projectRoots, projectRoots)) {
			return false;
		}
		this.projectRoots = projectRoots;
		this.projectRootsByPath = new Map(projectRoots.map((root) => [root.fsPath, root]));
		this.projectTreeCache = null;
		return true;
	}

	private getProjectTree(): ProjectTreeNode[] {
		if (!this.projectTreeCache) {
			this.projectTreeCache = buildProjectTree(this.visibleRoots());
		}
		return this.projectTreeCache;
	}

	private allProjectsHidden(visibleRoots: readonly QuartoProjectRoot[] = this.visibleRoots()): boolean {
		return this.projectRoots.length > 0 && visibleRoots.length === 0;
	}

	private visibleRoots(): QuartoProjectRoot[] {
		return this.projectRoots.filter((root) => this.visibility.isVisible(root));
	}

	/**
	 * Gets every detected project root, hidden and embedded ones included.
	 */
	getProjectRoots(): readonly QuartoProjectRoot[] {
		return this.projectRoots;
	}

	/**
	 * Gets the project root at a path, or `undefined` when no root is there.
	 */
	getProjectRoot(fsPath: string): QuartoProjectRoot | undefined {
		return this.projectRootsByPath.get(fsPath);
	}

	/**
	 * Counts the installed extensions of a project and the updates that the view reports for it.
	 * A hidden project is counted too.
	 */
	getProjectCounts(fsPath: string): { extensions: number; updates: number } {
		return {
			extensions: Object.keys(this.cache[fsPath]?.extensions ?? {}).length,
			updates: Object.keys(this.cache[fsPath]?.updates ?? {}).length,
		};
	}

	dispose(): void {
		this.refresh.cancel();
		this.visibilityListener.dispose();
		this._onDidChangeTreeData.dispose();
		this._onDidChangeCounts.dispose();
	}

	getTreeItem(element: TreeItemType): vscode.TreeItem {
		return element;
	}

	getChildren(element?: TreeItemType): Thenable<TreeItemType[]> {
		if (!element) {
			if (this.projectRoots.length === 0) {
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

		if (element instanceof ProjectGroupTreeItem) {
			return Promise.resolve(element.children);
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

	private getWorkspaceFolderItems(): ProjectFolderItem[] {
		const visibleRoots = this.visibleRoots();
		if (visibleRoots.length === 1) {
			const only = visibleRoots[0];
			const folderCache = this.cache[only.fsPath];
			if (!folderCache || Object.keys(folderCache.extensions).length === 0) {
				return [];
			}
		}
		return this.getProjectTree().map((node) => this.toTreeItem(node));
	}

	private toTreeItem(node: ProjectTreeNode): ProjectFolderItem {
		if (node.kind === "project") {
			return new WorkspaceFolderTreeItem(node.label, node.root.fsPath, node.root.readOnly);
		}
		const children = node.children.map((child) => this.toTreeItem(child));
		return new ProjectGroupTreeItem(node.label, node.fsPath, children);
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

		const root = this.getProjectRoot(workspacePath);
		return Object.keys(folderCache.extensions).map((ext) => {
			const embedding = root ? embeddingOf(root, folderCache.extensions[ext]) : undefined;
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
				folderCache.updates[ext],
				folderCache.parseErrors.has(ext),
				compatibilityWarning,
				folderCache.updateCheckFailures.has(ext),
				embedding,
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
				`Installed from: ${getEffectiveSourceType(ext.manifest) ?? "N/A"}`,
				vscode.TreeItemCollapsibleState.None,
				element.workspaceFolder,
			),
		];
		if (element.update) {
			items.push(
				new ExtensionTreeItem(
					`Latest: ${element.update.latestVersion} (checked on ${describeCheckSource(element.update.checkedOn)})`,
					vscode.TreeItemCollapsibleState.None,
					element.workspaceFolder,
				),
			);
		}

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
		if (schema.cells && Object.keys(schema.cells).length > 0) {
			sections.push(new SchemaSectionTreeItem("Cells", "cells", schema, Object.keys(schema.cells).length));
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
			case "cells":
				return Object.entries(schema.cells ?? {}).map(
					([lang, cell]) => new SchemaFormatTreeItem(lang, cell.options ?? {}, cell.description),
				);
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

			for (const root of this.projectRoots) {
				const projectPath = root.fsPath;
				const extensions = await getInstalledExtensionsRecord(projectPath);

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

				newCache[projectPath] = {
					extensions,
					updates: this.cache[projectPath]?.updates ?? {},
					updateCheckFailures: this.cache[projectPath]?.updateCheckFailures ?? new Set(),
					parseErrors,
					compatibility,
				};
			}

			this.cache = newCache;
			this._onDidChangeCounts.fire();
		};

		this.pendingRefresh = doRefresh().finally(() => {
			this.pendingRefresh = null;
		});

		return this.pendingRefresh;
	}

	/**
	 * Gets the paths of the shown Quarto project roots whose extensions can be updated.
	 *
	 * @returns Array of project directory paths.
	 */
	getProjectDirs(): string[] {
		return this.updatableRoots()
			.filter((root) => this.visibility.isVisible(root))
			.map((root) => root.fsPath);
	}

	/**
	 * The extensions of an installed embedded parent ship with it, so they are never updated on their own.
	 */
	private updatableRoots(): QuartoProjectRoot[] {
		return this.projectRoots.filter((root) => !root.readOnly);
	}

	/**
	 * Whether an installed extension is a copy of the extension that embeds it, which has no update.
	 */
	isSelfEmbedded(projectDir: string, extension: InstalledExtension): boolean {
		const root = this.getProjectRoot(projectDir);
		return root !== undefined && embeddingOf(root, extension) === "self";
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
			const projectDirs = this.updatableRoots()
				.map((root) => root.fsPath)
				.filter((dir) => this.cache[dir]);

			let result: UpdateCheckResult | undefined;
			try {
				result = await checkForUpdates({
					projectDirs,
					registryUrl: getRegistryUrl(),
					cacheTtl: getCacheTTL(),
					auth,
					timeout: REGISTRY_FETCH_TIMEOUT_MS,
				});
			} catch (error) {
				logMessage(`Failed to check for updates: ${getErrorMessage(error)}.`, "error");
			}

			for (const failure of result?.repositoryFailures ?? []) {
				logMessage(`Failed to check updates for ${failure.repository}: ${failure.message}.`, "warn");
			}

			let state: UpdateCheckState;
			if (!result) {
				state = "failed";
			} else if (result.checkFailure) {
				// The updates of a failed check can be partial, so the previous state stays.
				logMessage(`Failed to check for updates: ${result.checkFailure.message}.`, "error");
				state = "failed";
			} else {
				this.storeUpdates(projectDirs, result);
				state = result.checkedOn;
			}
			this._onDidChangeCounts.fire();

			const updatesAvailable = this.visibleUpdates();
			const totalUpdates = updatesAvailable.length;

			if (updatesAvailable.length > 0 && !silent) {
				const message = `Updates available for the following extensions: ${updatesAvailable.join(", ")}.`;
				logMessage(message, "info");
			}

			const hasExtensions = projectDirs.some((dir) => Object.keys(this.cache[dir]?.extensions ?? {}).length > 0);
			await vscode.commands.executeCommand("setContext", UPDATE_CHECK_CONTEXT_KEY, hasExtensions ? state : undefined);

			if (view) {
				this.updateCheckMessage = hasExtensions ? UPDATE_CHECK_MESSAGES[state] : undefined;
				this.updateViewState(view);
			}

			return totalUpdates;
		};

		this.pendingCheck = doCheck().finally(() => {
			this.pendingCheck = null;
		});

		return this.pendingCheck;
	}

	/**
	 * Names each update of a shown project, as `<project label>/<extension id>`.
	 */
	private visibleUpdates(visibleRoots: readonly QuartoProjectRoot[] = this.visibleRoots()): string[] {
		return visibleRoots.flatMap((root) =>
			Object.keys(this.cache[root.fsPath]?.updates ?? {}).map((extId) => `${root.label}/${extId}`),
		);
	}

	/**
	 * Sets the badge and the message of the view.
	 * The badge counts the updates of the shown projects.
	 * The message says that every project is hidden, or else reports the state of the update check.
	 */
	updateViewState(view: vscode.TreeView<TreeItemType>): void {
		const visibleRoots = this.visibleRoots();
		view.message = this.allProjectsHidden(visibleRoots) ? ALL_PROJECTS_HIDDEN_MESSAGE : this.updateCheckMessage;
		const totalUpdates = this.visibleUpdates(visibleRoots).length;
		view.badge =
			totalUpdates > 0
				? {
						value: totalUpdates,
						tooltip: `${totalUpdates} update${totalUpdates === 1 ? "" : "s"} available`,
					}
				: undefined;
	}

	/**
	 * Replaces the updates and the failed checks of each project with the result of a complete check.
	 */
	private storeUpdates(projectDirs: string[], result: UpdateCheckResult): void {
		const failedRepositories = new Set(result.repositoryFailures.map((failure) => failure.repository.toLowerCase()));
		for (const dir of projectDirs) {
			// A refresh during the check can replace the cache and drop a project.
			const folderCache = this.cache[dir];
			if (!folderCache) {
				continue;
			}
			folderCache.updates = {};
			folderCache.updateCheckFailures = new Set();
			for (const [extId, ext] of Object.entries(folderCache.extensions)) {
				const repository = getExtensionRepository(ext)?.toLowerCase();
				if (repository && failedRepositories.has(repository)) {
					folderCache.updateCheckFailures.add(extId);
				}
			}
		}
		for (const update of result.updates) {
			const folderCache = this.cache[update.projectDir];
			const root = this.getProjectRoot(update.projectDir);
			// A self-embedded extension has no update, so none is stored for it.
			if (folderCache && !(root && embeddingOf(root, update.extension) === "self")) {
				folderCache.updates[formatExtensionId(update.extension.id)] = update;
			}
		}
	}
}

/**
 * Tells how an extension relates to the extension that embeds it, when its project is an embedding parent.
 * An extension that has the identifier of its parent embeds itself.
 * The other extensions of an installed parent ship with it, so they are read-only.
 */
function embeddingOf(
	root: QuartoProjectRoot,
	extension: InstalledExtension | undefined,
): ExtensionEmbedding | undefined {
	if (root.kind !== "embedded" || !extension) {
		return undefined;
	}
	if (formatExtensionId(extension.id) === formatExtensionId(root.embeddedIn.id)) {
		return "self";
	}
	return root.readOnly ? "read-only" : undefined;
}

function sameProjectRoots(a: readonly QuartoProjectRoot[], b: readonly QuartoProjectRoot[]): boolean {
	if (a.length !== b.length) {
		return false;
	}
	return a.every(
		(root, i) =>
			root.fsPath === b[i].fsPath &&
			root.relativePath === b[i].relativePath &&
			root.quartoIgnored === b[i].quartoIgnored &&
			sameEmbedding(root, b[i]),
	);
}

function sameEmbedding(a: QuartoProjectRoot, b: QuartoProjectRoot): boolean {
	if (a.kind === "project" || b.kind === "project") {
		return a.kind === b.kind;
	}
	return (
		a.embeddedIn.source === b.embeddedIn.source &&
		a.embeddedIn.id.owner === b.embeddedIn.id.owner &&
		a.embeddedIn.id.name === b.embeddedIn.id.name
	);
}
