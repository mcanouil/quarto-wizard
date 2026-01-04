import * as vscode from "vscode";
import { minimatch } from "minimatch";
import { showLogsCommand, logMessage } from "../utils/log";
import type { FileSelectionResult } from "@quarto-wizard/core";

/**
 * Configuration for a confirmation dialog.
 */
interface ConfirmationDialogConfig {
	/** The configuration key to check (e.g., "trustAuthors"). */
	configKey: string;
	/** The value that triggers the prompt (e.g., "ask" or "always"). */
	triggerValue: string;
	/** The placeholder text for the quick pick. */
	placeholder: string;
	/** Description for the "Yes" option. */
	yesDescription: string;
	/** Description for the "No" option. */
	noDescription: string;
	/** Label for the "always" option (e.g., "Yes, always trust"). */
	alwaysLabel: string;
	/** Description for the "always" option. */
	alwaysDescription: string;
	/** Message to show when the user cancels. */
	cancelMessage: string;
}

/**
 * Creates a confirmation dialog function based on the provided configuration.
 *
 * @param config - The configuration for the confirmation dialog.
 * @returns A function that prompts the user and returns 0 for success, 1 for cancellation.
 */
function createConfirmationDialog(config: ConfirmationDialogConfig): () => Promise<number> {
	return async (): Promise<number> => {
		try {
			const vsConfig = vscode.workspace.getConfiguration("quartoWizard.ask", null);
			const configValue = vsConfig.get<string>(config.configKey);

			if (configValue === config.triggerValue) {
				const result = await vscode.window.showQuickPick(
					[
						{ label: "Yes", description: config.yesDescription },
						{ label: "No", description: config.noDescription },
						{ label: config.alwaysLabel, description: config.alwaysDescription },
					],
					{
						placeHolder: config.placeholder,
					},
				);
				if (result?.label === config.alwaysLabel) {
					await vsConfig.update(config.configKey, "never", vscode.ConfigurationTarget.Global);
					return 0;
				} else if (result?.label !== "Yes") {
					logMessage(config.cancelMessage, "info");
					vscode.window.showInformationMessage(`${config.cancelMessage} ${showLogsCommand()}.`);
					return 1;
				}
			}
			return 0;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logMessage(`Error showing confirmation dialog: ${message}`, "error");
			return 1;
		}
	};
}

/**
 * Prompts the user to trust the authors of the selected extensions when the trustAuthors setting is set to "ask".
 * @returns {Promise<number>} - Returns 0 if the authors are trusted or if the setting is updated to "never", otherwise returns 1.
 */
export const askTrustAuthors = createConfirmationDialog({
	configKey: "trustAuthors",
	triggerValue: "ask",
	placeholder: "Do you trust the authors of the selected extension(s)?",
	yesDescription: "Trust authors.",
	noDescription: "Do not trust authors.",
	alwaysLabel: "Yes, always trust",
	alwaysDescription: "Change setting to always trust.",
	cancelMessage: "Operation cancelled because the authors are not trusted.",
});

/**
 * Prompts the user to confirm the installation of the selected extensions when the confirmInstall setting is set to "ask".
 * @returns {Promise<number>} - Returns 0 if the installation is confirmed or if the setting is updated to "never", otherwise returns 1.
 */
export const askConfirmInstall = createConfirmationDialog({
	configKey: "confirmInstall",
	triggerValue: "ask",
	placeholder: "Do you want to install the selected extension(s)?",
	yesDescription: "Install extensions.",
	noDescription: "Do not install extensions.",
	alwaysLabel: "Yes, always install",
	alwaysDescription: "Change setting to always install.",
	cancelMessage: "Operation cancelled by the user.",
});

/**
 * Prompts the user to confirm the removal of the selected extensions when the confirmRemove setting is set to "always".
 * @returns {Promise<number>} - Returns 0 if the removal is confirmed or if the setting is updated to "never", otherwise returns 1.
 */
export const askConfirmRemove = createConfirmationDialog({
	configKey: "confirmRemove",
	triggerValue: "always",
	placeholder: "Do you want to remove the selected extension(s)?",
	yesDescription: "Remove extensions.",
	noDescription: "Do not remove extensions.",
	alwaysLabel: "Yes, always remove",
	alwaysDescription: "Change setting to always remove.",
	cancelMessage: "Operation cancelled by the user.",
});

/**
 * Quick pick item for file/directory selection with tree metadata.
 */
interface TreeQuickPickItem extends vscode.QuickPickItem {
	path: string;
	isDirectory: boolean;
	depth: number;
	isExisting: boolean;
	isExcludedByDefault: boolean;
	childPaths: string[];
	hasChildren: boolean;
}

/**
 * Node in the file tree structure.
 */
interface TreeNode {
	name: string;
	path: string;
	children: Map<string, TreeNode>;
	files: string[];
	isExcludedByDefault: boolean;
}

/**
 * Build a tree structure from flat file paths.
 */
function buildFileTree(files: string[], isExcluded: (path: string, isDir: boolean) => boolean): TreeNode {
	const root: TreeNode = { name: "", path: "", children: new Map(), files: [], isExcludedByDefault: false };

	for (const filePath of [...files].sort()) {
		const parts = filePath.split("/");
		let current = root;

		for (let i = 0; i < parts.length - 1; i++) {
			const dirName = parts[i];
			const dirPath = parts.slice(0, i + 1).join("/");

			if (!current.children.has(dirName)) {
				current.children.set(dirName, {
					name: dirName,
					path: dirPath,
					children: new Map(),
					files: [],
					isExcludedByDefault: isExcluded(dirPath, true),
				});
			}
			current = current.children.get(dirName)!;
		}
		current.files.push(filePath);
	}

	return root;
}

/**
 * Get all file paths under a node (cached).
 */
function getAllNodeFiles(node: TreeNode, cache: Map<string, string[]>): string[] {
	const cached = cache.get(node.path);
	if (cached) return cached;

	const files = [...node.files];
	for (const child of node.children.values()) {
		files.push(...getAllNodeFiles(child, cache));
	}
	cache.set(node.path, files);
	return files;
}

/**
 * Collect all directory paths from the tree.
 */
function collectDirectoryPaths(node: TreeNode): string[] {
	const paths: string[] = [];
	if (node.path && (node.children.size > 0 || node.files.length > 0)) {
		paths.push(node.path);
	}
	for (const child of node.children.values()) {
		paths.push(...collectDirectoryPaths(child));
	}
	return paths;
}

/**
 * Creates a callback for interactive file selection with tree structure.
 * Shows a tree-like checkbox list where users can select directories to toggle all children.
 * Directories can be collapsed/expanded using inline buttons.
 *
 * @returns A function that receives available files and returns selection result.
 */
export function createFileSelectionCallback(): (
	availableFiles: string[],
	existingFiles: string[],
	defaultExcludePatterns: string[],
) => Promise<FileSelectionResult | null> {
	return async (
		availableFiles: string[],
		existingFiles: string[],
		defaultExcludePatterns: string[],
	): Promise<FileSelectionResult | null> => {
		if (availableFiles.length === 0) {
			vscode.window.showInformationMessage("No template files found to copy.");
			return { selectedFiles: [], overwriteExisting: false };
		}

		const existingSet = new Set(existingFiles);

		// Pre-compute exclusion cache for all paths to avoid repeated minimatch calls
		const exclusionCache = new Map<string, boolean>();

		/**
		 * Check if a path matches any exclude pattern (with caching).
		 */
		function isExcludedByPatterns(pathToCheck: string): boolean {
			const cached = exclusionCache.get(pathToCheck);
			if (cached !== undefined) {
				return cached;
			}
			const result = defaultExcludePatterns.some((pattern) => minimatch(pathToCheck, pattern));
			exclusionCache.set(pathToCheck, result);
			return result;
		}

		/**
		 * Check if a directory path matches any exclude pattern (with caching).
		 * Checks both with and without trailing slash.
		 */
		function isDirExcludedByPatterns(dirPath: string): boolean {
			const cacheKey = `dir:${dirPath}`;
			const cached = exclusionCache.get(cacheKey);
			if (cached !== undefined) {
				return cached;
			}
			const result = defaultExcludePatterns.some(
				(pattern) => minimatch(dirPath, pattern) || minimatch(dirPath + "/", pattern),
			);
			exclusionCache.set(cacheKey, result);
			return result;
		}

		// Build tree using extracted utility
		const isExcluded = (p: string, isDir: boolean) => (isDir ? isDirExcludedByPatterns(p) : isExcludedByPatterns(p));
		const root = buildFileTree(availableFiles, isExcluded);

		// Cache for file lookups
		const nodeFilesCache = new Map<string, string[]>();
		const getNodeFiles = (node: TreeNode) => getAllNodeFiles(node, nodeFilesCache);

		// Track collapsed directories (start collapsed by default)
		const collapsedDirs = new Set<string>(collectDirectoryPaths(root));

		// Track selected paths (persists across rebuilds)
		const selectedPaths = new Set<string>();

		// Pre-populate selectedPaths with files that should be selected by default
		// (This ensures selection is preserved even when directories are collapsed)
		for (const filePath of availableFiles) {
			if (!isExcludedByPatterns(filePath)) {
				selectedPaths.add(filePath);
			}
		}

		/**
		 * Check if all files in a directory are selected.
		 */
		function areAllChildrenSelected(node: TreeNode): boolean {
			const allFiles = getNodeFiles(node);
			return allFiles.length > 0 && allFiles.every((f) => selectedPaths.has(f));
		}

		/**
		 * Update directory selection state based on children.
		 */
		function updateDirectorySelections(node: TreeNode): void {
			for (const child of node.children.values()) {
				updateDirectorySelections(child);
			}
			if (node.path !== "" && areAllChildrenSelected(node)) {
				selectedPaths.add(node.path);
			}
		}

		// Update directory selections based on file selections
		updateDirectorySelections(root);

		function nodeHasChildren(node: TreeNode): boolean {
			return node.files.length > 0 || node.children.size > 0;
		}

		/**
		 * Build visible items based on current collapse state.
		 */
		function buildVisibleItems(): TreeQuickPickItem[] {
			const items: TreeQuickPickItem[] = [];

			function addNodeToItems(node: TreeNode, depth: number, parentCollapsed: boolean) {
				// Skip if parent is collapsed
				if (parentCollapsed) {
					return;
				}

				const isCollapsed = collapsedDirs.has(node.path);

				// Add directory items (except root)
				if (node.path !== "") {
					const allChildFiles = getNodeFiles(node);
					const hasExisting = allChildFiles.some((f) => existingSet.has(f));
					const allExcluded = allChildFiles.every((f) => isExcludedByPatterns(f));
					const hasChildren = nodeHasChildren(node);

					// Determine initial picked state
					let picked: boolean;
					if (selectedPaths.size > 0) {
						// Use persisted selection
						picked = selectedPaths.has(node.path);
					} else {
						// Initial state based on exclusion patterns
						picked = !allExcluded && !node.isExcludedByDefault;
					}

					items.push({
						label: `${"    ".repeat(depth)}$(folder) ${node.name}/`,
						path: node.path,
						isDirectory: true,
						depth,
						isExisting: hasExisting,
						isExcludedByDefault: allExcluded || node.isExcludedByDefault,
						childPaths: allChildFiles,
						hasChildren,
						description: hasExisting ? "$(warning) contains existing files" : allExcluded ? "excluded by default" : "",
						picked,
					});
				}

				// Add subdirectories first (sorted)
				const sortedDirs = [...node.children.entries()].sort((a, b) => a[0].localeCompare(b[0]));
				for (const [, childNode] of sortedDirs) {
					addNodeToItems(childNode, node.path === "" ? 0 : depth + 1, isCollapsed);
				}

				// Add files in this directory (sorted)
				if (!isCollapsed) {
					const fileSorted = [...node.files].sort();
					const fileDepth = node.path === "" ? 0 : depth + 1;
					for (const filePath of fileSorted) {
						const fileName = filePath.split("/").pop()!;
						const parentPath = node.path;
						const isExisting = existingSet.has(filePath);
						const isExcludedByDefault = isExcludedByPatterns(filePath);

						// Determine initial picked state
						let picked: boolean;
						if (selectedPaths.size > 0) {
							// Use persisted selection
							picked = selectedPaths.has(filePath);
						} else {
							// Initial state based on exclusion patterns
							picked = !isExcludedByDefault;
						}

						// Build description: parent path + status indicators
						const statusParts: string[] = [];
						if (parentPath) {
							statusParts.push(parentPath);
						}
						if (isExisting && isExcludedByDefault) {
							statusParts.push("$(warning) exists, excluded by default");
						} else if (isExisting) {
							statusParts.push("$(warning) exists");
						} else if (isExcludedByDefault) {
							statusParts.push("excluded by default");
						}
						const description = statusParts.join(" · ");

						items.push({
							label: `${"    ".repeat(fileDepth)}$(file) ${fileName}`,
							path: filePath,
							isDirectory: false,
							depth: fileDepth,
							isExisting,
							isExcludedByDefault,
							childPaths: [],
							hasChildren: false,
							description,
							picked,
						});
					}
				}
			}

			addNodeToItems(root, 0, false);
			return items;
		}

		// Build initial items
		let items = buildVisibleItems();

		// Create QuickPick
		const quickPick = vscode.window.createQuickPick<TreeQuickPickItem>();
		quickPick.title = "Select Template Files to Copy";
		quickPick.placeholder = "Select files/folders to copy (Space to toggle, Enter to confirm, Escape to cancel)";
		quickPick.canSelectMany = true;
		quickPick.items = items;
		quickPick.selectedItems = items.filter((item) => item.picked);

		// Add buttons for convenience
		quickPick.buttons = [
			{
				iconPath: new vscode.ThemeIcon("check-all"),
				tooltip: "Select All",
			},
			{
				iconPath: new vscode.ThemeIcon("close-all"),
				tooltip: "Deselect All",
			},
			{
				iconPath: new vscode.ThemeIcon("expand-all"),
				tooltip: "Expand All",
			},
			{
				iconPath: new vscode.ThemeIcon("collapse-all"),
				tooltip: "Collapse All",
			},
		];

		// Track previous selection for directory toggle detection
		let previousSelection = new Set(quickPick.selectedItems.map((item) => item.path));

		/**
		 * Rebuild and update the QuickPick items, preserving selection.
		 */
		function rebuildItems() {
			items = buildVisibleItems();
			quickPick.items = items;
			// Restore selection from selectedPaths
			quickPick.selectedItems = items.filter((item) => selectedPaths.has(item.path));
			previousSelection = new Set(quickPick.selectedItems.map((item) => item.path));
		}

		return new Promise<FileSelectionResult | null>((resolve) => {
			// Track whether onDidAccept was triggered to prevent onDidHide from
			// resolving to null when hide() is called during accept processing
			let acceptTriggered = false;

			quickPick.onDidTriggerButton((button) => {
				if (button.tooltip === "Select All") {
					// Select all items (including hidden ones in collapsed dirs)
					for (const file of availableFiles) {
						selectedPaths.add(file);
					}
					// Also select all directory paths
					for (const item of items) {
						selectedPaths.add(item.path);
					}
					rebuildItems();
				} else if (button.tooltip === "Deselect All") {
					selectedPaths.clear();
					rebuildItems();
				} else if (button.tooltip === "Expand All") {
					collapsedDirs.clear();
					rebuildItems();
				} else if (button.tooltip === "Collapse All") {
					// Collapse all directories
					for (const item of items) {
						if (item.isDirectory && item.hasChildren) {
							collapsedDirs.add(item.path);
						}
					}
					rebuildItems();
				}
			});

			quickPick.onDidChangeSelection((selected) => {
				const currentSelection = new Set(selected.map((item) => item.path));

				// Update selectedPaths based on visible items
				for (const item of quickPick.items) {
					if (currentSelection.has(item.path)) {
						selectedPaths.add(item.path);
					} else {
						selectedPaths.delete(item.path);
					}
				}

				// Find directories that changed selection state
				for (const item of quickPick.items) {
					if (!item.isDirectory) continue;

					const wasSelected = previousSelection.has(item.path);
					const isSelected = currentSelection.has(item.path);

					if (wasSelected !== isSelected) {
						// Directory selection changed, update all children (including hidden ones)
						const childPaths = item.childPaths;

						if (isSelected) {
							// Select all children
							for (const childPath of childPaths) {
								selectedPaths.add(childPath);
							}
						} else {
							// Deselect all children
							for (const childPath of childPaths) {
								selectedPaths.delete(childPath);
							}
						}

						// Rebuild to update visible items
						rebuildItems();
						return;
					}
				}

				previousSelection = currentSelection;
			});

			quickPick.onDidAccept(async () => {
				// Mark that accept was triggered so onDidHide doesn't resolve to null
				acceptTriggered = true;

				try {
					// Get only file selections (not directories) from selectedPaths
					const selectedFiles = availableFiles.filter((f) => selectedPaths.has(f));
					quickPick.hide();

					if (selectedFiles.length === 0) {
						resolve({ selectedFiles: [], overwriteExisting: false });
						return;
					}

					// Check if any existing files are selected
					const selectedExisting = selectedFiles.filter((f) => existingSet.has(f));

					let overwriteExisting = false;
					if (selectedExisting.length > 0) {
						const existingList = selectedExisting.map((f) => `  - ${f}`).join("\n");
						const result = await vscode.window.showWarningMessage(
							`The following ${selectedExisting.length} file(s) already exist:\n${existingList}\n\nOverwrite them?`,
							{ modal: true },
							"Yes, Overwrite",
							"No, Skip Existing",
						);

						if (result === undefined) {
							// User cancelled overwrite dialog
							resolve(null);
							return;
						}

						overwriteExisting = result === "Yes, Overwrite";

						if (!overwriteExisting) {
							// Remove existing files from selection
							const finalFiles = selectedFiles.filter((f) => !existingSet.has(f));
							resolve({ selectedFiles: finalFiles, overwriteExisting: false });
							return;
						}
					}

					resolve({ selectedFiles, overwriteExisting });
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					logMessage(`Error in file selection: ${message}`, "error");
					resolve(null);
				}
			});

			quickPick.onDidHide(() => {
				quickPick.dispose();
				// Only resolve to null if user cancelled (pressed Escape) without accepting
				// If accept was triggered, onDidAccept will handle the resolution
				if (!acceptTriggered) {
					resolve(null);
				}
			});

			quickPick.show();
		});
	};
}
