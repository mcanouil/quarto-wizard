import * as vscode from "vscode";
import { minimatch } from "minimatch";
import { showLogsCommand, logMessage } from "../utils/log";
import type { FileSelectionResult } from "@quarto-wizard/core";

/**
 * Prompts the user to trust the authors of the selected extensions when the trustAuthors setting is set to "ask".
 * @returns {Promise<number>} - Returns 0 if the authors are trusted or if the setting is updated to "never", otherwise returns 1.
 */
export async function askTrustAuthors(): Promise<number> {
	const config = vscode.workspace.getConfiguration("quartoWizard.ask", null);
	const configTrustAuthors = config.get<string>("trustAuthors");

	if (configTrustAuthors === "ask") {
		const trustAuthors = await vscode.window.showQuickPick(
			[
				{ label: "Yes", description: "Trust authors." },
				{ label: "No", description: "Do not trust authors." },
				{ label: "Yes, always trust", description: "Change setting to always trust." },
			],
			{
				placeHolder: "Do you trust the authors of the selected extension(s)?",
			}
		);
		if (trustAuthors?.label === "Yes, always trust") {
			await config.update("trustAuthors", "never", vscode.ConfigurationTarget.Global);
			return 0;
		} else if (trustAuthors?.label !== "Yes") {
			const message = "Operation cancelled because the authors are not trusted.";
			logMessage(message, "info");
			vscode.window.showInformationMessage(`${message} ${showLogsCommand()}.`);
			return 1;
		}
	}
	return 0;
}

/**
 * Prompts the user to confirm the installation of the selected extensions when the confirmInstall setting is set to "ask".
 * @returns {Promise<number>} - Returns 0 if the installation is confirmed or if the setting is updated to "never", otherwise returns 1.
 */
export async function askConfirmInstall(): Promise<number> {
	const config = vscode.workspace.getConfiguration("quartoWizard.ask", null);
	const configConfirmInstall = config.get<string>("confirmInstall");

	if (configConfirmInstall === "ask") {
		const installWorkspace = await vscode.window.showQuickPick(
			[
				{ label: "Yes", description: "Install extensions." },
				{ label: "No", description: "Do not install extensions." },
				{ label: "Yes, always trust", description: "Change setting to always trust." },
			],
			{
				placeHolder: "Do you want to install the selected extension(s)?",
			}
		);
		if (installWorkspace?.label === "Yes, always trust") {
			await config.update("confirmInstall", "never", vscode.ConfigurationTarget.Global);
			return 0;
		} else if (installWorkspace?.label !== "Yes") {
			const message = "Operation cancelled by the user.";
			logMessage(message, "info");
			vscode.window.showInformationMessage(`${message} ${showLogsCommand()}.`);
			return 1;
		}
	}
	return 0;
}

/**
 * Prompts the user to confirm the removal of the selected extensions when the confirmRemove setting is set to "always".
 * @returns {Promise<number>} - Returns 0 if the removal is confirmed or if the setting is updated to "never", otherwise returns 1.
 */
export async function askConfirmRemove(): Promise<number> {
	const config = vscode.workspace.getConfiguration("quartoWizard.ask");
	const configConfirmRemove = config.get<string>("confirmRemove");

	if (configConfirmRemove === "always") {
		const removeWorkspace = await vscode.window.showQuickPick(
			[
				{ label: "Yes", description: "Remove extensions." },
				{ label: "No", description: "Do not remove extensions." },
				{ label: "Yes, always trust", description: "Change setting to always trust." },
			],
			{
				placeHolder: "Do you want to remove the selected extension(s)?",
			}
		);
		if (removeWorkspace?.label === "Yes, always trust") {
			await config.update("confirmRemove", "never", vscode.ConfigurationTarget.Global);
			return 0;
		} else if (removeWorkspace?.label !== "Yes") {
			const message = "Operation cancelled by the user.";
			logMessage(message, "info");
			vscode.window.showInformationMessage(`${message} ${showLogsCommand()}.`);
			return 1;
		}
	}
	return 0;
}

/**
 * Result type for batch overwrite confirmation.
 */
export type OverwriteBatchResult = "all" | "none" | string[];

/**
 * Creates a callback for batch file overwrite confirmation.
 * Shows all conflicting files upfront and lets the user choose how to handle them.
 *
 * @returns A function that receives all conflicting files and returns which ones to overwrite.
 */
export function createConfirmOverwriteBatch(): (files: string[]) => Promise<OverwriteBatchResult> {
	return async (files: string[]): Promise<OverwriteBatchResult> => {
		if (files.length === 0) {
			return "all";
		}

		if (files.length === 1) {
			// For a single file, show simple dialog
			const result = await vscode.window.showWarningMessage(
				`File "${files[0]}" already exists. Overwrite?`,
				{ modal: true },
				"Yes",
				"No"
			);
			return result === "Yes" ? "all" : "none";
		}

		// For multiple files, show options
		const fileList = files.map((f) => `  • ${f}`).join("\n");
		const result = await vscode.window.showWarningMessage(
			`The following ${files.length} file(s) already exist:\n${fileList}\n\nHow would you like to proceed?`,
			{ modal: true },
			"Overwrite All",
			"Choose Individually",
			"Skip All"
		);

		if (result === "Overwrite All") {
			return "all";
		}

		if (result === "Skip All" || result === undefined) {
			return "none";
		}

		// "Choose Individually" - show QuickPick for file selection
		const items = files.map((file) => ({
			label: file,
			picked: false,
		}));

		const selected = await vscode.window.showQuickPick(items, {
			canPickMany: true,
			placeHolder: "Select files to overwrite (press Enter to confirm)",
			title: "Choose Files to Overwrite",
		});

		if (!selected || selected.length === 0) {
			return "none";
		}

		return selected.map((item) => item.label);
	};
}

/**
 * Quick pick item for file/directory selection with tree metadata.
 */
interface TreeQuickPickItem extends vscode.QuickPickItem {
	/** Full path for files, directory path for directories. */
	path: string;
	/** Whether this is a directory. */
	isDirectory: boolean;
	/** Tree depth for indentation. */
	depth: number;
	/** Whether this file exists in the target. */
	isExisting: boolean;
	/** Whether this item is excluded by default patterns. */
	isExcludedByDefault: boolean;
	/** Child file paths (for directories). */
	childPaths: string[];
	/** Whether this directory has children (files or subdirectories). */
	hasChildren: boolean;
}

/**
 * Builds a tree structure from flat file paths.
 */
interface TreeNode {
	name: string;
	path: string;
	isDirectory: boolean;
	children: Map<string, TreeNode>;
	files: string[];
	isExisting: boolean;
	isExcludedByDefault: boolean;
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
	defaultExcludePatterns: string[]
) => Promise<FileSelectionResult | null> {
	return async (
		availableFiles: string[],
		existingFiles: string[],
		defaultExcludePatterns: string[]
	): Promise<FileSelectionResult | null> => {
		if (availableFiles.length === 0) {
			vscode.window.showInformationMessage("No template files found to copy.");
			return { selectedFiles: [], overwriteExisting: false };
		}

		const existingSet = new Set(existingFiles);

		// Build tree structure from file paths
		const root: TreeNode = {
			name: "",
			path: "",
			isDirectory: true,
			children: new Map(),
			files: [],
			isExisting: false,
			isExcludedByDefault: false,
		};

		// Sort files to ensure consistent tree building
		const sortedFiles = [...availableFiles].sort();

		for (const filePath of sortedFiles) {
			const parts = filePath.split("/");
			let current = root;

			// Navigate/create directory nodes
			for (let i = 0; i < parts.length - 1; i++) {
				const dirName = parts[i];
				const dirPath = parts.slice(0, i + 1).join("/");

				if (!current.children.has(dirName)) {
					current.children.set(dirName, {
						name: dirName,
						path: dirPath,
						isDirectory: true,
						children: new Map(),
						files: [],
						isExisting: false,
						isExcludedByDefault: defaultExcludePatterns.some((pattern) => minimatch(dirPath, pattern) || minimatch(dirPath + "/", pattern)),
					});
				}
				current = current.children.get(dirName)!;
			}

			// Add file to current directory
			current.files.push(filePath);
		}

		// Track collapsed directories
		const collapsedDirs = new Set<string>();

		// Track selected paths (persists across rebuilds)
		const selectedPaths = new Set<string>();

		// Buttons for collapse/expand
		const expandButton: vscode.QuickInputButton = {
			iconPath: new vscode.ThemeIcon("chevron-right"),
			tooltip: "Expand",
		};
		const collapseButton: vscode.QuickInputButton = {
			iconPath: new vscode.ThemeIcon("chevron-down"),
			tooltip: "Collapse",
		};

		function getAllFilesInNode(node: TreeNode): string[] {
			const files: string[] = [...node.files];
			for (const child of node.children.values()) {
				files.push(...getAllFilesInNode(child));
			}
			return files;
		}

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
					const allChildFiles = getAllFilesInNode(node);
					const hasExisting = allChildFiles.some((f) => existingSet.has(f));
					const allExcluded = allChildFiles.every((f) => defaultExcludePatterns.some((pattern) => minimatch(f, pattern)));
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
						description: hasExisting ? "$(warning) contains existing files" : (allExcluded ? "excluded by default" : ""),
						picked,
						buttons: hasChildren ? [isCollapsed ? expandButton : collapseButton] : [],
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
						const isExisting = existingSet.has(filePath);
						const isExcludedByDefault = defaultExcludePatterns.some((pattern) => minimatch(filePath, pattern));

						// Determine initial picked state
						let picked: boolean;
						if (selectedPaths.size > 0) {
							// Use persisted selection
							picked = selectedPaths.has(filePath);
						} else {
							// Initial state based on exclusion patterns
							picked = !isExcludedByDefault;
						}

						let description = "";
						if (isExisting && isExcludedByDefault) {
							description = "$(warning) exists, excluded by default";
						} else if (isExisting) {
							description = "$(warning) exists";
						} else if (isExcludedByDefault) {
							description = "excluded by default";
						}

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

		// Initialise selected paths from initial picked state
		for (const item of items) {
			if (item.picked) {
				selectedPaths.add(item.path);
			}
		}

		// Create QuickPick
		const quickPick = vscode.window.createQuickPick<TreeQuickPickItem>();
		quickPick.title = "Select Template Files to Copy";
		quickPick.placeholder = "Select files/folders to copy (Space to toggle, Enter to confirm)";
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

			quickPick.onDidTriggerItemButton((event) => {
				const item = event.item;
				if (item.isDirectory) {
					// Toggle collapse state
					if (collapsedDirs.has(item.path)) {
						collapsedDirs.delete(item.path);
					} else {
						collapsedDirs.add(item.path);
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
						"No, Skip Existing"
					);

					if (result === undefined) {
						// User cancelled
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
			});

			quickPick.onDidHide(() => {
				quickPick.dispose();
				// If not resolved yet, user cancelled
				resolve(null);
			});

			quickPick.show();
		});
	};
}
