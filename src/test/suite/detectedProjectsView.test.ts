import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { DetectedProjectsProvider, registerDetectedProjectsView } from "../../ui/detectedProjectsView";
import type { ProjectVisibility } from "../../utils/projectVisibility";
import type { QuartoProjectRoot } from "../../utils/quartoProjectDiscovery";
import { makeEmbeddedRoot, makeFolder, makeRoot } from "./projectFixtures";
import { Stubs } from "./stubs";

type Node = Parameters<DetectedProjectsProvider["getTreeItem"]>[0];

suite("Detected Projects View Test Suite", () => {
	const stubs = new Stubs();
	const folderA = makeFolder("a", path.resolve("workspace-a"));
	const folderB = makeFolder("b", path.resolve("workspace-b"), 1);
	const hidden = new Set<string>();
	const setVisibleCalls: { roots: readonly QuartoProjectRoot[]; visible: boolean }[] = [];
	const savedRoots: (readonly QuartoProjectRoot[])[] = [];
	const visibilityChanged = new vscode.EventEmitter<void>();
	const visibility = {
		onDidChange: visibilityChanged.event,
		isVisible: (root: QuartoProjectRoot) => !hidden.has(root.fsPath),
		setVisible: async (roots: readonly QuartoProjectRoot[], visible: boolean) => {
			if (failure) {
				throw failure;
			}
			setVisibleCalls.push({ roots, visible });
		},
		saveToWorkspaceSettings: async (roots: readonly QuartoProjectRoot[]) => {
			if (failure) {
				throw failure;
			}
			savedRoots.push(roots);
		},
	} as unknown as ProjectVisibility;
	const counts = (fsPath: string) =>
		fsPath === makeRoot(folderA, "docs").fsPath ? { extensions: 3, updates: 1 } : { extensions: 0, updates: 0 };

	let failure: Error | undefined;
	let errorMessages: string[];
	let infoMessages: string[];

	setup(() => {
		failure = undefined;
		errorMessages = [];
		infoMessages = [];
		hidden.clear();
		setVisibleCalls.length = 0;
		savedRoots.length = 0;
	});
	teardown(() => stubs.restore());

	function projectItem(provider: DetectedProjectsProvider, root: QuartoProjectRoot): vscode.TreeItem {
		const node = provider.getChildren().find((child) => child.kind === "project" && child.root === root);
		assert.ok(node, `no row for ${root.fsPath}`);
		return provider.getTreeItem(node);
	}

	test("one row per root with a checkbox that follows visibility", () => {
		const shown = makeRoot(folderA, "docs");
		const hiddenRoot = makeRoot(folderA, "notes");
		hidden.add(hiddenRoot.fsPath);
		const provider = new DetectedProjectsProvider(visibility, counts, () => [shown, hiddenRoot]);

		assert.strictEqual(provider.getChildren().length, 2);
		assert.strictEqual(projectItem(provider, shown).checkboxState, vscode.TreeItemCheckboxState.Checked);
		assert.strictEqual(projectItem(provider, hiddenRoot).checkboxState, vscode.TreeItemCheckboxState.Unchecked);
	});

	test("row label shows the folder name for the workspace root", () => {
		const top = makeRoot(folderA);
		const nested = makeRoot(folderA, "docs");
		const provider = new DetectedProjectsProvider(visibility, counts, () => [top, nested]);

		assert.strictEqual(projectItem(provider, top).label, "a");
		assert.strictEqual(projectItem(provider, nested).label, "docs");
	});

	test("row description gives the counts and the tags", () => {
		const plain = makeRoot(folderA, "docs");
		const tagged = { ...makeEmbeddedRoot(folderA, { id: { owner: null, name: "ext" } }, "other"), quartoIgnored: true };
		const provider = new DetectedProjectsProvider(visibility, counts, () => [plain, tagged]);

		assert.strictEqual(projectItem(provider, plain).description, "3 extensions · 1 update");
		assert.strictEqual(
			projectItem(provider, tagged).description,
			"0 extensions · 0 updates · .quartoignore · embedded",
		);
	});

	test("rows are grouped by workspace folder only in a multi-root workspace", () => {
		const inA = makeRoot(folderA, "docs");
		const inB = makeRoot(folderB, "docs");

		const single = new DetectedProjectsProvider(
			visibility,
			counts,
			() => [inA],
			() => [folderA],
		);
		assert.ok(single.getChildren().every((node) => node.kind === "project"));

		const provider = new DetectedProjectsProvider(
			visibility,
			counts,
			() => [inA, inB],
			() => [folderA, folderB],
		);
		const folders = provider.getChildren();
		assert.deepStrictEqual(
			folders.map((node) => provider.getTreeItem(node).label),
			["a", "b"],
		);
		const rows = provider.getChildren(folders[1]);
		assert.deepStrictEqual(
			rows.map((node) => node.kind === "project" && node.root),
			[inB],
		);
	});

	test("a workspace folder without projects keeps its node", () => {
		const provider = new DetectedProjectsProvider(
			visibility,
			counts,
			() => [makeRoot(folderA, "docs")],
			() => [folderA, folderB],
		);

		const folders = provider.getChildren();
		assert.strictEqual(folders.length, 2);
		assert.deepStrictEqual(provider.getChildren(folders[1]), []);
	});

	suite("registered view", () => {
		const checkboxEvents = new vscode.EventEmitter<vscode.TreeCheckboxChangeEvent<Node>>();
		const commandHandlers = new Map<string, () => unknown>();
		const subscriptions: vscode.Disposable[] = [];

		setup(() => {
			commandHandlers.clear();
			stubs.replace(vscode.window, "createTreeView", () => ({
				onDidChangeCheckboxState: checkboxEvents.event,
				dispose: () => undefined,
			}));
			stubs.replace(vscode.window, "showErrorMessage", async (message: string) => {
				errorMessages.push(message);
				return undefined;
			});
			stubs.replace(vscode.window, "showInformationMessage", async (message: string) => {
				infoMessages.push(message);
				return undefined;
			});
			stubs.replace(vscode.commands, "registerCommand", (id: string, handler: () => unknown) => {
				commandHandlers.set(id, handler);
				return { dispose: () => undefined };
			});
		});

		function register(roots: readonly QuartoProjectRoot[]): DetectedProjectsProvider {
			const provider = new DetectedProjectsProvider(visibility, counts, () => roots);
			registerDetectedProjectsView({ subscriptions } as vscode.ExtensionContext, provider, visibility, () => roots);
			return provider;
		}

		teardown(() => {
			for (const subscription of subscriptions.splice(0)) {
				subscription.dispose();
			}
		});

		test("unticking a checkbox hides the project", async () => {
			const root = makeRoot(folderA, "docs");
			const provider = register([root]);
			const node = provider.getChildren()[0];
			checkboxEvents.fire({ items: [[node, vscode.TreeItemCheckboxState.Unchecked]] });
			await new Promise((resolve) => setImmediate(resolve));

			assert.deepStrictEqual(setVisibleCalls, [{ roots: [root], visible: false }]);
		});

		test("changed checkboxes are applied in one call per state", async () => {
			const roots = [makeRoot(folderA, "docs"), makeRoot(folderA, "notes"), makeRoot(folderA, "talks")];
			const provider = register(roots);
			const [first, second, third] = provider.getChildren();
			checkboxEvents.fire({
				items: [
					[first, vscode.TreeItemCheckboxState.Unchecked],
					[second, vscode.TreeItemCheckboxState.Checked],
					[third, vscode.TreeItemCheckboxState.Unchecked],
				],
			});
			await new Promise((resolve) => setImmediate(resolve));

			assert.deepStrictEqual(setVisibleCalls, [
				{ roots: [roots[1]], visible: true },
				{ roots: [roots[0], roots[2]], visible: false },
			]);
		});

		test("the picker preselects visible roots and applies the selection", async () => {
			const shown = makeRoot(folderA, "docs");
			const hiddenRoot = makeRoot(folderA, "notes");
			hidden.add(hiddenRoot.fsPath);
			register([shown, hiddenRoot]);

			type PickItem = vscode.QuickPickItem & { root: QuartoProjectRoot };
			let acceptListener: () => void = () => undefined;
			const picker = {
				items: [] as PickItem[],
				selectedItems: [] as PickItem[],
				onDidAccept: (listener: () => void) => {
					acceptListener = listener;
				},
				onDidHide: () => undefined,
				show: () => undefined,
				hide: () => undefined,
				dispose: () => undefined,
			};
			stubs.replace(vscode.window, "createQuickPick", () => picker);

			commandHandlers.get("quartoWizard.detectedProjects.select")?.();
			assert.deepStrictEqual(
				picker.selectedItems.map((item) => item.root),
				[shown],
			);

			picker.selectedItems = picker.items.filter((item) => item.root === hiddenRoot);
			acceptListener();
			await new Promise((resolve) => setImmediate(resolve));

			assert.deepStrictEqual(setVisibleCalls, [
				{ roots: [hiddenRoot], visible: true },
				{ roots: [shown], visible: false },
			]);
		});

		test("saveToSettings saves every root", async () => {
			const roots = [makeRoot(folderA, "docs"), makeRoot(folderB, "docs")];
			register(roots);
			await commandHandlers.get("quartoWizard.detectedProjects.saveToSettings")?.();

			assert.deepStrictEqual(savedRoots, [roots]);
			assert.deepStrictEqual(infoMessages, ["Project visibility saved to the workspace settings."]);
		});

		test("a failed checkbox change reports an error naming the project", async () => {
			const root = makeRoot(folderA, "docs");
			const provider = register([root]);
			failure = new Error("disk full");
			checkboxEvents.fire({ items: [[provider.getChildren()[0], vscode.TreeItemCheckboxState.Unchecked]] });
			await new Promise((resolve) => setImmediate(resolve));

			assert.deepStrictEqual(errorMessages, ["Failed to hide projects for a/docs: disk full."]);
		});

		test("a failed checkbox change refreshes the rows", async () => {
			const root = makeRoot(folderA, "docs");
			const provider = register([root]);
			let refreshes = 0;
			subscriptions.push(provider.onDidChangeTreeData(() => refreshes++));
			failure = new Error("disk full");
			checkboxEvents.fire({ items: [[provider.getChildren()[0], vscode.TreeItemCheckboxState.Unchecked]] });
			await new Promise((resolve) => setImmediate(resolve));

			assert.strictEqual(refreshes, 1);
		});

		test("a failed checkbox change refreshes the rows while the error is still open", async () => {
			stubs.replace(vscode.window, "showErrorMessage", (message: string) => {
				errorMessages.push(message);
				return new Promise<undefined>(() => undefined);
			});
			const root = makeRoot(folderA, "docs");
			const provider = register([root]);
			let refreshes = 0;
			subscriptions.push(provider.onDidChangeTreeData(() => refreshes++));
			failure = new Error("disk full");
			checkboxEvents.fire({ items: [[provider.getChildren()[0], vscode.TreeItemCheckboxState.Unchecked]] });
			await new Promise((resolve) => setImmediate(resolve));

			assert.strictEqual(refreshes, 1);
			assert.strictEqual(errorMessages.length, 1);
		});

		test("a failed picker selection refreshes the rows", async () => {
			const hiddenRoot = makeRoot(folderA, "notes");
			hidden.add(hiddenRoot.fsPath);
			const provider = register([hiddenRoot]);
			let refreshes = 0;
			subscriptions.push(provider.onDidChangeTreeData(() => refreshes++));
			type PickItem = vscode.QuickPickItem & { root: QuartoProjectRoot };
			let acceptListener: () => void = () => undefined;
			const picker = {
				items: [] as PickItem[],
				selectedItems: [] as PickItem[],
				onDidAccept: (listener: () => void) => {
					acceptListener = listener;
				},
				onDidHide: () => undefined,
				show: () => undefined,
				hide: () => undefined,
				dispose: () => undefined,
			};
			stubs.replace(vscode.window, "createQuickPick", () => picker);
			commandHandlers.get("quartoWizard.detectedProjects.select")?.();
			picker.selectedItems = picker.items;
			failure = new Error("disk full");
			acceptListener();
			for (let tick = 0; tick < 5; tick++) {
				await new Promise((resolve) => setImmediate(resolve));
			}

			assert.strictEqual(refreshes, 1);
		});

		test("a failed picker selection reports an error naming the projects", async () => {
			const hiddenRoot = makeRoot(folderA, "notes");
			hidden.add(hiddenRoot.fsPath);
			register([hiddenRoot]);
			type PickItem = vscode.QuickPickItem & { root: QuartoProjectRoot };
			let acceptListener: () => void = () => undefined;
			const picker = {
				items: [] as PickItem[],
				selectedItems: [] as PickItem[],
				onDidAccept: (listener: () => void) => {
					acceptListener = listener;
				},
				onDidHide: () => undefined,
				show: () => undefined,
				hide: () => undefined,
				dispose: () => undefined,
			};
			stubs.replace(vscode.window, "createQuickPick", () => picker);
			commandHandlers.get("quartoWizard.detectedProjects.select")?.();
			picker.selectedItems = picker.items;
			failure = new Error("disk full");
			acceptListener();
			for (let tick = 0; tick < 5; tick++) {
				await new Promise((resolve) => setImmediate(resolve));
			}

			assert.deepStrictEqual(errorMessages, ["Failed to show projects for a/notes: disk full."]);
		});

		test("a failed save reports an error and no success message", async () => {
			const roots = [makeRoot(folderA, "docs")];
			register(roots);
			failure = new Error("read-only settings");
			await commandHandlers.get("quartoWizard.detectedProjects.saveToSettings")?.();

			assert.deepStrictEqual(errorMessages, [
				"Failed to save project visibility to the workspace settings for a/docs: read-only settings.",
			]);
			assert.deepStrictEqual(infoMessages, []);
		});
	});
});
