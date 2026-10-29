import * as assert from "assert";
import * as vscode from "vscode";
import { selectWorkspaceFolder } from "../../utils/workspace";
import { invalidateProjectRoots } from "../../utils/projectRootsRegistry";

interface MockQuickPickResult {
	root: { fsPath: string };
}

suite("Workspace Utils Test Suite", () => {
	let originalWorkspaceFolders: typeof vscode.workspace.workspaceFolders;
	let originalShowQuickPick: typeof vscode.window.showQuickPick;

	let mockWorkspaceFolders: vscode.WorkspaceFolder[] | undefined;
	let quickPickResult: MockQuickPickResult | undefined;
	let lastQuickPickItems: readonly vscode.QuickPickItem[] | undefined;
	let lastQuickPickOptions: vscode.QuickPickOptions | undefined;

	setup(() => {
		originalWorkspaceFolders = vscode.workspace.workspaceFolders;
		originalShowQuickPick = vscode.window.showQuickPick;

		mockWorkspaceFolders = undefined;
		quickPickResult = undefined;
		lastQuickPickItems = undefined;
		lastQuickPickOptions = undefined;

		// `selectWorkspaceFolder` reads the shared registry, and each test installs
		// its own workspace folders without the events that refresh the snapshot.
		invalidateProjectRoots();

		// The mock folders are not on disk, so discovery falls back to each workspace folder.
		Object.defineProperty(vscode.workspace, "workspaceFolders", {
			get: () => mockWorkspaceFolders,
			configurable: true,
		});

		vscode.window.showQuickPick = (async (
			items: readonly vscode.QuickPickItem[] | Thenable<readonly vscode.QuickPickItem[]>,
			options?: vscode.QuickPickOptions,
		) => {
			lastQuickPickItems = await Promise.resolve(items);
			lastQuickPickOptions = options;
			return quickPickResult as unknown as vscode.QuickPickItem;
		}) as unknown as typeof vscode.window.showQuickPick;
	});

	teardown(() => {
		Object.defineProperty(vscode.workspace, "workspaceFolders", {
			value: originalWorkspaceFolders,
			configurable: true,
		});
		invalidateProjectRoots();
		vscode.window.showQuickPick = originalShowQuickPick;
	});

	function createMockWorkspaceFolder(name: string, fsPath: string, index = 0): vscode.WorkspaceFolder {
		return { uri: vscode.Uri.file(fsPath), name, index };
	}

	suite("selectWorkspaceFolder", () => {
		test("returns undefined when no workspace folders exist", async () => {
			mockWorkspaceFolders = undefined;
			const result = await selectWorkspaceFolder();
			assert.strictEqual(result, undefined);
		});

		test("returns undefined when workspace folders array is empty", async () => {
			mockWorkspaceFolders = [];
			const result = await selectWorkspaceFolder();
			assert.strictEqual(result, undefined);
		});

		test("returns the single workspace folder path when only one root is detected", async () => {
			const folder = createMockWorkspaceFolder("test-project", "/path/to/test-project");
			mockWorkspaceFolders = [folder];

			const result = await selectWorkspaceFolder();

			assert.strictEqual(result, folder.uri.fsPath);
		});

		test("prompts the user when multiple roots exist and returns the picked path", async () => {
			const folder1 = createMockWorkspaceFolder("project1", "/path/to/project1", 0);
			const folder2 = createMockWorkspaceFolder("project2", "/path/to/project2", 1);
			mockWorkspaceFolders = [folder1, folder2];
			quickPickResult = { root: { fsPath: folder2.uri.fsPath } };

			const result = await selectWorkspaceFolder();

			assert.strictEqual(result, folder2.uri.fsPath);
			assert.ok(lastQuickPickItems);
			assert.strictEqual(lastQuickPickItems.length, 2);
			assert.ok(lastQuickPickOptions);
			assert.strictEqual(lastQuickPickOptions.placeHolder, "Select a Quarto project folder");
			assert.strictEqual(lastQuickPickOptions.ignoreFocusOut, true);
		});

		test("returns undefined when the user dismisses the picker", async () => {
			const folder1 = createMockWorkspaceFolder("project1", "/path/to/project1", 0);
			const folder2 = createMockWorkspaceFolder("project2", "/path/to/project2", 1);
			mockWorkspaceFolders = [folder1, folder2];
			quickPickResult = undefined;

			const result = await selectWorkspaceFolder();

			assert.strictEqual(result, undefined);
		});

		test("handles workspace folders with special characters in paths", async () => {
			const specialPath = "/path/to/project with spaces & special-chars!";
			const folder = createMockWorkspaceFolder("special-project", specialPath);
			mockWorkspaceFolders = [folder];

			const result = await selectWorkspaceFolder();

			assert.strictEqual(result, folder.uri.fsPath);
		});

		test("handles workspace folders with Windows-style paths", async () => {
			const windowsPath = "C:\\Users\\test\\Documents\\project";
			const folder = createMockWorkspaceFolder("windows-project", windowsPath);
			mockWorkspaceFolders = [folder];

			const result = await selectWorkspaceFolder();

			assert.strictEqual(result, folder.uri.fsPath);
		});
	});
});
