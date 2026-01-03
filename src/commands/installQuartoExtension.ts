import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import {
	parseInstallSource,
	discoverInstalledExtensions,
	hasExtensionsDir,
	getExtensionInstallPath,
	extractArchive,
	cleanupExtraction,
	copyDirectory,
	type InstalledExtension,
} from "@quarto-wizard/core";
import { QW_RECENTLY_INSTALLED, QW_RECENTLY_USED } from "../constants";
import { showLogsCommand, logMessage } from "../utils/log";
import { checkInternetConnection } from "../utils/network";
import { installQuartoExtension, useQuartoExtension } from "../utils/quarto";
import { askTrustAuthors, askConfirmInstall, createFileSelectionCallback } from "../utils/ask";
import { getExtensionsDetails } from "../utils/extensionDetails";
import { ExtensionQuickPickItem, showExtensionQuickPick, showTypeFilterQuickPick } from "../ui/extensionsQuickPick";
import { selectWorkspaceFolder } from "../utils/workspace";
import { getAuthConfig } from "../utils/auth";

/**
 * Installs or uses the selected Quarto extensions.
 *
 * @param context - The extension context for accessing authentication.
 * @param selectedExtensions - The extensions selected by the user for installation.
 * @param workspaceFolder - The workspace folder where the extensions will be installed.
 * @param template - Whether to use the template functionality (copy template files).
 */
async function installQuartoExtensions(
	context: vscode.ExtensionContext,
	selectedExtensions: readonly ExtensionQuickPickItem[],
	workspaceFolder: string,
	template = false,
) {
	const mutableSelectedExtensions: ExtensionQuickPickItem[] = [...selectedExtensions];

	if ((await askTrustAuthors()) !== 0) return;
	if ((await askConfirmInstall()) !== 0) return;

	// Get authentication configuration (prompts sign-in if needed for private repos)
	const auth = await getAuthConfig(context, { createIfNone: true });

	const actionWord = template ? "Using" : "Installing";
	const actionPast = template ? "used" : "installed";

	// Log source and extensions
	logMessage("Source: registry.", "info");
	logMessage(
		`Extension(s) to ${template ? "use" : "install"}: ${mutableSelectedExtensions.map((ext) => ext.id).join(", ")}.`,
		"info",
	);
	if (!auth?.githubToken && (auth?.httpHeaders?.length ?? 0) === 0) {
		logMessage("Authentication: none (public access).", "info");
	}

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `${actionWord} selected extension(s) (${showLogsCommand()})`,
			cancellable: true,
		},
		async (progress, token) => {
			token.onCancellationRequested(() => {
				const message = "Operation cancelled by the user.";
				logMessage(message, "info");
				vscode.window.showInformationMessage(`${message} ${showLogsCommand()}.`);
			});

			const installedExtensions: string[] = [];
			const failedExtensions: string[] = [];
			const totalExtensions = mutableSelectedExtensions.length;
			let installedCount = 0;

			for (const selectedExtension of mutableSelectedExtensions) {
				if (!selectedExtension.id) {
					continue;
				}

				// Update progress indicator with current extension being processed
				progress.report({
					message: `(${installedCount} / ${totalExtensions}) ${selectedExtension.label} ...`,
					increment: (1 / (totalExtensions + 1)) * 100,
				});

				// Build extension source with optional version tag
				let extensionSource = selectedExtension.id;
				if (selectedExtension.tag && selectedExtension.tag !== "none") {
					extensionSource = `${selectedExtension.id}@${selectedExtension.tag}`;
				}

				let success: boolean;
				if (template) {
					// Use template: install extension and copy template files
					const selectFiles = createFileSelectionCallback();
					const result = await useQuartoExtension(extensionSource, workspaceFolder, selectFiles, auth);
					success = result !== null;
				} else {
					// Regular install: just install the extension
					success = await installQuartoExtension(extensionSource, workspaceFolder, auth);
				}

				// Track installation results for user feedback
				if (success) {
					installedExtensions.push(selectedExtension.id);
				} else {
					failedExtensions.push(selectedExtension.id);
				}

				installedCount++;
			}
			progress.report({
				message: `(${totalExtensions} / ${totalExtensions}) extensions processed.`,
				increment: (1 / (totalExtensions + 1)) * 100,
			});

			if (installedExtensions.length > 0) {
				logMessage(`Successfully ${actionPast} extension${installedExtensions.length > 1 ? "s" : ""}:`, "info");
				installedExtensions.map((ext) => logMessage(` - ${ext}`, "info"));
			}

			if (failedExtensions.length > 0) {
				logMessage(
					`Failed to ${template ? "use" : "install"} extension${failedExtensions.length > 1 ? "s" : ""}:`,
					"error",
				);
				failedExtensions.map((ext) => logMessage(` - ${ext}`, "error"));
				const message = [
					"The following extension",
					failedExtensions.length > 1 ? "s were" : " was",
					` not ${actionPast}, try ${template ? "using" : "installing"} `,
					failedExtensions.length > 1 ? "them" : "it",
					` manually with \`quarto ${template ? "use" : "add"} <extension>\`:`,
				].join("");
				vscode.window.showErrorMessage(`${message} ${failedExtensions.join(", ")}. ${showLogsCommand()}.`);
			} else {
				const message = [
					installedCount,
					" extension",
					installedCount > 1 ? "s" : "",
					` ${actionPast} successfully.`,
				].join("");
				logMessage(message, "info");
				vscode.window.showInformationMessage(`${message} ${showLogsCommand()}.`);
			}
		},
	);
}

/**
 * Command to install Quarto extensions in a specified workspace folder.
 * Prompts the user to select extensions, installs them, and optionally handles templates.
 *
 * @param context - The extension context.
 * @param workspaceFolder - The target workspace folder for extension installation.
 * @param template - Whether to filter for and handle template extensions.
 */
export async function installQuartoExtensionFolderCommand(
	context: vscode.ExtensionContext,
	workspaceFolder: string,
	template = false,
) {
	const isConnected = await checkInternetConnection("https://github.com/");
	if (!isConnected) {
		return;
	}

	let extensionsList = await getExtensionsDetails(context);
	if (template) {
		extensionsList = extensionsList.filter((ext) => ext.template);
	}

	// Show type filter picker (skip for template mode as it's already filtered)
	let typeFilter: string | null = null;
	if (!template) {
		const filterResult = await showTypeFilterQuickPick(extensionsList);

		if (filterResult.type === "cancelled") {
			return;
		}

		// If user selected an alternative source at the filter stage, install directly
		if (filterResult.type === "github" || filterResult.type === "url" || filterResult.type === "local") {
			await installFromSource(context, filterResult.source, workspaceFolder, template);
			return;
		}

		// User selected a filter
		typeFilter = filterResult.value;
	}

	const recentKey = template ? QW_RECENTLY_USED : QW_RECENTLY_INSTALLED;
	const recentExtensions: string[] = context.globalState.get(recentKey, []);
	const result = await showExtensionQuickPick(extensionsList, recentExtensions, template, typeFilter);

	if (result.type === "cancelled") {
		return;
	}

	if (result.type === "registry") {
		// Registry installation flow
		if (result.items.length > 0) {
			await installQuartoExtensions(context, result.items, workspaceFolder, template);
			const selectedIDs = result.items.map((ext) => ext.id).filter(Boolean) as string[];
			const updatedRecentExtensions = [...selectedIDs, ...recentExtensions.filter((ext) => !selectedIDs.includes(ext))];
			await context.globalState.update(recentKey, updatedRecentExtensions.slice(0, 5));
		}
	} else {
		// Alternative source installation (github, url, local)
		await installFromSource(context, result.source, workspaceFolder, template);
	}
}

/**
 * Detect the source type for logging purposes.
 * Uses parseInstallSource from core package for consistent detection.
 */
function detectSourceTypeForLogging(source: string): string {
	try {
		const parsed = parseInstallSource(source);
		switch (parsed.type) {
			case "url":
				return "URL";
			case "local":
				return "local path";
			case "github":
				return "GitHub";
		}
	} catch {
		// Fallback for invalid sources
		return "unknown";
	}
}

/**
 * Install extension from an alternative source (GitHub, URL, or local path).
 *
 * @param context - The extension context for authentication.
 * @param source - The source string (GitHub repo, URL, or local path).
 * @param workspaceFolder - The workspace folder where the extension will be installed.
 * @param template - Whether to use the template functionality.
 */
async function installFromSource(
	context: vscode.ExtensionContext,
	source: string,
	workspaceFolder: string,
	template: boolean,
) {
	if ((await askTrustAuthors()) !== 0) return;
	if ((await askConfirmInstall()) !== 0) return;

	// Resolve local paths relative to workspace folder for installation,
	// but keep original source for logging/display
	let resolvedSource = source;
	try {
		const parsed = parseInstallSource(source);
		if (parsed.type === "local" && !path.isAbsolute(parsed.path)) {
			resolvedSource = path.resolve(workspaceFolder, parsed.path);
		}
	} catch {
		// Not a valid source format, pass through as-is
	}

	const auth = await getAuthConfig(context, { createIfNone: true });
	const actionWord = template ? "Using" : "Installing";
	const sourceType = detectSourceTypeForLogging(source);

	// Log source and extension (use original source for display)
	logMessage(`Source: ${sourceType}.`, "info");
	logMessage(`Extension: ${source}.`, "info");
	if (!auth?.githubToken && (auth?.httpHeaders?.length ?? 0) === 0) {
		logMessage("Authentication: none (public access).", "info");
	}

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `${actionWord} extension from ${source} (${showLogsCommand()})`,
			cancellable: false,
		},
		async () => {
			// Pass original source as sourceDisplay only if path was resolved (different from resolvedSource)
			const sourceDisplay = resolvedSource !== source ? source : undefined;
			let success: boolean;
			if (template) {
				const selectFiles = createFileSelectionCallback();
				const result = await useQuartoExtension(resolvedSource, workspaceFolder, selectFiles, auth, sourceDisplay);
				success = result !== null;
			} else {
				success = await installQuartoExtension(resolvedSource, workspaceFolder, auth, sourceDisplay);
			}

			if (success) {
				const message = template ? "Template used successfully." : "Extension installed successfully.";
				logMessage(message, "info");
				vscode.window.showInformationMessage(`${message} ${showLogsCommand()}.`);
			} else {
				const message = template
					? `Failed to use template from ${source}.`
					: `Failed to install extension from ${source}.`;
				vscode.window.showErrorMessage(`${message} ${showLogsCommand()}.`);
			}
		},
	);
}

/**
 * Command handler for installing Quarto extensions.
 * Prompts the user to select a workspace folder and then calls installQuartoExtensionFolderCommand.
 *
 * @param context - The extension context.
 */
export async function installQuartoExtensionCommand(context: vscode.ExtensionContext) {
	const workspaceFolder = await selectWorkspaceFolder();
	if (!workspaceFolder) {
		return;
	}
	installQuartoExtensionFolderCommand(context, workspaceFolder, false);
}

/**
 * Executes the command to use a Quarto template.
 * This function prompts the user to select a workspace folder, then installs a Quarto extension configured as a template.
 *
 * @param context - The VS Code extension context
 * @returns A Promise that resolves when the operation is complete, or void if the user cancels folder selection
 */
export async function useQuartoTemplateCommand(context: vscode.ExtensionContext) {
	const workspaceFolder = await selectWorkspaceFolder();
	if (!workspaceFolder) {
		return;
	}
	installQuartoExtensionFolderCommand(context, workspaceFolder, true);
}

/**
 * Command to install Quarto extensions directly from the registry.
 * Skips the type filter picker and goes directly to the extension picker.
 *
 * @param context - The extension context.
 */
export async function installExtensionFromRegistryCommand(context: vscode.ExtensionContext) {
	const workspaceFolder = await selectWorkspaceFolder();
	if (!workspaceFolder) {
		return;
	}

	const isConnected = await checkInternetConnection("https://github.com/");
	if (!isConnected) {
		return;
	}

	const extensionsList = await getExtensionsDetails(context);
	const recentKey = QW_RECENTLY_INSTALLED;
	const recentExtensions: string[] = context.globalState.get(recentKey, []);
	const result = await showExtensionQuickPick(extensionsList, recentExtensions, false, null);

	if (result.type === "cancelled") {
		return;
	}

	if (result.type === "registry") {
		if (result.items.length > 0) {
			await installQuartoExtensions(context, result.items, workspaceFolder, false);
			const selectedIDs = result.items.map((ext) => ext.id).filter(Boolean) as string[];
			const updatedRecentExtensions = [...selectedIDs, ...recentExtensions.filter((ext) => !selectedIDs.includes(ext))];
			await context.globalState.update(recentKey, updatedRecentExtensions.slice(0, 5));
		}
	} else {
		// Alternative source installation (github, url, local)
		await installFromSource(context, result.source, workspaceFolder, false);
	}
}

/**
 * Command to install a Quarto extension from a URL.
 * Prompts the user to enter a URL and installs the extension.
 *
 * @param context - The extension context.
 */
export async function installExtensionFromURLCommand(context: vscode.ExtensionContext) {
	const workspaceFolder = await selectWorkspaceFolder();
	if (!workspaceFolder) {
		return;
	}

	const isConnected = await checkInternetConnection("https://github.com/");
	if (!isConnected) {
		return;
	}

	const url = await vscode.window.showInputBox({
		prompt: "Enter the URL to the extension archive (zip or tar.gz)",
		placeHolder: "https://github.com/owner/repo/archive/refs/heads/main.zip",
		ignoreFocusOut: true,
		validateInput: (value) => {
			if (!value) {
				return "URL is required.";
			}
			if (!value.startsWith("http://") && !value.startsWith("https://")) {
				return "URL must start with http:// or https://";
			}
			return null;
		},
	});

	if (!url) {
		return;
	}

	await installFromSource(context, url, workspaceFolder, false);
}

/**
 * QuickPick item for extension selection from local sources.
 */
interface LocalExtensionSelectionItem extends vscode.QuickPickItem {
	extension: InstalledExtension;
}

/**
 * Format an extension ID for display.
 */
function formatExtensionId(ext: InstalledExtension): string {
	return ext.id.owner ? `${ext.id.owner}/${ext.id.name}` : ext.id.name;
}

/**
 * Create a QuickPick item for a local extension.
 */
function createLocalExtensionSelectionItem(ext: InstalledExtension): LocalExtensionSelectionItem {
	const id = formatExtensionId(ext);
	return {
		label: id,
		description: ext.manifest.version ? `v${ext.manifest.version}` : undefined,
		detail: ext.manifest.title || undefined,
		picked: true,
		extension: ext,
	};
}

/**
 * Show a QuickPick for selecting which extensions to install from a local source.
 *
 * @param extensions - List of discovered extensions
 * @returns Selected extensions or null if cancelled
 */
async function showLocalExtensionSelectionQuickPick(
	extensions: InstalledExtension[],
): Promise<InstalledExtension[] | null> {
	const items = extensions.map(createLocalExtensionSelectionItem);

	const selected = await vscode.window.showQuickPick(items, {
		canPickMany: true,
		placeHolder: "Select extensions to install",
		title: `Found ${extensions.length} extension(s)`,
	});

	if (!selected || selected.length === 0) {
		return null;
	}

	return selected.map((item) => item.extension);
}

/**
 * Check for conflicts with existing extensions in the target workspace.
 *
 * @param selectedExtensions - Extensions to install
 * @param targetDir - Target workspace directory
 * @returns Map of extension ID to existing extension (for conflicts)
 */
async function checkExtensionConflicts(
	selectedExtensions: InstalledExtension[],
	targetDir: string,
): Promise<Map<string, InstalledExtension>> {
	const conflicts = new Map<string, InstalledExtension>();

	if (!hasExtensionsDir(targetDir)) {
		return conflicts;
	}

	const existingExtensions = await discoverInstalledExtensions(targetDir);
	const existingMap = new Map(existingExtensions.map((ext) => [formatExtensionId(ext), ext]));

	for (const ext of selectedExtensions) {
		const id = formatExtensionId(ext);
		const existing = existingMap.get(id);
		if (existing) {
			conflicts.set(id, existing);
		}
	}

	return conflicts;
}

/**
 * Resolve conflicts per extension by asking the user.
 *
 * @param conflicts - Map of extension ID to existing extension
 * @param newExtensions - Map of extension ID to new extension being installed
 * @returns Map of extension ID to action (overwrite/skip), or null if cancelled
 */
async function resolveConflictsPerExtension(
	conflicts: Map<string, InstalledExtension>,
	newExtensions: Map<string, InstalledExtension>,
): Promise<Map<string, "overwrite" | "skip"> | null> {
	const resolutions = new Map<string, "overwrite" | "skip">();

	for (const [id, existing] of conflicts) {
		const newExt = newExtensions.get(id);
		const existingVersion = existing.manifest.version || "unknown";
		const newVersion = newExt?.manifest.version || "unknown";

		const result = await vscode.window.showWarningMessage(
			`Extension "${id}" already exists. Current: v${existingVersion}, New: v${newVersion}. Overwrite?`,
			{ modal: true },
			"Overwrite",
			"Skip",
		);

		if (result === undefined) {
			return null;
		}

		resolutions.set(id, result === "Overwrite" ? "overwrite" : "skip");
	}

	return resolutions;
}

/**
 * Install selected extensions to the target workspace.
 *
 * @param extensions - Extensions to install
 * @param sourceBaseDir - Base directory containing source _extensions folder
 * @param targetDir - Target workspace directory
 * @param conflictResolutions - Map of extension ID to action for conflicts
 * @returns Summary of installation results
 */
async function installSelectedLocalExtensions(
	extensions: InstalledExtension[],
	_sourceBaseDir: string,
	targetDir: string,
	conflictResolutions: Map<string, "overwrite" | "skip">,
): Promise<{ success: number; failed: number; skipped: number }> {
	let success = 0;
	let failed = 0;
	let skipped = 0;

	for (const ext of extensions) {
		const id = formatExtensionId(ext);
		const resolution = conflictResolutions.get(id);

		if (resolution === "skip") {
			logMessage(`Skipping ${id} (user chose to skip).`, "info");
			skipped++;
			continue;
		}

		try {
			const targetPath = getExtensionInstallPath(targetDir, ext.id);

			if (resolution === "overwrite" && fs.existsSync(targetPath)) {
				await fs.promises.rm(targetPath, { recursive: true, force: true });
			}

			await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
			await copyDirectory(ext.directory, targetPath);

			logMessage(`Installed ${id} to ${targetPath}.`, "info");
			success++;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logMessage(`Failed to install ${id}: ${message}.`, "error");
			failed++;
		}
	}

	return { success, failed, skipped };
}

/**
 * Install extensions from a directory containing _extensions folder.
 *
 * @param context - The extension context
 * @param sourceDir - Directory containing _extensions folder
 * @param sourceName - Display name of the source (for logging)
 * @param workspaceFolder - Target workspace folder
 */
async function installFromExtensionsDirectory(
	_context: vscode.ExtensionContext,
	sourceDir: string,
	sourceName: string,
	workspaceFolder: string,
): Promise<void> {
	const extensions = await discoverInstalledExtensions(sourceDir);

	if (extensions.length === 0) {
		vscode.window.showInformationMessage(`No valid extensions found in ${sourceName}.`);
		return;
	}

	const selectedExtensions = await showLocalExtensionSelectionQuickPick(extensions);
	if (!selectedExtensions) {
		return;
	}

	if ((await askTrustAuthors()) !== 0) return;
	if ((await askConfirmInstall()) !== 0) return;

	const conflicts = await checkExtensionConflicts(selectedExtensions, workspaceFolder);
	let conflictResolutions = new Map<string, "overwrite" | "skip">();

	if (conflicts.size > 0) {
		const newExtensionsMap = new Map(selectedExtensions.map((ext) => [formatExtensionId(ext), ext]));
		const resolutions = await resolveConflictsPerExtension(conflicts, newExtensionsMap);
		if (!resolutions) {
			return;
		}
		conflictResolutions = resolutions;
	}

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `Installing extensions from ${sourceName} (${showLogsCommand()})`,
			cancellable: false,
		},
		async () => {
			const result = await installSelectedLocalExtensions(
				selectedExtensions,
				sourceDir,
				workspaceFolder,
				conflictResolutions,
			);

			const messages: string[] = [];
			if (result.success > 0) {
				messages.push(`${result.success} installed`);
			}
			if (result.skipped > 0) {
				messages.push(`${result.skipped} skipped`);
			}
			if (result.failed > 0) {
				messages.push(`${result.failed} failed`);
			}

			const summary = messages.join(", ");

			if (result.failed > 0) {
				vscode.window.showErrorMessage(`Extension installation: ${summary}. ${showLogsCommand()}.`);
			} else {
				vscode.window.showInformationMessage(`Extension installation: ${summary}. ${showLogsCommand()}.`);
			}
		},
	);

	await vscode.commands.executeCommand("quartoWizard.extensionsInstalled.refresh");
}

/**
 * Check if a path is an archive file.
 */
function isArchiveFile(filePath: string): boolean {
	const ext = filePath.toLowerCase();
	return ext.endsWith(".zip") || ext.endsWith(".tar.gz") || ext.endsWith(".tgz");
}

/**
 * Command to install a Quarto extension from a local path.
 * Opens a file picker dialog to select a local directory, zip file, or tar.gz file.
 * Can also be invoked from context menu with a pre-selected resource.
 *
 * @param context - The extension context.
 * @param resource - Optional URI from context menu selection.
 */
export async function installExtensionFromLocalCommand(context: vscode.ExtensionContext, resource?: vscode.Uri) {
	let localPath: string;

	if (resource) {
		// Called from context menu with a resource
		localPath = resource.fsPath;
	} else {
		// Called from command palette - show file picker
		const uris = await vscode.window.showOpenDialog({
			canSelectFiles: true,
			canSelectFolders: true,
			canSelectMany: false,
			openLabel: "Select Extension",
			filters: {
				"Archive files": ["zip", "tar.gz", "tgz"],
				"All files": ["*"],
			},
		});

		if (!uris || uris.length === 0) {
			return;
		}

		localPath = uris[0].fsPath;
	}

	const workspaceFolder = await selectWorkspaceFolder();
	if (!workspaceFolder) {
		return;
	}

	const absolutePath = path.isAbsolute(localPath) ? localPath : path.resolve(workspaceFolder, localPath);
	const sourceName = path.basename(absolutePath);

	logMessage(`Installing extensions from local source: ${absolutePath}.`, "info");

	// Check if it's an archive file
	if (isArchiveFile(absolutePath)) {
		// Extract and process archive
		let extractDir: string | undefined;

		try {
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Extracting ${sourceName}...`,
					cancellable: false,
				},
				async () => {
					const result = await extractArchive(absolutePath);
					extractDir = result.extractDir;
				},
			);

			if (!extractDir) {
				vscode.window.showErrorMessage(`Failed to extract ${sourceName}.`);
				return;
			}

			let sourceDir = extractDir;

			// Check for _extensions in root or single subdirectory (GitHub-style archives)
			if (!hasExtensionsDir(extractDir)) {
				const entries = await fs.promises.readdir(extractDir, { withFileTypes: true });
				const directories = entries.filter((e) => e.isDirectory());

				if (directories.length === 1) {
					const subDir = path.join(extractDir, directories[0].name);
					if (hasExtensionsDir(subDir)) {
						sourceDir = subDir;
					}
				}
			}

			if (hasExtensionsDir(sourceDir)) {
				// Has _extensions folder - use multi-select flow
				await installFromExtensionsDirectory(context, sourceDir, sourceName, workspaceFolder);
			} else {
				// No _extensions folder - treat as single extension source
				await installFromSource(context, absolutePath, workspaceFolder, false);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logMessage(`Failed to extract ${sourceName}: ${message}.`, "error");
			vscode.window.showErrorMessage(`Failed to extract ${sourceName}: ${message}.`);
		} finally {
			if (extractDir) {
				await cleanupExtraction(extractDir).catch(() => {});
			}
		}
	} else {
		// It's a directory
		try {
			const stat = await fs.promises.stat(absolutePath);
			if (!stat.isDirectory()) {
				vscode.window.showErrorMessage("Selected item is not a directory or archive file.");
				return;
			}
		} catch {
			vscode.window.showErrorMessage("Cannot access selected path.");
			return;
		}

		if (hasExtensionsDir(absolutePath)) {
			// Has _extensions folder - use multi-select flow
			await installFromExtensionsDirectory(context, absolutePath, sourceName, workspaceFolder);
		} else {
			// No _extensions folder - treat as single extension source
			await installFromSource(context, absolutePath, workspaceFolder, false);
		}
	}
}
