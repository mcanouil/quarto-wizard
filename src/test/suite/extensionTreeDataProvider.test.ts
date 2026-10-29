import * as assert from "assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { SchemaCache } from "@quarto-wizard/schema";
import { SnippetCache } from "@quarto-wizard/snippets";
import { QuartoExtensionTreeDataProvider } from "../../ui/extensionTreeDataProvider";
import {
	ExtensionTreeItem,
	ProjectGroupTreeItem,
	SchemaFormatTreeItem,
	SchemaTreeItem,
	WorkspaceFolderTreeItem,
	type TreeItemType,
} from "../../ui/extensionTreeItems";
import type { InstalledExtension } from "../../utils/extensions";
import type { QuartoProjectRoot } from "../../utils/quartoProjectDiscovery";
import { ProjectVisibility } from "../../utils/projectVisibility";
import { FakeMemento, makeFolder, makeRoot } from "./projectFixtures";
import { TREE_COMMANDS_ROOT, stubUpdateBoundary, type UpdateBoundaryOptions } from "./updateFixtures";

suite("Extension Tree Data Provider Test Suite", () => {
	function createVisibility(): ProjectVisibility {
		return new ProjectVisibility(new FakeMemento());
	}

	function createProvider(): QuartoExtensionTreeDataProvider {
		return new QuartoExtensionTreeDataProvider([], new SchemaCache(), new SnippetCache(), createVisibility());
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
		const provider = new QuartoExtensionTreeDataProvider(
			[a, b],
			new SchemaCache(),
			new SnippetCache(),
			createVisibility(),
		);
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
		const provider = new QuartoExtensionTreeDataProvider(
			[sub],
			new SchemaCache(),
			new SnippetCache(),
			createVisibility(),
		);
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
			createVisibility(),
		);
		await waitForInitialRefresh(provider);

		const top = await provider.getChildren();
		assert.strictEqual(top.length, 2);
		assert.ok(top[0] instanceof WorkspaceFolderTreeItem);
		assert.ok(top[1] instanceof WorkspaceFolderTreeItem);
		assert.strictEqual(top[0].label, "repoA");
		assert.strictEqual(top[1].label, "repoB");
	});
	test("a cells section lists each language with its options", async () => {
		const provider = createProvider();
		const schema = { cells: { typst: { options: { dpi: { type: "integer" as const } } } } };

		const sections = await provider.getChildren(new SchemaTreeItem("/tmp/ext", schema));
		assert.ok(Array.isArray(sections));
		assert.deepStrictEqual(
			sections.map((section) => section.label),
			["Cells"],
		);

		const languages = await provider.getChildren(sections[0]);
		assert.ok(Array.isArray(languages));
		assert.deepStrictEqual(
			languages.map((language) => language.label),
			["typst"],
		);
		assert.ok(languages[0] instanceof SchemaFormatTreeItem);

		const options = await provider.getChildren(languages[0]);
		assert.ok(Array.isArray(options));
		assert.deepStrictEqual(
			options.map((option) => option.label),
			["dpi"],
		);
	});

	test("a cells language shows its description and lists its options as children", async () => {
		const provider = createProvider();
		const schema = {
			cells: {
				typst: { description: "Typst cells.", options: { dpi: { type: "integer" as const } } },
				julia: {},
			},
		};

		const sections = await provider.getChildren(new SchemaTreeItem("/tmp/ext", schema));
		assert.ok(Array.isArray(sections));
		const languages = await provider.getChildren(sections[0]);
		assert.ok(Array.isArray(languages));
		assert.deepStrictEqual(
			languages.map((language) => language.label),
			["typst", "julia"],
		);
		assert.ok(String(languages[0].tooltip).includes("Typst cells."));
		assert.ok(String(languages[0].description).includes("Typst cells."));

		const options = await provider.getChildren(languages[0]);
		assert.ok(Array.isArray(options));
		assert.deepStrictEqual(
			options.map((option) => option.label),
			["dpi"],
		);

		const none = await provider.getChildren(languages[1]);
		assert.deepStrictEqual(none, []);
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
				createVisibility(),
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

		test("tooltip of a commit-pinned extension with no known update names the latest commit", () => {
			const item = new ExtensionTreeItem(
				"quarto-ext/demo",
				vscode.TreeItemCollapsibleState.Collapsed,
				"/workspace",
				createExtension({ source: "quarto-ext/demo@4f3c2a1", sourceType: "github" }),
			);

			const tooltip = String(item.tooltip);

			assert.ok(tooltip.includes("Update installs the latest commit of the default branch."), tooltip);
			assert.ok(!tooltip.includes("GitHub tag"), tooltip);
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

		test("a repository that denies access keeps the view message and marks the tooltip", async () => {
			const { provider, view } = await runCheck({
				token: "test-token",
				repositories: { "acme/registry-demo": { githubTags: ["v1.3.0"] }, "acme/github-demo": { githubStatus: 403 } },
			});

			assert.strictEqual(view.message, "Updates checked against GitHub.");
			const tooltip = String((await extensionItem(provider, "acme/github-demo")).tooltip);
			assert.ok(tooltip.includes("The update check of this extension failed."), tooltip);
		});

		test("a project that leaves the cache during the check does not lose the check", async () => {
			restoreBoundary = stubUpdateBoundary({
				token: "test-token",
				repositories: { "acme/registry-demo": { githubTags: ["v1.3.0"] } },
			});
			const provider = new QuartoExtensionTreeDataProvider(
				[makeRoot(makeFolder("treeCommands", TREE_COMMANDS_ROOT))],
				new SchemaCache(),
				new SnippetCache(),
				createVisibility(),
			);
			await waitForInitialRefresh(provider);
			const stubbedFetch = globalThis.fetch;
			globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
				(provider as unknown as { cache: Record<string, unknown> }).cache = {};
				return stubbedFetch(...args);
			}) as typeof fetch;
			const view = { message: undefined, badge: undefined } as unknown as vscode.TreeView<TreeItemType>;

			const total = await provider.checkUpdate({} as vscode.ExtensionContext, view);

			assert.strictEqual(total, 0);
			assert.strictEqual(view.message, undefined);
		});

		test("the crossSource setting is gone", () => {
			// inspect() returns an object for any key; a key that no extension contributes has no default.
			const inspected = vscode.workspace.getConfiguration("quartoWizard").inspect("update.crossSource");
			assert.strictEqual(inspected?.defaultValue, undefined);
		});
	});
	suite("Visibility and embedding", () => {
		let restoreBoundary: (() => void) | undefined;
		let tempDirs: string[] = [];

		teardown(() => {
			restoreBoundary?.();
			restoreBoundary = undefined;
			for (const dir of tempDirs) {
				fs.rmSync(dir, { recursive: true, force: true });
			}
			tempDirs = [];
		});

		/** Creates a project folder that holds one GitHub extension for each identifier. */
		function projectWith(...ids: string[]): string {
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qw-tree-"));
			tempDirs.push(dir);
			for (const id of ids) {
				const extensionDir = path.join(dir, "_extensions", ...id.split("/"));
				fs.mkdirSync(extensionDir, { recursive: true });
				fs.writeFileSync(
					path.join(extensionDir, "_extension.yml"),
					`title: ${id}\nauthor: Acme\nversion: 1.0.0\ncontributes: {}\nsource: ${id}@v1.0.0\nsource-type: github\n`,
				);
			}
			return dir;
		}

		function rootAt(dir: string, embeddedIn?: QuartoProjectRoot["embeddedIn"]): QuartoProjectRoot {
			const root = makeRoot(makeFolder(path.basename(dir), dir));
			return embeddedIn ? { ...root, embeddedIn } : root;
		}

		async function check(
			roots: QuartoProjectRoot[],
			options: UpdateBoundaryOptions,
			visibility = createVisibility(),
		): Promise<{ provider: QuartoExtensionTreeDataProvider; view: vscode.TreeView<TreeItemType> }> {
			restoreBoundary = stubUpdateBoundary({ token: "test-token", ...options });
			const provider = new QuartoExtensionTreeDataProvider(roots, new SchemaCache(), new SnippetCache(), visibility);
			await waitForInitialRefresh(provider);
			const view = { message: undefined, badge: undefined } as unknown as vscode.TreeView<TreeItemType>;
			await provider.checkUpdate({} as vscode.ExtensionContext, view);
			return { provider, view };
		}

		async function itemIn(
			provider: QuartoExtensionTreeDataProvider,
			root: QuartoProjectRoot,
			id: string,
		): Promise<ExtensionTreeItem> {
			const items = await provider.getChildren(new WorkspaceFolderTreeItem(root.label, root.fsPath));
			const item = items.find((candidate) => candidate.label === id);
			assert.ok(item instanceof ExtensionTreeItem, `no tree item for ${id}`);
			return item;
		}

		test("hidden roots are absent from the tree", async () => {
			const shown = rootAt(projectWith("acme/demo"));
			const hidden = rootAt(projectWith("acme/demo"));
			const visibility = createVisibility();
			await visibility.setVisible([hidden], false);
			const provider = new QuartoExtensionTreeDataProvider(
				[shown, hidden],
				new SchemaCache(),
				new SnippetCache(),
				visibility,
			);
			await waitForInitialRefresh(provider);

			const top = await provider.getChildren();

			assert.deepStrictEqual(
				top.map((item) => (item as WorkspaceFolderTreeItem).folderPath),
				[shown.fsPath],
			);
		});

		test("hiding a root removes it from the tree", async () => {
			const shown = rootAt(projectWith("acme/demo"));
			const hidden = rootAt(projectWith("acme/demo"));
			const visibility = createVisibility();
			const provider = new QuartoExtensionTreeDataProvider(
				[shown, hidden],
				new SchemaCache(),
				new SnippetCache(),
				visibility,
			);
			await waitForInitialRefresh(provider);
			assert.strictEqual((await provider.getChildren()).length, 2);

			await visibility.setVisible([hidden], false);

			assert.deepStrictEqual(
				(await provider.getChildren()).map((item) => (item as WorkspaceFolderTreeItem).folderPath),
				[shown.fsPath],
			);
		});

		test("badge counts updates of visible roots only", async () => {
			const shown = rootAt(projectWith("acme/demo"));
			const hidden = rootAt(projectWith("acme/demo"));
			const visibility = createVisibility();
			await visibility.setVisible([hidden], false);

			const { provider, view } = await check(
				[shown, hidden],
				{ repositories: { "acme/demo": { githubTags: ["v2.0.0"] } } },
				visibility,
			);

			assert.strictEqual(view.badge?.value, 1);
			assert.deepStrictEqual(provider.getProjectCounts(hidden.fsPath), { extensions: 1, updates: 1 });
			assert.deepStrictEqual(provider.getProjectCounts(shown.fsPath), { extensions: 1, updates: 1 });
		});

		test("a check fires onDidChangeCounts", async () => {
			restoreBoundary = stubUpdateBoundary({ token: "test-token", repositories: {} });
			const provider = new QuartoExtensionTreeDataProvider(
				[rootAt(projectWith("acme/demo"))],
				new SchemaCache(),
				new SnippetCache(),
				createVisibility(),
			);
			await waitForInitialRefresh(provider);
			let fired = 0;
			const listener = provider.onDidChangeCounts(() => fired++);

			await provider.checkUpdate({} as vscode.ExtensionContext);
			listener.dispose();

			assert.ok(fired > 0);
		});

		test("children of an installed embedded parent are read-only and not checked for updates", async () => {
			const embedded = rootAt(projectWith("acme/child"), {
				id: { owner: "acme", name: "parent" },
				source: "acme/parent@v1.0.0",
			});
			const plain = rootAt(projectWith("acme/other"));
			const requests: string[] = [];

			const { provider } = await check([embedded, plain], {
				requests,
				repositories: { "acme/child": { githubTags: ["v2.0.0"] }, "acme/other": { githubTags: ["v2.0.0"] } },
			});

			assert.ok(
				requests.some((url) => url.includes("/acme/other/")),
				requests.join("\n"),
			);
			assert.ok(!requests.some((url) => url.includes("/acme/child/")), requests.join("\n"));
			const item = await itemIn(provider, embedded, "acme/child");
			assert.strictEqual(item.contextValue, "quartoExtensionItemEmbedded");
			assert.strictEqual(item.update, undefined);
			assert.deepStrictEqual(provider.getProjectCounts(embedded.fsPath), { extensions: 1, updates: 0 });
		});

		test("children of a locally developed parent are updatable", async () => {
			const embedded = rootAt(projectWith("acme/child"), { id: { owner: "acme", name: "parent" } });

			const { provider, view } = await check([embedded], {
				repositories: { "acme/child": { githubTags: ["v2.0.0"] } },
			});

			const item = await itemIn(provider, embedded, "acme/child");
			assert.strictEqual(item.contextValue, "quartoExtensionItem");
			assert.strictEqual(item.update?.latestVersion, "2.0.0");
			assert.strictEqual(view.badge?.value, 1);
		});

		test("a self-embedded child is flagged", async () => {
			const embedded = rootAt(projectWith("acme/self-demo"), { id: { owner: "acme", name: "self-demo" } });

			const { provider, view } = await check([embedded], {
				repositories: { "acme/self-demo": { githubTags: ["v2.0.0"] } },
			});

			const item = await itemIn(provider, embedded, "acme/self-demo");
			assert.strictEqual(item.contextValue, "quartoExtensionItemSelfEmbedded");
			assert.strictEqual(item.description, "embeds itself");
			assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, "error");
			assert.strictEqual(view.badge, undefined);
			assert.deepStrictEqual(provider.getProjectCounts(embedded.fsPath), { extensions: 1, updates: 0 });
		});

		test("setProjectRoots reports a change when only quartoIgnored changes", () => {
			const root = makeRoot(makeFolder("repo", path.resolve(path.sep, "tmp", "repo")), "docs");
			const provider = new QuartoExtensionTreeDataProvider(
				[root],
				new SchemaCache(),
				new SnippetCache(),
				createVisibility(),
			);

			assert.strictEqual(provider.setProjectRoots([{ ...root }]), false);
			assert.strictEqual(provider.setProjectRoots([{ ...root, quartoIgnored: true }]), true);
		});
	});
});
