import * as assert from "assert";
import * as vscode from "vscode";
import type { DiscoveredExtension } from "@quarto-wizard/core";
import { showExtensionSelectionQuickPick } from "../../ui/extensionSelectionQuickPick";
import { Stubs } from "./stubs";

const EXTENSIONS: DiscoveredExtension[] = [
	{ path: "/tmp/repo/_extensions/acme/one", relativePath: "_extensions/acme/one", id: { owner: "acme", name: "one" } },
	{ path: "/tmp/repo/two", relativePath: "two", id: { owner: null, name: "two" } },
];

interface PickerItem extends vscode.QuickPickItem {
	extension: DiscoveredExtension;
}

suite("Extension Selection QuickPick Test Suite", () => {
	const stubs = new Stubs();
	let shownItems: PickerItem[];
	let shownOptions: vscode.QuickPickOptions | undefined;

	function answer(choose: (items: PickerItem[]) => PickerItem[] | undefined): void {
		stubs.replace(vscode.window, "showQuickPick", async (items: PickerItem[], options: vscode.QuickPickOptions) => {
			shownItems = items;
			shownOptions = options;
			return choose(items);
		});
	}

	teardown(() => stubs.restore());

	test("Should list one unticked item per extension, labelled with its id", async () => {
		answer(() => undefined);
		await showExtensionSelectionQuickPick(EXTENSIONS);
		assert.deepStrictEqual(
			shownItems.map((item) => [item.label, item.description, item.picked]),
			[
				["acme/one", "_extensions/acme/one", false],
				["two", "two", false],
			],
		);
	});

	test("Should ask for several picks, with a title and a placeholder", async () => {
		answer(() => undefined);
		await showExtensionSelectionQuickPick(EXTENSIONS);
		assert.strictEqual(shownOptions?.canPickMany, true);
		assert.strictEqual(shownOptions?.title, "Select Extension(s) to Install");
		assert.ok(shownOptions?.placeHolder?.includes("multiple extensions"));
	});

	test("Should return the extensions behind the picked items", async () => {
		answer((items) => [items[1]]);
		assert.deepStrictEqual(await showExtensionSelectionQuickPick(EXTENSIONS), [EXTENSIONS[1]]);
	});

	test("Should return every extension when all are picked", async () => {
		answer((items) => items);
		assert.deepStrictEqual(await showExtensionSelectionQuickPick(EXTENSIONS), EXTENSIONS);
	});

	test("Should return null when the picker is dismissed", async () => {
		answer(() => undefined);
		assert.strictEqual(await showExtensionSelectionQuickPick(EXTENSIONS), null);
	});

	test("Should return null when nothing is ticked", async () => {
		answer(() => []);
		assert.strictEqual(await showExtensionSelectionQuickPick(EXTENSIONS), null);
	});
});
