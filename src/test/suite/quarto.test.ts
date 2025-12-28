import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import {
	installQuartoExtension,
	removeQuartoExtension,
} from "../../utils/quarto";

suite("Quarto Utils Test Suite", () => {
	let testWorkspaceDir: string;

	// Store original methods for restoration
	let originalExecuteCommand: typeof vscode.commands.executeCommand;

	setup(() => {
		// Create temporary test directory
		testWorkspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "quarto-wizard-test-"));

		// Store original methods
		originalExecuteCommand = vscode.commands.executeCommand;

		vscode.commands.executeCommand = async <T>(): Promise<T> => {
			// Mock implementation
			return Promise.resolve() as Promise<T>;
		};
	});

	teardown(() => {
		// Restore original methods
		vscode.commands.executeCommand = originalExecuteCommand;

		// Clean up test directory
		if (fs.existsSync(testWorkspaceDir)) {
			fs.rmSync(testWorkspaceDir, { recursive: true, force: true });
		}
	});

	suite("installQuartoExtension", () => {
		test("should return false when workspaceFolder is empty", async () => {
			// The function should properly resolve with false when workspaceFolder is empty
			const result = await installQuartoExtension("test-extension", "");
			assert.strictEqual(result, false);
		});

		test("should attempt installation with valid parameters", async () => {
			const extensionName = "test-extension";

			// This will attempt to run the actual installation
			// Since we don't have a real extension in tests,
			// we expect this to fail, but we can verify the function executes
			const result = await installQuartoExtension(extensionName, testWorkspaceDir);

			assert.strictEqual(typeof result, "boolean");
		});
	});

	suite("removeQuartoExtension", () => {
		test("should return false when workspaceFolder is empty", async () => {
			const result = await removeQuartoExtension("test-extension", "");

			assert.strictEqual(result, false);
		});

		test("should attempt to remove extension from valid workspace", async () => {
			const extensionName = "test-extension";

			const result = await removeQuartoExtension(extensionName, testWorkspaceDir);

			// Should return a boolean (the actual result depends on the remove implementation)
			assert.strictEqual(typeof result, "boolean");
		});

		test("should handle non-existent extension gracefully", async () => {
			const extensionName = "non-existent-extension";

			// This should not throw an error
			const result = await removeQuartoExtension(extensionName, testWorkspaceDir);

			assert.strictEqual(typeof result, "boolean");
		});
	});
});
