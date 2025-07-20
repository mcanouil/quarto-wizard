import * as assert from "assert";
import * as vscode from "vscode";
import { askTrustAuthors, askConfirmInstall, askConfirmRemove } from "../../utils/ask";

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

		// Mock VS Code APIs
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(vscode.workspace as any).getConfiguration = () => mockConfig;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(vscode.window as any).showQuickPick = async () => quickPickResult;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(vscode.window as any).showInformationMessage = async () => undefined;
	});

	teardown(() => {
		// Restore original methods
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(vscode.workspace as any).getConfiguration = originalGetConfiguration;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(vscode.window as any).showQuickPick = originalShowQuickPick;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(vscode.window as any).showInformationMessage = originalShowInformationMessage;
	});

	suite("askTrustAuthors", () => {
		test("Should return 0 when trustAuthors is not 'ask'", async () => {
			configValues["trustAuthors"] = "never";

			const result = await askTrustAuthors();

			assert.strictEqual(result, 0);
		});

		test("Should return 0 when user selects 'Yes'", async () => {
			configValues["trustAuthors"] = "ask";
			quickPickResult = { label: "Yes", description: "Trust authors." };

			const result = await askTrustAuthors();

			assert.strictEqual(result, 0);
			assert.strictEqual(updateCalls.length, 0);
		});

		test("Should return 0 and update config when user selects 'Yes, always trust'", async () => {
			configValues["trustAuthors"] = "ask";
			quickPickResult = { label: "Yes, always trust", description: "Change setting to always trust." };

			const result = await askTrustAuthors();

			assert.strictEqual(result, 0);
			assert.strictEqual(updateCalls.length, 1);
			assert.strictEqual(updateCalls[0].key, "trustAuthors");
			assert.strictEqual(updateCalls[0].value, "never");
			assert.strictEqual(updateCalls[0].target, vscode.ConfigurationTarget.Global);
		});

		test("Should return 1 when user selects 'No'", async () => {
			configValues["trustAuthors"] = "ask";
			quickPickResult = { label: "No", description: "Do not trust authors." };

			const result = await askTrustAuthors();

			assert.strictEqual(result, 1);
		});

		test("Should return 1 when user cancels the prompt", async () => {
			configValues["trustAuthors"] = "ask";
			quickPickResult = undefined;

			const result = await askTrustAuthors();

			assert.strictEqual(result, 1);
		});
	});

	suite("askConfirmInstall", () => {
		test("Should return 0 when confirmInstall is not 'ask'", async () => {
			configValues["confirmInstall"] = "never";

			const result = await askConfirmInstall();

			assert.strictEqual(result, 0);
		});

		test("Should return 0 when user selects 'Yes'", async () => {
			configValues["confirmInstall"] = "ask";
			quickPickResult = { label: "Yes", description: "Install extensions." };

			const result = await askConfirmInstall();

			assert.strictEqual(result, 0);
			assert.strictEqual(updateCalls.length, 0);
		});

		test("Should return 0 and update config when user selects 'Yes, always trust'", async () => {
			configValues["confirmInstall"] = "ask";
			quickPickResult = { label: "Yes, always trust", description: "Change setting to always trust." };

			const result = await askConfirmInstall();

			assert.strictEqual(result, 0);
			assert.strictEqual(updateCalls.length, 1);
			assert.strictEqual(updateCalls[0].key, "confirmInstall");
			assert.strictEqual(updateCalls[0].value, "never");
			assert.strictEqual(updateCalls[0].target, vscode.ConfigurationTarget.Global);
		});

		test("Should return 1 when user selects 'No'", async () => {
			configValues["confirmInstall"] = "ask";
			quickPickResult = { label: "No", description: "Do not install extensions." };

			const result = await askConfirmInstall();

			assert.strictEqual(result, 1);
		});

		test("Should return 1 when user cancels the prompt", async () => {
			configValues["confirmInstall"] = "ask";
			quickPickResult = undefined;

			const result = await askConfirmInstall();

			assert.strictEqual(result, 1);
		});
	});

	suite("askConfirmRemove", () => {
		test("Should return 0 when confirmRemove is not 'always'", async () => {
			configValues["confirmRemove"] = "never";

			const result = await askConfirmRemove();

			assert.strictEqual(result, 0);
		});

		test("Should return 0 when user selects 'Yes'", async () => {
			configValues["confirmRemove"] = "always";
			quickPickResult = { label: "Yes", description: "Remove extensions." };

			const result = await askConfirmRemove();

			assert.strictEqual(result, 0);
			assert.strictEqual(updateCalls.length, 0);
		});

		test("Should return 0 and update config when user selects 'Yes, always trust'", async () => {
			configValues["confirmRemove"] = "always";
			quickPickResult = { label: "Yes, always trust", description: "Change setting to always trust." };

			const result = await askConfirmRemove();

			assert.strictEqual(result, 0);
			assert.strictEqual(updateCalls.length, 1);
			assert.strictEqual(updateCalls[0].key, "confirmRemove");
			assert.strictEqual(updateCalls[0].value, "never");
			assert.strictEqual(updateCalls[0].target, vscode.ConfigurationTarget.Global);
		});

		test("Should return 1 when user selects 'No'", async () => {
			configValues["confirmRemove"] = "always";
			quickPickResult = { label: "No", description: "Do not remove extensions." };

			const result = await askConfirmRemove();

			assert.strictEqual(result, 1);
		});

		test("Should return 1 when user cancels the prompt", async () => {
			configValues["confirmRemove"] = "always";
			quickPickResult = undefined;

			const result = await askConfirmRemove();

			assert.strictEqual(result, 1);
		});
	});
});
