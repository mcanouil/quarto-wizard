import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { DetectedProjectsProvider, registerDetectedProjectsView } from "../../ui/detectedProjectsView";
import type { ProjectVisibility } from "../../utils/projectVisibility";
import type { QuartoProjectRoot } from "../../utils/quartoProjectDiscovery";
import { makeFolder, makeRoot } from "./projectFixtures";
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
			setVisibleCalls.push({ roots, visible });
		},
		saveToWorkspaceSettings: async (roots: readonly QuartoProjectRoot[]) => {
			savedRoots.push(roots);
		},
	} as unknown as ProjectVisibility;
	const counts = (fsPath: string) =>
		fsPath === makeRoot(folderA, "docs").fsPath ? { extensions: 3, updates: 1 } : { extensions: 0, updates: 0 };

	setup(() => {
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
		const provider = new DetectedProjectsProvider(visibility, counts);
		provider.setRoots([shown, hiddenRoot]);

		assert.strictEqual(provider.getChildren().length, 2);
		assert.strictEqual(projectItem(provider, shown).checkboxState, vscode.TreeItemCheckboxState.Checked);
		assert.strictEqual(projectItem(provider, hiddenRoot).checkboxState, vscode.TreeItemCheckboxState.Unchecked);
	});

	test("row label shows the folder name for the workspace root", () => {
		const provider = new DetectedProjectsProvider(visibility, counts);
		const top = makeRoot(folderA);
		const nested = makeRoot(folderA, "docs");
		provider.setRoots([top, nested]);

		assert.strictEqual(projectItem(provider, top).label, "a");
		assert.strictEqual(projectItem(provider, nested).label, "docs");
	});

	test("row description gives the counts and the tags", () => {
		const provider = new DetectedProjectsProvider(visibility, counts);
		const plain = makeRoot(folderA, "docs");
		const tagged = {
			...makeRoot(folderA, "other"),
			quartoIgnored: true,
			embeddedIn: { id: { name: "ext" } },
		} as QuartoProjectRoot;
		provider.setRoots([plain, tagged]);

		assert.strictEqual(projectItem(provider, plain).description, "3 extensions · 1 update");
		assert.strictEqual(
			projectItem(provider, tagged).description,
			"0 extensions · 0 updates · .quartoignore · embedded",
		);
	});

	test("rows are grouped by workspace folder only in a multi-root workspace", () => {
		const provider = new DetectedProjectsProvider(visibility, counts);
		const inA = makeRoot(folderA, "docs");
		const inB = makeRoot(folderB, "docs");

		provider.setRoots([inA]);
		assert.ok(provider.getChildren().every((node) => node.kind === "project"));

		provider.setRoots([inA, inB]);
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
			stubs.replace(vscode.commands, "registerCommand", (id: string, handler: () => unknown) => {
				commandHandlers.set(id, handler);
				return { dispose: () => undefined };
			});
		});

		function register(roots: readonly QuartoProjectRoot[]): DetectedProjectsProvider {
			const provider = new DetectedProjectsProvider(visibility, counts);
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
			provider.setRoots([root]);
			const node = provider.getChildren()[0];
			checkboxEvents.fire({ items: [[node, vscode.TreeItemCheckboxState.Unchecked]] });
			await new Promise((resolve) => setImmediate(resolve));

			assert.deepStrictEqual(setVisibleCalls, [{ roots: [root], visible: false }]);
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
		});
	});
});
