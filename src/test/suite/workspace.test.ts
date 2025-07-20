import * as assert from "assert";
import * as vscode from "vscode";
import { selectWorkspaceFolder } from "../../utils/workspace";

suite("Workspace Utils Test Suite", () => {
	let originalWorkspaceFolders: typeof vscode.workspace.workspaceFolders;
	let originalShowWorkspaceFolderPick: typeof vscode.window.showWorkspaceFolderPick;

	let mockWorkspaceFolders: vscode.WorkspaceFolder[] | undefined;
	let workspaceFolderPickResult: vscode.WorkspaceFolder | undefined;

	setup(() => {
		// Store original methods
		originalWorkspaceFolders = vscode.workspace.workspaceFolders;
		originalShowWorkspaceFolderPick = vscode.window.showWorkspaceFolderPick;

		// Reset test state
		mockWorkspaceFolders = undefined;
		workspaceFolderPickResult = undefined;

		// Mock workspace folders
		Object.defineProperty(vscode.workspace, "workspaceFolders", {
			get: () => mockWorkspaceFolders,
			configurable: true,
		});

		// Mock showWorkspaceFolderPick
		vscode.window.showWorkspaceFolderPick = async () => workspaceFolderPickResult;
	});

	teardown(() => {
		// Restore original methods
		Object.defineProperty(vscode.workspace, "workspaceFolders", {
			value: originalWorkspaceFolders,
			configurable: true,
		});
		vscode.window.showWorkspaceFolderPick = originalShowWorkspaceFolderPick;
	});

	/**
	 * Helper function to create a mock workspace folder
	 */
	function createMockWorkspaceFolder(name: string, path: string): vscode.WorkspaceFolder {
		return {
			uri: vscode.Uri.file(path),
			name,
			index: 0,
		};
	}

	suite("selectWorkspaceFolder", () => {
		test("should return undefined when no workspace folders exist", async () => {
			mockWorkspaceFolders = undefined;

			const result = await selectWorkspaceFolder();

			assert.strictEqual(result, undefined);
		});

		test("should return undefined when workspace folders array is empty", async () => {
			mockWorkspaceFolders = [];

			const result = await selectWorkspaceFolder();

			assert.strictEqual(result, undefined);
		});

		test("should return the single workspace folder path when only one exists", async () => {
			const mockFolder = createMockWorkspaceFolder("test-project", "/path/to/test-project");
			mockWorkspaceFolders = [mockFolder];

			const result = await selectWorkspaceFolder();

			assert.strictEqual(result, mockFolder.uri.fsPath);
		});

		test("should prompt user selection when multiple workspace folders exist and return selected folder", async () => {
			const folder1 = createMockWorkspaceFolder("project1", "/path/to/project1");
			const folder2 = createMockWorkspaceFolder("project2", "/path/to/project2");
			mockWorkspaceFolders = [folder1, folder2];
			workspaceFolderPickResult = folder2;

			const result = await selectWorkspaceFolder();

			assert.strictEqual(result, folder2.uri.fsPath);
		});

		test("should return undefined when user cancels workspace folder selection", async () => {
			const folder1 = createMockWorkspaceFolder("project1", "/path/to/project1");
			const folder2 = createMockWorkspaceFolder("project2", "/path/to/project2");
			mockWorkspaceFolders = [folder1, folder2];
			workspaceFolderPickResult = undefined; // User cancelled

			const result = await selectWorkspaceFolder();

			assert.strictEqual(result, undefined);
		});

		test("should call showWorkspaceFolderPick with correct options", async () => {
			const folder1 = createMockWorkspaceFolder("project1", "/path/to/project1");
			const folder2 = createMockWorkspaceFolder("project2", "/path/to/project2");
			mockWorkspaceFolders = [folder1, folder2];

			let capturedOptions: vscode.WorkspaceFolderPickOptions | undefined;

			vscode.window.showWorkspaceFolderPick = async (options?: vscode.WorkspaceFolderPickOptions) => {
				capturedOptions = options;
				return workspaceFolderPickResult;
			};

			await selectWorkspaceFolder();

			assert.ok(capturedOptions);
			assert.strictEqual(capturedOptions.placeHolder, "Select a workspace folder");
			assert.strictEqual(capturedOptions.ignoreFocusOut, true);
		});

		test("should handle workspace folders with different indices", async () => {
			const folder1: vscode.WorkspaceFolder = {
				uri: vscode.Uri.file("/path/to/project1"),
				name: "project1",
				index: 0,
			};
			const folder2: vscode.WorkspaceFolder = {
				uri: vscode.Uri.file("/path/to/project2"),
				name: "project2",
				index: 1,
			};
			mockWorkspaceFolders = [folder1, folder2];
			workspaceFolderPickResult = folder1;

			const result = await selectWorkspaceFolder();

			assert.strictEqual(result, folder1.uri.fsPath);
		});

		test("should handle workspace folders with special characters in paths", async () => {
			const specialPath = "/path/to/project with spaces & special-chars!";
			const folder = createMockWorkspaceFolder("special-project", specialPath);
			mockWorkspaceFolders = [folder];

			const result = await selectWorkspaceFolder();

			assert.strictEqual(result, folder.uri.fsPath);
		});

		test("should handle workspace folders with Windows-style paths", async () => {
			const windowsPath = "C:\\Users\\test\\Documents\\project";
			const folder = createMockWorkspaceFolder("windows-project", windowsPath);
			mockWorkspaceFolders = [folder];

			const result = await selectWorkspaceFolder();

			assert.strictEqual(result, folder.uri.fsPath);
		});
	});
});
