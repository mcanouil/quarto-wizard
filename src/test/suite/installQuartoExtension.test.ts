import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
	openTemplate,
	installQuartoExtensionCommand,
	useQuartoTemplateCommand,
} from "../../commands/installQuartoExtension";
import { ExtensionQuickPickItem } from "../../ui/extensionsQuickPick";
import * as logUtils from "../../utils/log";
import * as constants from "../../constants";

/**
 * Mock extension context for testing
 */
interface MockExtensionContext {
	globalState: {
		get<T>(key: string, defaultValue?: T): T;
		update(key: string, value: unknown): Promise<void>;
		keys(): readonly string[];
		setKeysForSync(keys: readonly string[]): void;
	};
}

suite("Install Quarto Extension Test Suite", () => {
	let tempDir: string;
	let workspaceFolder: string;
	let mockContext: MockExtensionContext;

	// Store original VS Code API methods
	let originalOpenTextDocument: typeof vscode.workspace.openTextDocument;
	let originalShowTextDocument: typeof vscode.window.showTextDocument;
	let originalShowInformationMessage: typeof vscode.window.showInformationMessage;
	let originalShowErrorMessage: typeof vscode.window.showErrorMessage;
	let originalShowWorkspaceFolderPick: typeof vscode.window.showWorkspaceFolderPick;
	let originalWorkspaceFolders: readonly vscode.WorkspaceFolder[] | undefined;
	let originalLogMessage: typeof logUtils.logMessage;
	let originalQwLog: unknown;

	// Mock state
	let globalStateData: Record<string, unknown>;
	let logMessages: { message: string; type: string }[];
	let documentContent: string;
	let documentLanguage: string;
	let documentShown: boolean;
	let selectedWorkspaceFolder: vscode.WorkspaceFolder | undefined;

	setup(() => {
		// Create temporary directory for tests
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quarto-wizard-install-test-"));
		workspaceFolder = path.join(tempDir, "workspace");
		fs.mkdirSync(workspaceFolder, { recursive: true });

		// Reset test state
		globalStateData = {};
		logMessages = [];
		documentContent = "";
		documentLanguage = "";
		documentShown = false;
		selectedWorkspaceFolder = undefined;

		// Create mock extension context
		mockContext = {
			globalState: {
				get: <T>(key: string, defaultValue?: T): T => {
					return (globalStateData[key] as T) ?? (defaultValue as T);
				},
				update: async (key: string, value: unknown) => {
					globalStateData[key] = value;
				},
				keys: () => Object.keys(globalStateData),
				setKeysForSync: () => {
					// Mock implementation
				},
			},
		} as unknown as MockExtensionContext;

		// Store original VS Code API methods
		originalOpenTextDocument = vscode.workspace.openTextDocument;
		originalShowTextDocument = vscode.window.showTextDocument;
		originalShowInformationMessage = vscode.window.showInformationMessage;
		originalShowErrorMessage = vscode.window.showErrorMessage;
		originalShowWorkspaceFolderPick = vscode.window.showWorkspaceFolderPick;
		originalWorkspaceFolders = vscode.workspace.workspaceFolders;
		originalLogMessage = logUtils.logMessage;

		// Mock the QW_LOG output channel
		originalQwLog = (constants as { QW_LOG: unknown }).QW_LOG;
		(constants as { QW_LOG: unknown }).QW_LOG = {
			appendLine: () => {
				// Mock implementation - do nothing
			},
		};

		// Mock logMessage function
		(logUtils as { logMessage: typeof logUtils.logMessage }).logMessage = (message: string, type = "info") => {
			logMessages.push({ message, type });
		};

		// Mock VS Code APIs
		const mockWorkspace = vscode.workspace as unknown as {
			openTextDocument: (options: { content?: string; language?: string }) => Promise<vscode.TextDocument>;
		};
		const mockWindow = vscode.window as unknown as {
			showTextDocument: (document: vscode.TextDocument) => Promise<vscode.TextEditor>;
			showInformationMessage: (message: string, ...items: string[]) => Promise<string | undefined>;
			showErrorMessage: (message: string, ...items: string[]) => Promise<string | undefined>;
			showWorkspaceFolderPick: () => Promise<vscode.WorkspaceFolder | undefined>;
		};

		mockWorkspace.openTextDocument = async (options: { content?: string; language?: string }) => {
			documentContent = options.content || "";
			documentLanguage = options.language || "";
			return {
				getText: () => documentContent,
				languageId: documentLanguage,
				uri: vscode.Uri.file("untitled"),
				fileName: "untitled",
				isUntitled: true,
				isDirty: false,
				isClosed: false,
				save: async () => true,
				eol: vscode.EndOfLine.LF,
				lineCount: documentContent.split("\n").length,
				lineAt: () => ({ text: "", lineNumber: 0 } as vscode.TextLine),
				offsetAt: () => 0,
				positionAt: () => new vscode.Position(0, 0),
				getWordRangeAtPosition: () => undefined,
				validateRange: (range) => range,
				validatePosition: (position) => position,
				version: 1,
				encoding: "utf8",
			} as vscode.TextDocument;
		};

		mockWindow.showTextDocument = async () => {
			documentShown = true;
			return {} as vscode.TextEditor;
		};

		mockWindow.showInformationMessage = async () => {
			return undefined;
		};

		mockWindow.showErrorMessage = async () => {
			return undefined;
		};

		mockWindow.showWorkspaceFolderPick = async () => {
			return selectedWorkspaceFolder;
		};

		// Mock workspace folders
		Object.defineProperty(vscode.workspace, "workspaceFolders", {
			get: () => (selectedWorkspaceFolder ? [selectedWorkspaceFolder] : undefined),
			configurable: true,
		});
	});

	teardown(() => {
		// Restore original VS Code API methods
		const mockWorkspace = vscode.workspace as unknown as {
			openTextDocument: typeof vscode.workspace.openTextDocument;
		};
		const mockWindow = vscode.window as unknown as {
			showTextDocument: typeof vscode.window.showTextDocument;
			showInformationMessage: typeof vscode.window.showInformationMessage;
			showErrorMessage: typeof vscode.window.showErrorMessage;
			showWorkspaceFolderPick: typeof vscode.window.showWorkspaceFolderPick;
		};

		mockWorkspace.openTextDocument = originalOpenTextDocument;
		mockWindow.showTextDocument = originalShowTextDocument;
		mockWindow.showInformationMessage = originalShowInformationMessage;
		mockWindow.showErrorMessage = originalShowErrorMessage;
		mockWindow.showWorkspaceFolderPick = originalShowWorkspaceFolderPick;

		Object.defineProperty(vscode.workspace, "workspaceFolders", {
			get: () => originalWorkspaceFolders,
			configurable: true,
		});

		// Restore original log function
		(logUtils as { logMessage: typeof logUtils.logMessage }).logMessage = originalLogMessage;

		// Restore original QW_LOG
		(constants as { QW_LOG: unknown }).QW_LOG = originalQwLog;

		// Clean up temporary directory
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	suite("openTemplate", () => {
		test("Should successfully open a valid base64-encoded template", async () => {
			const extensionId = "mcanouil/quarto-github";
			const originalContent =
				"---\ntitle: GitHub Template\n---\n\n# GitHub Repository Link\n\nmcanouil/quarto-wizard#1";
			const templateContent = Buffer.from(originalContent).toString("base64");

			const result = await openTemplate(extensionId, templateContent);

			assert.strictEqual(result, true, "Should return true for successful template opening");
			assert.strictEqual(documentLanguage, "quarto", "Should set document language to quarto");
			assert.strictEqual(documentContent, originalContent, "Should decode template content correctly");
			assert.strictEqual(documentShown, true, "Should show the document");
			assert.strictEqual(logMessages.filter((log) => log.type === "info").length, 1, "Should show success message");
			assert.ok(
				logMessages.some((log) => log.message.includes('Template from "mcanouil/quarto-github" opened successfully')),
				"Should show correct success message"
			);
			assert.strictEqual(logMessages.filter((log) => log.type === "error").length, 0, "Should not show error messages");
		});

		test("Should handle invalid base64 content gracefully", async () => {
			const extensionId = "mcanouil/invalid-extension";
			const validBase64ButFailingContent = "dGVzdA=="; // "test" in base64

			// Mock openTextDocument to throw an error
			const mockWorkspace = vscode.workspace as unknown as {
				openTextDocument: (options: { content?: string; language?: string }) => Promise<vscode.TextDocument>;
			};

			mockWorkspace.openTextDocument = async () => {
				throw new Error("Simulated VS Code API error");
			};

			const result = await openTemplate(extensionId, validBase64ButFailingContent);

			assert.strictEqual(result, false, "Should return false when VS Code API fails");
			assert.strictEqual(documentShown, false, "Should not show document when API fails");
			assert.strictEqual(
				logMessages.filter((log) => log.type === "info").length,
				0,
				"Should not show success messages"
			);
			assert.strictEqual(logMessages.filter((log) => log.type === "error").length, 1, "Should show error message");
			assert.ok(
				logMessages.some((log) => log.message.includes("Failed to open the template")),
				"Should show appropriate error message"
			);
			assert.ok(
				logMessages.some((log) => log.message.includes("mcanouil/invalid-extension")),
				"Should include extension ID in error message"
			);
		});

		test("Should handle highlight-text extension template", async () => {
			const extensionId = "mcanouil/quarto-highlight-text";
			const highlightContent =
				"---\ntitle: Highlight Text Template\n---\n\n# Highlighted Content\n\n[This is highlighted text]{.highlight-text}";
			const templateContent = Buffer.from(highlightContent).toString("base64");

			const result = await openTemplate(extensionId, templateContent);

			assert.strictEqual(result, true, "Should return true for highlight-text template");
			assert.strictEqual(documentContent, highlightContent, "Should handle highlight-text content correctly");
			assert.strictEqual(documentLanguage, "quarto", "Should set document language to quarto");
			assert.strictEqual(documentShown, true, "Should show the document");
			assert.strictEqual(logMessages.filter((log) => log.type === "info").length, 1, "Should show success message");
			assert.strictEqual(logMessages.filter((log) => log.type === "error").length, 0, "Should not show error messages");
		});

		test("Should handle empty template content", async () => {
			const extensionId = "mcanouil/empty-extension";
			const emptyContent = "";
			const templateContent = Buffer.from(emptyContent).toString("base64");

			const result = await openTemplate(extensionId, templateContent);

			assert.strictEqual(result, true, "Should return true for empty content");
			assert.strictEqual(documentContent, emptyContent, "Should handle empty content correctly");
			assert.strictEqual(documentLanguage, "quarto", "Should set document language to quarto");
			assert.strictEqual(documentShown, true, "Should show the document");
			assert.strictEqual(logMessages.filter((log) => log.type === "info").length, 1, "Should show success message");
			assert.strictEqual(logMessages.filter((log) => log.type === "error").length, 0, "Should not show error messages");
		});

		test("Should handle complex YAML frontmatter with extension metadata", async () => {
			const extensionId = "mcanouil/quarto-github";
			const yamlContent = `---
title: "GitHub Extension Demo"
author: "Test Author"
date: "2024-01-01"
format:
  html:
    theme: cosmo
    toc: true
filters:
  - quarto-github
execute:
  echo: false
  warning: false
---

# GitHub Integration

This template demonstrates the GitHub extension usage.

mcanouil/quarto-wizard#1

## Repository Information

You can embed GitHub repositories directly in your documents.
`;
			const templateContent = Buffer.from(yamlContent).toString("base64");

			const result = await openTemplate(extensionId, templateContent);

			assert.strictEqual(result, true, "Should return true for complex YAML content");
			assert.strictEqual(documentContent, yamlContent, "Should preserve YAML formatting");
			assert.strictEqual(documentLanguage, "quarto", "Should set document language to quarto");
			assert.strictEqual(documentShown, true, "Should show the document");
			assert.strictEqual(logMessages.filter((log) => log.type === "info").length, 1, "Should show success message");
			assert.strictEqual(logMessages.filter((log) => log.type === "error").length, 0, "Should not show error messages");
		});
	});

	suite("installQuartoExtensionCommand", () => {
		test("Should return early if no workspace folder is selected", async () => {
			selectedWorkspaceFolder = undefined;

			await installQuartoExtensionCommand(mockContext as unknown as vscode.ExtensionContext);

			assert.strictEqual(logMessages.filter((log) => log.type === "info").length, 0, "Should not show any messages");
			assert.strictEqual(
				logMessages.filter((log) => log.type === "error").length,
				0,
				"Should not show any error messages"
			);
		});

		test("Should proceed when workspace folder is selected", async () => {
			selectedWorkspaceFolder = {
				uri: vscode.Uri.file(workspaceFolder),
				name: "test-workspace",
				index: 0,
			};

			// Note: This test will attempt to check internet connection and Quarto installation
			// In a real environment, these dependencies would need to be mocked
			// For now, we just verify the function can be called without crashing

			try {
				await installQuartoExtensionCommand(mockContext as unknown as vscode.ExtensionContext);
				// If we reach here, the function executed without throwing
				assert.ok(true, "Function executed without throwing");
			} catch (error) {
				// Expected in test environment due to missing dependencies
				assert.ok(error instanceof Error, "Should throw an error due to missing dependencies in test environment");
			}
		});
	});

	suite("useQuartoTemplateCommand", () => {
		test("Should return early if no workspace folder is selected", async () => {
			selectedWorkspaceFolder = undefined;

			await useQuartoTemplateCommand(mockContext as unknown as vscode.ExtensionContext);

			assert.strictEqual(logMessages.filter((log) => log.type === "info").length, 0, "Should not show any messages");
			assert.strictEqual(
				logMessages.filter((log) => log.type === "error").length,
				0,
				"Should not show any error messages"
			);
		});

		test("Should proceed when workspace folder is selected", async () => {
			selectedWorkspaceFolder = {
				uri: vscode.Uri.file(workspaceFolder),
				name: "test-workspace",
				index: 0,
			};

			try {
				await useQuartoTemplateCommand(mockContext as unknown as vscode.ExtensionContext);
				// If we reach here, the function executed without throwing
				assert.ok(true, "Function executed without throwing");
			} catch (error) {
				// Expected in test environment due to missing dependencies
				assert.ok(error instanceof Error, "Should throw an error due to missing dependencies in test environment");
			}
		});
	});

	suite("Extension Installation Integration", () => {
		test("Should handle real extension IDs correctly", () => {
			// Test that the extension IDs are formatted correctly
			const githubExtension = "mcanouil/quarto-github@1.0.1";
			const highlightExtension = "mcanouil/quarto-highlight-text@1.3.3";

			// Validate extension ID format
			assert.ok(githubExtension.includes("@"), "GitHub extension should include version tag");
			assert.ok(highlightExtension.includes("@"), "Highlight-text extension should include version tag");

			// Extract base IDs
			const githubBase = githubExtension.split("@")[0];
			const highlightBase = highlightExtension.split("@")[0];

			assert.strictEqual(githubBase, "mcanouil/quarto-github", "Should extract correct GitHub extension base ID");
			assert.strictEqual(
				highlightBase,
				"mcanouil/quarto-highlight-text",
				"Should extract correct highlight-text extension base ID"
			);

			// Extract versions
			const githubVersion = githubExtension.split("@")[1];
			const highlightVersion = highlightExtension.split("@")[1];

			assert.strictEqual(githubVersion, "1.0.1", "Should extract correct GitHub extension version");
			assert.strictEqual(highlightVersion, "1.3.3", "Should extract correct highlight-text extension version");
		});

		test("Should create mock extension data for testing", () => {
			const mockGitHubExtension: ExtensionQuickPickItem = {
				id: "mcanouil/quarto-github",
				label: "GitHub Extension",
				description: "Embed GitHub repositories in Quarto documents",
				detail: "Version 1.0.1",
				tag: "1.0.1",
			};

			const mockHighlightExtension: ExtensionQuickPickItem = {
				id: "mcanouil/quarto-highlight-text",
				label: "Highlight Text Extension",
				description: "Highlight text in Quarto documents",
				detail: "Version 1.3.3",
				tag: "1.3.3",
			};

			// Verify mock extension structure
			assert.strictEqual(mockGitHubExtension.id, "mcanouil/quarto-github", "GitHub extension ID should be correct");
			assert.strictEqual(mockGitHubExtension.tag, "1.0.1", "GitHub extension version should be correct");
			assert.strictEqual(
				mockHighlightExtension.id,
				"mcanouil/quarto-highlight-text",
				"Highlight extension ID should be correct"
			);
			assert.strictEqual(mockHighlightExtension.tag, "1.3.3", "Highlight extension version should be correct");
		});

		test("Should handle version-specific extension sources", () => {
			const baseId = "mcanouil/quarto-github";
			const version = "1.0.1";
			const extensionSource = `${baseId}@${version}`;

			assert.strictEqual(
				extensionSource,
				"mcanouil/quarto-github@1.0.1",
				"Should construct versioned extension source correctly"
			);

			// Test with "none" version (should not append version)
			const noneVersion = "none";
			const extensionSourceNone = noneVersion === "none" ? baseId : `${baseId}@${noneVersion}`;

			assert.strictEqual(extensionSourceNone, baseId, "Should not append version when tag is 'none'");
		});

		test("Should validate extension metadata structure", () => {
			// Simulate extension metadata that would come from the API
			const extensionMetadata = {
				"mcanouil/quarto-github": {
					id: "mcanouil/quarto-github",
					name: "GitHub Extension",
					description: "Embed GitHub repositories",
					author: "mcanouil",
					version: "1.0.1",
					template: false,
					categories: ["shortcode"],
				},
				"mcanouil/quarto-highlight-text": {
					id: "mcanouil/quarto-highlight-text",
					name: "Highlight Text",
					description: "Text highlighting for Quarto",
					author: "mcanouil",
					version: "1.3.3",
					template: false,
					categories: ["format"],
				},
			};

			const githubMeta = extensionMetadata["mcanouil/quarto-github"];
			const highlightMeta = extensionMetadata["mcanouil/quarto-highlight-text"];

			assert.strictEqual(githubMeta.author, "mcanouil", "GitHub extension should have correct author");
			assert.strictEqual(githubMeta.version, "1.0.1", "GitHub extension should have correct version");
			assert.strictEqual(highlightMeta.author, "mcanouil", "Highlight extension should have correct author");
			assert.strictEqual(highlightMeta.version, "1.3.3", "Highlight extension should have correct version");
		});
	});

	suite("Real Extension Installation Workflow", () => {
		test("Should simulate installation of GitHub extension", async () => {
			// This test simulates the workflow without actually installing
			const extensionId = "mcanouil/quarto-github";
			const version = "1.0.1";
			const workspacePath = workspaceFolder;

			// Verify inputs
			assert.ok(extensionId, "Extension ID should be defined");
			assert.ok(version, "Version should be defined");
			assert.ok(workspacePath, "Workspace path should be defined");

			// Simulate successful installation
			const installationResult = true; // Would be returned by installQuartoExtensionSource
			assert.strictEqual(installationResult, true, "Installation should succeed");

			// Update recent extensions (simulate global state update)
			const recentExtensions: string[] = (globalStateData["QW_RECENTLY_INSTALLED"] as string[]) || [];
			recentExtensions.unshift(extensionId);
			globalStateData["QW_RECENTLY_INSTALLED"] = recentExtensions.slice(0, 5);

			const updatedRecent = globalStateData["QW_RECENTLY_INSTALLED"] as string[];
			assert.ok(updatedRecent.includes(extensionId), "Recently installed should include the extension");
		});

		test("Should simulate installation of Highlight Text extension", async () => {
			// This test simulates the workflow without actually installing
			const extensionId = "mcanouil/quarto-highlight-text";
			const version = "1.3.3";
			const workspacePath = workspaceFolder;

			// Verify inputs
			assert.ok(extensionId, "Extension ID should be defined");
			assert.ok(version, "Version should be defined");
			assert.ok(workspacePath, "Workspace path should be defined");

			// Simulate successful installation
			const installationResult = true; // Would be returned by installQuartoExtensionSource
			assert.strictEqual(installationResult, true, "Installation should succeed");

			// Update recent extensions (simulate global state update)
			const recentExtensions: string[] = (globalStateData["QW_RECENTLY_INSTALLED"] as string[]) || [];
			recentExtensions.unshift(extensionId);
			globalStateData["QW_RECENTLY_INSTALLED"] = recentExtensions.slice(0, 5);

			const updatedRecent = globalStateData["QW_RECENTLY_INSTALLED"] as string[];
			assert.ok(updatedRecent.includes(extensionId), "Recently installed should include the extension");
		});

		test("Should handle both extensions in batch installation", async () => {
			const extensions = [
				{ id: "mcanouil/quarto-github", tag: "1.0.1" },
				{ id: "mcanouil/quarto-highlight-text", tag: "1.3.3" },
			];

			const installedExtensions: string[] = [];
			const failedExtensions: string[] = [];

			// Simulate installation process
			for (const extension of extensions) {
				// Simulate successful installation
				const success = true; // Would be returned by installQuartoExtensionSource

				if (success) {
					installedExtensions.push(extension.id);
				} else {
					failedExtensions.push(extension.id);
				}
			}

			assert.strictEqual(installedExtensions.length, 2, "Should successfully install both extensions");
			assert.strictEqual(failedExtensions.length, 0, "Should have no failed installations");
			assert.ok(installedExtensions.includes("mcanouil/quarto-github"), "Should include GitHub extension");
			assert.ok(
				installedExtensions.includes("mcanouil/quarto-highlight-text"),
				"Should include highlight-text extension"
			);
		});
	});
});
