import * as assert from "assert";
import * as vscode from "vscode";
import { SchemaCache } from "@quarto-wizard/schema";
import { SnippetCache } from "@quarto-wizard/snippets";
import { QuartoExtensionTreeDataProvider } from "../../ui/extensionTreeDataProvider";
import { ExtensionTreeItem } from "../../ui/extensionTreeItems";
import type { InstalledExtension } from "../../utils/extensions";

suite("Extension Tree Data Provider Test Suite", () => {
	function createProvider(): QuartoExtensionTreeDataProvider {
		return new QuartoExtensionTreeDataProvider([], new SchemaCache(), new SnippetCache());
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
	});
});
