import * as assert from "assert";
import * as vscode from "vscode";
import { createExtensionItems, showExtensionQuickPick, ExtensionQuickPickItem } from "../../ui/extensionsQuickPick";
import { ExtensionDetails } from "../../utils/extensionDetails";

suite("Extensions QuickPick Test Suite", () => {
	let originalCreateQuickPick: typeof vscode.window.createQuickPick;
	let originalOpenExternal: typeof vscode.env.openExternal;
	let mockQuickPick: MockQuickPick;
	let openExternalCalls: vscode.Uri[];

	/**
	 * Mock implementation of VS Code QuickPick
	 */
	class MockQuickPick {
		public items: ExtensionQuickPickItem[] = [];
		public placeholder = "";
		public canSelectMany = false;
		public matchOnDescription = false;
		public selectedItems: readonly ExtensionQuickPickItem[] = [];

		private _onDidAcceptHandlers: (() => void)[] = [];
		private _onDidTriggerItemButtonHandlers: ((e: { item: ExtensionQuickPickItem }) => void)[] = [];

		onDidAccept(handler: () => void): void {
			this._onDidAcceptHandlers.push(handler);
		}

		onDidTriggerItemButton(handler: (e: { item: ExtensionQuickPickItem }) => void): void {
			this._onDidTriggerItemButtonHandlers.push(handler);
		}

		show(): void {
			// Mock implementation - does nothing
		}

		hide(): void {
			// Mock implementation - does nothing
		}

		// Test helper methods
		triggerAccept(): void {
			this._onDidAcceptHandlers.forEach((handler) => handler());
		}

		triggerItemButton(item: ExtensionQuickPickItem): void {
			this._onDidTriggerItemButtonHandlers.forEach((handler) => handler({ item }));
		}

		setSelectedItems(items: ExtensionQuickPickItem[]): void {
			(this.selectedItems as ExtensionQuickPickItem[]) = items;
		}
	}

	const mockExtensionDetails: ExtensionDetails[] = [
		{
			id: "ext1",
			name: "Extension One",
			full_name: "author1/ext1",
			owner: "author1",
			description: "First test extension",
			stars: 100,
			license: "MIT",
			html_url: "https://github.com/author1/ext1",
			version: "1.0.0",
			tag: "v1.0.0",
			template: false,
		},
		{
			id: "ext2",
			name: "Extension Two",
			full_name: "author2/ext2",
			owner: "author2",
			description: "Second test extension",
			stars: 50,
			license: "Apache-2.0",
			html_url: "https://github.com/author2/ext2",
			version: "2.1.0",
			tag: "v2.1.0",
			template: true,
		},
		{
			id: "ext3",
			name: "Extension Three",
			full_name: "author3/ext3",
			owner: "author3",
			description: "Third test extension",
			stars: 25,
			license: "GPL-3.0",
			html_url: "https://github.com/author3/ext3",
			version: "0.5.0",
			tag: "v0.5.0",
			template: false,
		},
	];

	setup(() => {
		// Store original methods
		originalCreateQuickPick = vscode.window.createQuickPick;
		originalOpenExternal = vscode.env.openExternal;

		// Reset test state
		openExternalCalls = [];
		mockQuickPick = new MockQuickPick();

		// Mock VS Code APIs
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(vscode.window as any).createQuickPick = () => mockQuickPick;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(vscode.env as any).openExternal = async (uri: vscode.Uri) => {
			openExternalCalls.push(uri);
			return true;
		};
	});

	teardown(() => {
		// Restore original methods
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(vscode.window as any).createQuickPick = originalCreateQuickPick;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(vscode.env as any).openExternal = originalOpenExternal;
	});

	suite("createExtensionItems", () => {
		test("Should create QuickPick items from extension details", () => {
			const items = createExtensionItems(mockExtensionDetails);

			assert.strictEqual(items.length, 3);

			// Test first item
			const firstItem = items[0];
			assert.strictEqual(firstItem.label, "Extension One");
			assert.strictEqual(firstItem.description, "$(tag) 1.0.0 $(star) 100 $(repo) author1/ext1 $(law) MIT");
			assert.strictEqual(firstItem.detail, "First test extension");
			assert.strictEqual(firstItem.url, "https://github.com/author1/ext1");
			assert.strictEqual(firstItem.id, "ext1");
			assert.strictEqual(firstItem.tag, "v1.0.0");
			assert.strictEqual(firstItem.template, false);

			// Test template item
			const templateItem = items[1];
			assert.strictEqual(templateItem.label, "Extension Two");
			assert.strictEqual(templateItem.template, true);

			// Verify all items have GitHub button
			items.forEach((item) => {
				assert.strictEqual(item.buttons?.length, 1);
				assert.strictEqual(item.buttons[0].tooltip, "Open GitHub Repository");
			});
		});

		test("Should handle empty extension list", () => {
			const items = createExtensionItems([]);
			assert.strictEqual(items.length, 0);
		});

		test("Should handle extension with missing optional fields", () => {
			const minimalExtension: ExtensionDetails = {
				id: "minimal",
				name: "Minimal Extension",
				full_name: "user/minimal",
				owner: "user",
				description: "Minimal description",
				stars: 0,
				license: "Unknown",
				html_url: "https://github.com/user/minimal",
				version: "1.0.0",
				tag: "v1.0.0",
				template: false,
			};

			const items = createExtensionItems([minimalExtension]);
			assert.strictEqual(items.length, 1);
			assert.strictEqual(items[0].label, "Minimal Extension");
		});
	});

	suite("showExtensionQuickPick", () => {
		test("Should configure QuickPick for extension installation", async () => {
			const recentlyInstalled = ["ext1"];
			const promise = showExtensionQuickPick(mockExtensionDetails, recentlyInstalled, false);

			// Verify QuickPick configuration
			assert.strictEqual(mockQuickPick.placeholder, "Select Quarto extensions to install");
			assert.strictEqual(mockQuickPick.canSelectMany, true);
			assert.strictEqual(mockQuickPick.matchOnDescription, true);

			// Verify items are properly grouped
			assert.strictEqual(mockQuickPick.items.length, 5); // 2 separators + 3 extension items (1 recent + 2 all)
			assert.strictEqual(mockQuickPick.items[0].label, "Recently Installed");
			assert.strictEqual(mockQuickPick.items[0].kind, vscode.QuickPickItemKind.Separator);
			assert.strictEqual(mockQuickPick.items[2].label, "All Extensions");
			assert.strictEqual(mockQuickPick.items[2].kind, vscode.QuickPickItemKind.Separator);

			// Verify recently installed item is first
			assert.strictEqual(mockQuickPick.items[1].label, "Extension One");

			// Simulate user selection and acceptance
			const selectedItems = [mockQuickPick.items[1], mockQuickPick.items[4]]; // Recently installed (ext1) + first from all extensions
			mockQuickPick.setSelectedItems(selectedItems);
			mockQuickPick.triggerAccept();

			const result = await promise;
			assert.strictEqual(result.length, 2);
			assert.strictEqual(result[0].label, "Extension One");
		});

		test("Should configure QuickPick for template selection", async () => {
			const recentlyUsed = ["ext2"];
			const promise = showExtensionQuickPick(mockExtensionDetails, recentlyUsed, true);

			// Verify QuickPick configuration for templates
			assert.strictEqual(mockQuickPick.placeholder, "Select Quarto extension template to use");
			assert.strictEqual(mockQuickPick.canSelectMany, false);
			assert.strictEqual(mockQuickPick.matchOnDescription, true);

			// Verify separator label is different for templates
			assert.strictEqual(mockQuickPick.items[0].label, "Recently Used");

			// Simulate template selection
			const selectedTemplate = mockQuickPick.items[1]; // Recently used template
			mockQuickPick.setSelectedItems([selectedTemplate]);
			mockQuickPick.triggerAccept();

			const result = await promise;
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].id, "ext2");
		});

		test("Should sort non-recently used extensions alphabetically", async () => {
			const recentlyInstalled = ["ext2"]; // Only ext2 is recently installed
			const promise = showExtensionQuickPick(mockExtensionDetails, recentlyInstalled, false);

			// Find the "All Extensions" section (starts after separator at index 2)
			const allExtensionsStart = 3;
			const sortedExtensions = mockQuickPick.items.slice(allExtensionsStart);

			// Should be sorted alphabetically: "Extension One", "Extension Three"
			assert.strictEqual(sortedExtensions[0].label, "Extension One");
			assert.strictEqual(sortedExtensions[1].label, "Extension Three");

			mockQuickPick.triggerAccept();
			await promise;
		});

		test("Should handle empty recently installed list", async () => {
			const promise = showExtensionQuickPick(mockExtensionDetails, [], false);

			// Should have separator + 0 recently installed + separator + 3 all extensions = 5 items
			assert.strictEqual(mockQuickPick.items.length, 5);
			assert.strictEqual(mockQuickPick.items[0].label, "Recently Installed");
			assert.strictEqual(mockQuickPick.items[1].label, "All Extensions");

			mockQuickPick.triggerAccept();
			await promise;
		});

		test("Should open GitHub repository when button is triggered", async () => {
			const promise = showExtensionQuickPick(mockExtensionDetails, [], false);

			const extensionItem = mockQuickPick.items.find((item) => item.label === "Extension One");
			assert.ok(extensionItem, "Extension item should be found");

			// Trigger the GitHub button
			mockQuickPick.triggerItemButton(extensionItem);

			// Verify external URL was opened
			assert.strictEqual(openExternalCalls.length, 1);
			assert.strictEqual(openExternalCalls[0].toString(), "https://github.com/author1/ext1");

			mockQuickPick.triggerAccept();
			await promise;
		});

		test("Should handle item without URL when button is triggered", async () => {
			// Create an item without URL
			const itemWithoutUrl: ExtensionQuickPickItem = {
				label: "Test Item",
				description: "Test description",
			};

			const promise = showExtensionQuickPick([], [], false);

			// Manually add the item to test edge case
			mockQuickPick.items.push(itemWithoutUrl);

			// Trigger button on item without URL
			mockQuickPick.triggerItemButton(itemWithoutUrl);

			// Should not attempt to open any URL
			assert.strictEqual(openExternalCalls.length, 0);

			mockQuickPick.triggerAccept();
			await promise;
		});

		test("Should resolve with empty array when no items selected", async () => {
			const promise = showExtensionQuickPick(mockExtensionDetails, [], false);

			// Don't set any selected items, just trigger accept
			mockQuickPick.triggerAccept();

			const result = await promise;
			assert.strictEqual(result.length, 0);
		});

		test("Should filter out recently installed from all extensions section", async () => {
			const recentlyInstalled = ["ext1", "ext3"];
			const promise = showExtensionQuickPick(mockExtensionDetails, recentlyInstalled, false);

			// Should have: separator + 2 recently installed + separator + 1 remaining = 5 items
			assert.strictEqual(mockQuickPick.items.length, 5);

			// Verify recently installed section has 2 items
			const recentlyInstalledItems = mockQuickPick.items.slice(1, 3);
			assert.strictEqual(recentlyInstalledItems.length, 2);
			assert.strictEqual(recentlyInstalledItems[0].id, "ext1");
			assert.strictEqual(recentlyInstalledItems[1].id, "ext3");

			// Verify all extensions section has only the remaining item
			const allExtensionsItems = mockQuickPick.items.slice(4);
			assert.strictEqual(allExtensionsItems.length, 1);
			assert.strictEqual(allExtensionsItems[0].id, "ext2");

			mockQuickPick.triggerAccept();
			await promise;
		});

		test("Should handle extension items with special properties", async () => {
			// Create extension with special properties for testing
			const specialExtensions: ExtensionDetails[] = [
				{
					id: "special-ext",
					name: "Special Extension",
					full_name: "special/ext",
					owner: "special",
					description: "Extension with special characters: <>&\"'",
					stars: 9999,
					license: "Custom License",
					html_url: "https://github.com/special/ext",
					version: "1.0.0-beta",
					tag: "v1.0.0-beta",
					template: true,
				},
			];

			const promise = showExtensionQuickPick(specialExtensions, [], false);

			// Verify the special extension is handled correctly
			const extensionItems = mockQuickPick.items.filter((item) => !item.kind);
			assert.strictEqual(extensionItems.length, 1);

			const specialItem = extensionItems[0];
			assert.strictEqual(specialItem.label, "Special Extension");
			assert.ok(specialItem.description?.includes("9999"));
			assert.ok(specialItem.description?.includes("Custom License"));
			assert.strictEqual(specialItem.detail, "Extension with special characters: <>&\"'");
			assert.strictEqual(specialItem.template, true);

			mockQuickPick.triggerAccept();
			await promise;
		});

		test("Should handle QuickPick lifecycle correctly", async () => {
			const promise = showExtensionQuickPick(mockExtensionDetails, [], false);

			// Verify QuickPick is properly configured before triggering events
			assert.ok(mockQuickPick.items.length > 0);
			assert.strictEqual(typeof mockQuickPick.placeholder, "string");
			assert.strictEqual(typeof mockQuickPick.canSelectMany, "boolean");

			// Test multiple event handlers are set up
			const testItem = mockQuickPick.items.find((item) => item.url);
			if (testItem) {
				// Should not throw when triggering button
				mockQuickPick.triggerItemButton(testItem);
			}

			// Should not throw when accepting
			mockQuickPick.triggerAccept();

			const result = await promise;
			assert.ok(Array.isArray(result));
		});
	});
});
