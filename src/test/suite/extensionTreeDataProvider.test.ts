import * as assert from "assert";
import * as path from "node:path";
import * as vscode from "vscode";
import { SchemaCache } from "@quarto-wizard/schema";
import { SnippetCache } from "@quarto-wizard/snippets";
import { QuartoExtensionTreeDataProvider } from "../../ui/extensionTreeDataProvider";
import { ExtensionTreeItem, ProjectGroupTreeItem, WorkspaceFolderTreeItem } from "../../ui/extensionTreeItems";
import type { InstalledExtension } from "../../utils/extensions";
import { makeFolder, makeRoot } from "./projectFixtures";

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
						latestVersions: Record<string, string>;
						parseErrors: Set<string>;
						compatibility: Record<string, { status: string; detail: string; warningMessage?: string }>;
					}
				>;
			}
		).cache = {
			"/workspace": {
				extensions: { "quarto-ext/demo": extension },
				latestVersions: {},
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
						latestVersions: Record<string, string>;
						parseErrors: Set<string>;
						compatibility: Record<string, { status: string; detail: string; warningMessage?: string }>;
					}
				>;
			}
		).cache = {
			"/workspace": {
				extensions: { "quarto-ext/demo": extension },
				latestVersions: {},
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
						latestVersions: Record<string, string>;
						parseErrors: Set<string>;
						compatibility: Record<string, { status: string; detail: string; warningMessage?: string }>;
					}
				>;
			}
		).cache = {
			[sub.fsPath]: {
				extensions: { "quarto-ext/demo": createExtension() },
				latestVersions: {},
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
});
