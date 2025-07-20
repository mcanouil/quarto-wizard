import * as assert from "assert";
import * as vscode from "vscode";
import { activateExtensions } from "../../utils/activate";
import * as constants from "../../constants";

interface MockOutputChannel {
	appendLine: (message: string) => void;
}

interface MockExtension {
	id: string;
	isActive: boolean;
	activate: () => Promise<void>;
}

suite("Activate Utils Test Suite", () => {
	let originalGetExtension: typeof vscode.extensions.getExtension;
	let originalShowInformationMessage: typeof vscode.window.showInformationMessage;
	let originalExecuteCommand: typeof vscode.commands.executeCommand;
	let originalQwLog: MockOutputChannel;
	let mockExtensions: Map<string, MockExtension | undefined>;
	let globalStateValues: Record<string, unknown>;
	let logMessages: string[];
	let informationMessages: { message: string; items: string[] }[];
	let executedCommands: { command: string; args: unknown[] }[];
	let mockContext: vscode.ExtensionContext;

	setup(() => {
		// Store original methods
		originalGetExtension = vscode.extensions.getExtension;
		originalShowInformationMessage = vscode.window.showInformationMessage;
		originalExecuteCommand = vscode.commands.executeCommand;

		// Reset test state
		mockExtensions = new Map();
		globalStateValues = {};
		logMessages = [];
		informationMessages = [];
		executedCommands = [];

		// Mock extension context
		mockContext = {
			globalState: {
				get<T>(key: string): T | undefined {
					return globalStateValues[key] as T;
				},
				update: async (key: string, value: unknown) => {
					globalStateValues[key] = value;
				},
			},
		} as unknown as vscode.ExtensionContext;

		// Mock vscode.extensions.getExtension
		vscode.extensions.getExtension = <T>(extensionId: string): vscode.Extension<T> | undefined => {
			const mockExt = mockExtensions.get(extensionId);
			return mockExt as vscode.Extension<T> | undefined;
		};

		// Mock vscode.window.showInformationMessage
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(vscode.window as any).showInformationMessage = async (message: string, ...items: string[]) => {
			informationMessages.push({ message, items });
			// Return the first item by default for testing
			return items[0] || undefined;
		};

		// Mock vscode.commands.executeCommand
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(vscode.commands as any).executeCommand = async (command: string, ...args: unknown[]) => {
			executedCommands.push({ command, args });
			return undefined;
		};

		// Mock QW_LOG from constants
		originalQwLog = (constants as { QW_LOG: MockOutputChannel }).QW_LOG;
		(constants as { QW_LOG: MockOutputChannel }).QW_LOG = {
			appendLine: (message: string) => {
				logMessages.push(message);
			},
		};
	});

	teardown(() => {
		// Restore original methods
		vscode.extensions.getExtension = originalGetExtension;
		vscode.window.showInformationMessage = originalShowInformationMessage;
		vscode.commands.executeCommand = originalExecuteCommand;

		// Restore QW_LOG
		(constants as { QW_LOG: MockOutputChannel }).QW_LOG = originalQwLog;
	});

	suite("activateExtensions", () => {
		test("should activate inactive extension when it exists", async () => {
			const extensionId = "test.extension";
			const mockExtension: MockExtension = {
				id: extensionId,
				isActive: false,
				activate: async () => {
					mockExtension.isActive = true;
				},
			};

			mockExtensions.set(extensionId, mockExtension);

			await activateExtensions([extensionId], mockContext);

			// Allow async operations to complete
			await new Promise((resolve) => setTimeout(resolve, 0));

			assert.strictEqual(mockExtension.isActive, true);
			assert.strictEqual(logMessages.length, 1);
			assert.ok(logMessages[0].includes(`${extensionId} activated.`));
		});

		test("should not activate extension when it is already active", async () => {
			const extensionId = "test.extension";
			const mockExtension: MockExtension = {
				id: extensionId,
				isActive: true,
				activate: async () => {
					// Should not be called
					throw new Error("Should not activate already active extension");
				},
			};

			mockExtensions.set(extensionId, mockExtension);

			await activateExtensions([extensionId], mockContext);

			// Allow async operations to complete
			await new Promise((resolve) => setTimeout(resolve, 0));

			// Should not log activation since it's already active
			const activationLogs = logMessages.filter((msg) => msg.includes("activated"));
			assert.strictEqual(activationLogs.length, 0);
		});

		test("should prompt for installation when extension does not exist", async () => {
			const extensionId = "nonexistent.extension";
			mockExtensions.set(extensionId, undefined);

			await activateExtensions([extensionId], mockContext);

			// Allow async operations to complete
			await new Promise((resolve) => setTimeout(resolve, 0));

			assert.strictEqual(logMessages.length, 2);
			assert.ok(logMessages[0].includes(`Failed to activate ${extensionId}.`));
			// Should have prompted for installation
			assert.strictEqual(informationMessages.length, 1);
			assert.ok(informationMessages[0].message.includes(`Extension '${extensionId}' is not installed`));
		});

		test("should handle multiple extensions", async () => {
			const extension1 = "test.extension1";
			const extension2 = "test.extension2";
			const extension3 = "nonexistent.extension";

			const mockExt1: MockExtension = {
				id: extension1,
				isActive: false,
				activate: async () => {
					// Mock activation
				},
			};
			const mockExt2: MockExtension = {
				id: extension2,
				isActive: true,
				activate: async () => {
					// Mock activation
				},
			};

			mockExtensions.set(extension1, mockExt1);
			mockExtensions.set(extension2, mockExt2);
			mockExtensions.set(extension3, undefined);

			await activateExtensions([extension1, extension2, extension3], mockContext);

			// Allow async operations to complete
			await new Promise((resolve) => setTimeout(resolve, 0));

			// Should have logs for activation and failure
			const activationLogs = logMessages.filter((msg) => msg.includes("activated"));
			const failureLogs = logMessages.filter((msg) => msg.includes("Failed to activate"));

			assert.strictEqual(activationLogs.length, 1);
			assert.strictEqual(failureLogs.length, 1);
			assert.ok(activationLogs[0].includes(extension1));
			assert.ok(failureLogs[0].includes(extension3));
		});
	});

	suite("promptInstallExtension (via activateExtensions)", () => {
		test("should install extension when user chooses 'Install Now'", async () => {
			const extensionId = "test.extension";
			mockExtensions.set(extensionId, undefined);

			// Mock user choosing "Install Now"
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(vscode.window as any).showInformationMessage = async (message: string, ...items: string[]) => {
				informationMessages.push({ message, items });
				return "Install Now";
			};

			await activateExtensions([extensionId], mockContext);

			// Allow async operations to complete
			await new Promise((resolve) => setTimeout(resolve, 0));

			assert.strictEqual(executedCommands.length, 1);
			assert.strictEqual(executedCommands[0].command, "workbench.extensions.installExtension");
			assert.deepStrictEqual(executedCommands[0].args, [extensionId]);

			const installationLogs = logMessages.filter((msg) => msg.includes("installation initiated"));
			assert.strictEqual(installationLogs.length, 1);
			assert.ok(installationLogs[0].includes(extensionId));
		});

		test("should set global state when user chooses 'Maybe Later'", async () => {
			const extensionId = "test.extension";
			mockExtensions.set(extensionId, undefined);

			// Mock user choosing "Maybe Later"
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(vscode.window as any).showInformationMessage = async (message: string, ...items: string[]) => {
				informationMessages.push({ message, items });
				return "Maybe Later";
			};

			await activateExtensions([extensionId], mockContext);

			// Allow async operations to complete
			await new Promise((resolve) => setTimeout(resolve, 0));

			assert.strictEqual(globalStateValues[`PromptInstallExtension.${extensionId}`], true);

			const laterLogs = logMessages.filter((msg) => msg.includes("install") && msg.includes("later"));
			assert.strictEqual(laterLogs.length, 1);
			assert.ok(laterLogs[0].includes(extensionId));
		});

		test("should set global state when user chooses 'Don't Ask Again'", async () => {
			const extensionId = "test.extension";
			mockExtensions.set(extensionId, undefined);

			// Mock user choosing "Don't Ask Again"
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(vscode.window as any).showInformationMessage = async (message: string, ...items: string[]) => {
				informationMessages.push({ message, items });
				return "Don't Ask Again";
			};

			await activateExtensions([extensionId], mockContext);

			// Allow async operations to complete
			await new Promise((resolve) => setTimeout(resolve, 0));

			assert.strictEqual(globalStateValues[`PromptInstallExtension.${extensionId}`], false);

			const dontAskLogs = logMessages.filter((msg) => msg.includes("not to be asked again"));
			assert.strictEqual(dontAskLogs.length, 1);
			assert.ok(dontAskLogs[0].includes(extensionId));
		});

		test("should not prompt when global state is set to false", async () => {
			const extensionId = "test.extension";
			mockExtensions.set(extensionId, undefined);

			// Set global state to indicate user doesn't want to be asked
			globalStateValues[`PromptInstallExtension.${extensionId}`] = false;

			await activateExtensions([extensionId], mockContext);

			// Allow async operations to complete
			await new Promise((resolve) => setTimeout(resolve, 0));

			// Should still log failure but not show prompt
			const failureLogs = logMessages.filter((msg) => msg.includes("Failed to activate"));
			assert.strictEqual(failureLogs.length, 1);
			assert.strictEqual(informationMessages.length, 0);
		});

		test("should prompt again when global state is set to true or undefined", async () => {
			const extensionId1 = "test.extension1";
			const extensionId2 = "test.extension2";

			mockExtensions.set(extensionId1, undefined);
			mockExtensions.set(extensionId2, undefined);

			// Set one to true, leave other undefined
			globalStateValues[`PromptInstallExtension.${extensionId1}`] = true;

			await activateExtensions([extensionId1, extensionId2], mockContext);

			// Allow async operations to complete
			await new Promise((resolve) => setTimeout(resolve, 0));

			// Should prompt for both extensions
			assert.strictEqual(informationMessages.length, 2);
		});

		test("should handle user cancelling the prompt", async () => {
			const extensionId = "test.extension";
			mockExtensions.set(extensionId, undefined);

			// Mock user cancelling (returning undefined)
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(vscode.window as any).showInformationMessage = async (message: string, ...items: string[]) => {
				informationMessages.push({ message, items });
				return undefined;
			};

			await activateExtensions([extensionId], mockContext);

			// Allow async operations to complete
			await new Promise((resolve) => setTimeout(resolve, 0));

			// Should not execute any commands or update global state
			assert.strictEqual(executedCommands.length, 0);
			assert.strictEqual(Object.keys(globalStateValues).length, 0);
		});
	});

	test("should handle extension activation errors gracefully", async () => {
		const extensionId = "test.extension";
		const mockExtension: MockExtension = {
			id: extensionId,
			isActive: false,
			activate: async () => {
				throw new Error("Activation failed");
			},
		};

		mockExtensions.set(extensionId, mockExtension);

		await activateExtensions([extensionId], mockContext);

		// Allow async operations to complete
		await new Promise((resolve) => setTimeout(resolve, 0));

		// Should not crash, but activation will fail silently in the current implementation
		// This is expected behaviour as the function doesn't explicitly handle activation errors
		assert.strictEqual(mockExtension.isActive, false);
	});
});
