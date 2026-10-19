import * as assert from "assert";
import * as path from "node:path";
import * as vscode from "vscode";
import { SchemaCache } from "@quarto-wizard/schema";
import { SnippetCache } from "@quarto-wizard/snippets";
import { QuartoExtensionTreeDataProvider } from "../../ui/extensionTreeDataProvider";
import {
	ExtensionTreeItem,
	ProjectGroupTreeItem,
	WorkspaceFolderTreeItem,
	type TreeItemType,
} from "../../ui/extensionTreeItems";
import type { InstalledExtension } from "../../utils/extensions";
import { makeFolder, makeRoot } from "./projectFixtures";
import { TREE_COMMANDS_ROOT, stubUpdateBoundary, type UpdateBoundaryOptions } from "./updateFixtures";

suite("Extension Tree Data Provider Test Suite", () => {
	function createProvider(): QuartoExtensionTreeDataProvider {
		return new QuartoExtensionTreeDataProvider([], new SchemaCache(), new SnippetCache());
	}

	async function waitForInitialRefresh(provider: QuartoExtensionTreeDataProvider): Promise<void> {
		const pending = (provider as unknown as { pendingRefresh: Promise<void> | null }).pendingRefresh;
		if (pending) {
			await pending;
		}
	}

	function createExtension(overrides: Partial<InstalledExtension["manifest"]> = {}): InstalledExtension {
		return {
			id: { owner: "quarto-ext", name: "demo" },
			directory: "/tmp/demo",
			manifestPath: "/tmp/demo/_extension.yml",
			manifest: {
				title: "Demo Extension",
				author: "Quarto Team",
				version: "1.0.0",
				contributes: {},
				...overrides,
			},
		};
	}

	test("Shows quarto-required value when present", async () => {
		const provider = createProvider();
		const extension = createExtension({ quartoRequired: ">=1.8.20" });
		const parent = new ExtensionTreeItem(
			"quarto-ext/demo",
			vscode.TreeItemCollapsibleState.Collapsed,
			"/workspace",
			extension,
		);

		const children = await provider.getChildren(parent);
		const labels = children.map((item) => String(item.label));

		assert.ok(labels.includes("Quarto required: >=1.8.20"));
		assert.ok(labels.includes("Compatibility: unknown (Quarto unavailable)"));
	});

	test("Shows quarto-required as N/A when missing", async () => {
		const provider = createProvider();
		const extension = createExtension();
		const parent = new ExtensionTreeItem(
			"quarto-ext/demo",
			vscode.TreeItemCollapsibleState.Collapsed,
			"/workspace",
			extension,
		);

		const children = await provider.getChildren(parent);
		const labels = children.map((item) => String(item.label));

		assert.ok(labels.includes("Quarto required: N/A"));
		assert.ok(labels.includes("Compatibility: not specified"));
	});

	test("Shows warning icon and detail for incompatible extensions", async () => {
		const provider = createProvider();
		const extension = createExtension({
			quartoRequired: ">=1.8.20",
			source: "quarto-ext/demo",
		});
		await waitForInitialRefresh(provider);

		(
			provider as unknown as {
				cache: Record<
					string,
					{
						extensions: Record<string, InstalledExtension>;
						updates: Record<string, unknown>;
						updateCheckFailures: Set<string>;
						parseErrors: Set<string>;
						compatibility: Record<string, { status: string; detail: string; warningMessage?: string }>;
					}
				>;
			}
		).cache = {
			"/workspace": {
				extensions: { "quarto-ext/demo": extension },
				updates: {},
				updateCheckFailures: new Set<string>(),
				parseErrors: new Set<string>(),
				compatibility: {
					"quarto-ext/demo": {
						status: "incompatible",
						detail: "incompatible",
						warningMessage: "This extension requires Quarto >=1.8.20, but you have version 1.7.0.",
					},
				},
			},
		};

		const roots = await provider.getChildren(new WorkspaceFolderTreeItem("workspace", "/workspace"));
		assert.strictEqual(roots.length, 1);
		const extensionItem = roots[0] as ExtensionTreeItem;
		const icon = extensionItem.iconPath as vscode.ThemeIcon;
		assert.strictEqual(icon.id, "warning");
		assert.ok(String(extensionItem.tooltip).includes("requires Quarto >=1.8.20"));

		const children = await provider.getChildren(extensionItem);
		const labels = children.map((item) => String(item.label));
		assert.ok(labels.includes("Compatibility: incompatible"));
	});

	test("Does not warn when compatibility is unknown", async () => {
		const provider = createProvider();
		const extension = createExtension({
			quartoRequired: ">=1.8.20",
			source: "quarto-ext/demo",
		});
		await waitForInitialRefresh(provider);

		(
			provider as unknown as {
				cache: Record<
					string,
					{
						extensions: Record<string, InstalledExtension>;
						updates: Record<string, unknown>;
						updateCheckFailures: Set<string>;
						parseErrors: Set<string>;
						compatibility: Record<string, { status: string; detail: string; warningMessage?: string }>;
					}
				>;
			}
		).cache = {
			"/workspace": {
				extensions: { "quarto-ext/demo": extension },
				updates: {},
				updateCheckFailures: new Set<string>(),
				parseErrors: new Set<string>(),
				compatibility: {
					"quarto-ext/demo": {
						status: "unknown",
						detail: "unknown (Quarto unavailable)",
					},
				},
			},
		};

		const roots = await provider.getChildren(new WorkspaceFolderTreeItem("workspace", "/workspace"));
		assert.strictEqual(roots.length, 1);
		const extensionItem = roots[0] as ExtensionTreeItem;
		const icon = extensionItem.iconPath as vscode.ThemeIcon;
		assert.strictEqual(icon.id, "package");
	});

	test("Sibling sub-projects render under a ProjectGroupTreeItem", async () => {
		const folder = makeFolder("repo", path.resolve(path.sep, "tmp", "repo"));
		const a = makeRoot(folder, "docs", "A");
		const b = makeRoot(folder, "docs", "B");
		const provider = new QuartoExtensionTreeDataProvider([a, b], new SchemaCache(), new SnippetCache());
		await waitForInitialRefresh(provider);

		const top = await provider.getChildren();
		assert.strictEqual(top.length, 1);
		assert.ok(top[0] instanceof ProjectGroupTreeItem);
		const group = top[0] as ProjectGroupTreeItem;
		assert.strictEqual(group.label, "repo/docs");
		assert.strictEqual(group.children.length, 2);
		assert.ok(group.children[0] instanceof WorkspaceFolderTreeItem);
		assert.ok(group.children[1] instanceof WorkspaceFolderTreeItem);
		assert.strictEqual(group.children[0].label, "A");
		assert.strictEqual(group.children[1].label, "B");
		assert.strictEqual(group.children[0].folderPath, a.fsPath);
		assert.strictEqual(group.children[1].folderPath, b.fsPath);

		const expanded = await provider.getChildren(group);
		assert.deepStrictEqual(expanded, group.children);
	});

	test("Single sub-project stays flat as a WorkspaceFolderTreeItem", async () => {
		const folder = makeFolder("repo", path.resolve(path.sep, "tmp", "repo"));
		const sub = makeRoot(folder, "docs", "only");
		const provider = new QuartoExtensionTreeDataProvider([sub], new SchemaCache(), new SnippetCache());
		await waitForInitialRefresh(provider);

		(
			provider as unknown as {
				cache: Record<
					string,
					{
						extensions: Record<string, InstalledExtension>;
						updates: Record<string, unknown>;
						updateCheckFailures: Set<string>;
						parseErrors: Set<string>;
						compatibility: Record<string, { status: string; detail: string; warningMessage?: string }>;
					}
				>;
			}
		).cache = {
			[sub.fsPath]: {
				extensions: { "quarto-ext/demo": createExtension() },
				updates: {},
				updateCheckFailures: new Set<string>(),
				parseErrors: new Set<string>(),
				compatibility: {},
			},
		};

		const top = await provider.getChildren();
		assert.strictEqual(top.length, 1);
		assert.ok(top[0] instanceof WorkspaceFolderTreeItem);
		assert.strictEqual(top[0].label, "repo/docs/only");
	});

	test("Independent workspace folders stay flat", async () => {
		const repoA = makeFolder("repoA", path.resolve(path.sep, "tmp", "repoA"));
		const repoB = makeFolder("repoB", path.resolve(path.sep, "tmp", "repoB"));
		const provider = new QuartoExtensionTreeDataProvider(
			[makeRoot(repoA), makeRoot(repoB)],
			new SchemaCache(),
			new SnippetCache(),
		);
		await waitForInitialRefresh(provider);

		const top = await provider.getChildren();
		assert.strictEqual(top.length, 2);
		assert.ok(top[0] instanceof WorkspaceFolderTreeItem);
		assert.ok(top[1] instanceof WorkspaceFolderTreeItem);
		assert.strictEqual(top[0].label, "repoA");
		assert.strictEqual(top[1].label, "repoB");
	});
	suite("Update check", () => {
		let restoreBoundary: (() => void) | undefined;

		teardown(() => {
			restoreBoundary?.();
			restoreBoundary = undefined;
		});

		async function runCheck(
			options: UpdateBoundaryOptions,
		): Promise<{ provider: QuartoExtensionTreeDataProvider; view: vscode.TreeView<TreeItemType> }> {
			restoreBoundary = stubUpdateBoundary(options);
			const provider = new QuartoExtensionTreeDataProvider(
				[makeRoot(makeFolder("treeCommands", TREE_COMMANDS_ROOT))],
				new SchemaCache(),
				new SnippetCache(),
			);
			await waitForInitialRefresh(provider);
			const view = { message: undefined, badge: undefined } as unknown as vscode.TreeView<TreeItemType>;
			const context = {} as vscode.ExtensionContext;
			await provider.checkUpdate(context, view);
			return { provider, view };
		}

		async function extensionItem(provider: QuartoExtensionTreeDataProvider, id: string): Promise<ExtensionTreeItem> {
			const items = await provider.getChildren(new WorkspaceFolderTreeItem("treeCommands", TREE_COMMANDS_ROOT));
			const item = items.find((candidate) => candidate.label === id);
			assert.ok(item instanceof ExtensionTreeItem, `no tree item for ${id}`);
			return item;
		}

		test("view message reports a check failure", async () => {
			const { view } = await runCheck({ repositories: {}, registryStatus: 404 });

			assert.strictEqual(view.message, "Update check failed. Show log.");
		});

		test("view message names GitHub with a token", async () => {
			const { view } = await runCheck({
				token: "test-token",
				repositories: { "acme/registry-demo": { githubTags: ["v1.3.0"], registryTag: "1.2.0" } },
			});

			assert.strictEqual(view.message, "Updates checked against GitHub.");
		});

		test("view message names the registry without a token", async () => {
			const { view } = await runCheck({
				repositories: { "acme/registry-demo": { registryTag: "1.2.0" }, "acme/github-demo": { registryTag: "1.0.0" } },
			});

			assert.strictEqual(
				view.message,
				"Updates checked against the registry. Sign in to GitHub to see new tags straight away.",
			);
		});

		test("detail rows show Installed from and Latest", async () => {
			const { provider } = await runCheck({
				repositories: { "acme/registry-demo": { registryTag: "1.2.0" }, "acme/github-demo": { registryTag: "1.0.0" } },
			});

			const item = await extensionItem(provider, "acme/registry-demo");
			const labels = (await provider.getChildren(item)).map((child) => String(child.label));

			assert.ok(labels.includes("Installed from: registry"), labels.join(", "));
			assert.ok(labels.includes("Latest: 1.2.0 (checked on the registry)"), labels.join(", "));
			assert.ok(!labels.some((label) => label.startsWith("Source type:")), labels.join(", "));
		});

		test("tooltip names the latest version and where it was found", async () => {
			const { provider } = await runCheck({
				token: "test-token",
				repositories: { "acme/registry-demo": { githubTags: ["v1.3.0"] } },
			});

			const tooltip = String((await extensionItem(provider, "acme/registry-demo")).tooltip);

			assert.ok(tooltip.includes("Latest 1.3.0, found on GitHub."), tooltip);
			assert.ok(tooltip.includes("Update installs the latest GitHub tag."), tooltip);
		});

		test("a repository failure keeps the view message and marks the tooltip", async () => {
			const { provider, view } = await runCheck({
				token: "test-token",
				repositories: { "acme/registry-demo": { githubTags: ["v1.3.0"] }, "acme/github-demo": { githubStatus: 404 } },
			});

			assert.strictEqual(view.message, "Updates checked against GitHub.");
			const tooltip = String((await extensionItem(provider, "acme/github-demo")).tooltip);
			assert.ok(tooltip.includes("The update check of this extension failed."), tooltip);
			const healthy = String((await extensionItem(provider, "acme/registry-demo")).tooltip);
			assert.ok(!healthy.includes("failed"), healthy);
		});

		test("the crossSource setting is gone", () => {
			// inspect() returns an object for any key; a key that no extension contributes has no default.
			const inspected = vscode.workspace.getConfiguration("quartoWizard").inspect("update.crossSource");
			assert.strictEqual(inspected?.defaultValue, undefined);
		});
	});
});
