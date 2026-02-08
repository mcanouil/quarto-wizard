import * as assert from "assert";
import * as vscode from "vscode";
import { confirmTrustAuthors, confirmInstall } from "../../utils/ask";

/**
 * Mock implementation for testing VS Code configuration
 */
interface MockConfig {
	get<T>(key: string): T | undefined;
	update(key: string, value: unknown, target?: vscode.ConfigurationTarget): Promise<void>;
}

suite("Ask Utils Test Suite", () => {
	let originalGetConfiguration: typeof vscode.workspace.getConfiguration;
	let originalShowQuickPick: typeof vscode.window.showQuickPick;
	let originalShowInformationMessage: typeof vscode.window.showInformationMessage;

	let mockConfig: MockConfig;
	let quickPickResult: vscode.QuickPickItem | undefined;
	let configValues: Record<string, unknown>;
	let updateCalls: { key: string; value: unknown; target?: vscode.ConfigurationTarget }[];

	setup(() => {
		// Store original methods
		originalGetConfiguration = vscode.workspace.getConfiguration;
		originalShowQuickPick = vscode.window.showQuickPick;
		originalShowInformationMessage = vscode.window.showInformationMessage;

		// Reset test state
		configValues = {};
		updateCalls = [];
		quickPickResult = undefined;

		// Create mock configuration
		mockConfig = {
			get: <T>(key: string): T | undefined => {
				return configValues[key] as T;
			},
			update: async (key: string, value: unknown, target?: vscode.ConfigurationTarget) => {
				updateCalls.push({ key, value, target });
				configValues[key] = value;
			},
		};

		// Mock VS Code APIs using Object.defineProperty to avoid 'any' casts
		Object.defineProperty(vscode.workspace, "getConfiguration", {
			value: () => mockConfig,
			writable: true,
			configurable: true,
		});
		Object.defineProperty(vscode.window, "showQuickPick", {
			value: async () => quickPickResult,
			writable: true,
			configurable: true,
		});
		Object.defineProperty(vscode.window, "showInformationMessage", {
			value: async () => undefined,
			writable: true,
			configurable: true,
		});
	});

	teardown(() => {
		// Restore original methods
		Object.defineProperty(vscode.workspace, "getConfiguration", {
			value: originalGetConfiguration,
			writable: true,
			configurable: true,
		});
		Object.defineProperty(vscode.window, "showQuickPick", {
			value: originalShowQuickPick,
			writable: true,
			configurable: true,
		});
		Object.defineProperty(vscode.window, "showInformationMessage", {
			value: originalShowInformationMessage,
			writable: true,
			configurable: true,
		});
	});

	suite("confirmTrustAuthors", () => {
		test("Should return true when trustAuthors is not 'ask'", async () => {
			configValues["trustAuthors"] = "never";

			const result = await confirmTrustAuthors();

			assert.strictEqual(result, true);
		});

		test("Should return true when user selects 'Yes'", async () => {
			configValues["trustAuthors"] = "ask";
			quickPickResult = { label: "Yes", description: "Trust authors." };

			const result = await confirmTrustAuthors();

			assert.strictEqual(result, true);
			assert.strictEqual(updateCalls.length, 0);
		});

		test("Should return true and update config when user selects 'Yes, always trust'", async () => {
			configValues["trustAuthors"] = "ask";
			quickPickResult = { label: "Yes, always trust", description: "Change setting to always trust." };

			const result = await confirmTrustAuthors();

			assert.strictEqual(result, true);
			assert.strictEqual(updateCalls.length, 1);
			assert.strictEqual(updateCalls[0].key, "trustAuthors");
			assert.strictEqual(updateCalls[0].value, "never");
			assert.strictEqual(updateCalls[0].target, vscode.ConfigurationTarget.Global);
		});

		test("Should return false when user selects 'No'", async () => {
			configValues["trustAuthors"] = "ask";
			quickPickResult = { label: "No", description: "Do not trust authors." };

			const result = await confirmTrustAuthors();

			assert.strictEqual(result, false);
		});

		test("Should return false when user cancels the prompt", async () => {
			configValues["trustAuthors"] = "ask";
			quickPickResult = undefined;

			const result = await confirmTrustAuthors();

			assert.strictEqual(result, false);
		});
	});

	suite("confirmInstall", () => {
		test("Should return true when confirmInstall is not 'ask'", async () => {
			configValues["confirmInstall"] = "never";

			const result = await confirmInstall();

			assert.strictEqual(result, true);
		});

		test("Should return true when user selects 'Yes'", async () => {
			configValues["confirmInstall"] = "ask";
			quickPickResult = { label: "Yes", description: "Install extensions." };

			const result = await confirmInstall();

			assert.strictEqual(result, true);
			assert.strictEqual(updateCalls.length, 0);
		});

		test("Should return true and update config when user selects 'Yes, always install'", async () => {
			configValues["confirmInstall"] = "ask";
			quickPickResult = { label: "Yes, always install", description: "Change setting to always install." };

			const result = await confirmInstall();

			assert.strictEqual(result, true);
			assert.strictEqual(updateCalls.length, 1);
			assert.strictEqual(updateCalls[0].key, "confirmInstall");
			assert.strictEqual(updateCalls[0].value, "never");
			assert.strictEqual(updateCalls[0].target, vscode.ConfigurationTarget.Global);
		});

		test("Should return false when user selects 'No'", async () => {
			configValues["confirmInstall"] = "ask";
			quickPickResult = { label: "No", description: "Do not install extensions." };

			const result = await confirmInstall();

			assert.strictEqual(result, false);
		});

		test("Should return false when user cancels the prompt", async () => {
			configValues["confirmInstall"] = "ask";
			quickPickResult = undefined;

			const result = await confirmInstall();

			assert.strictEqual(result, false);
		});
	});
});
