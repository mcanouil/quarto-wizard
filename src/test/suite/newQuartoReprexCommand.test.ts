import * as assert from "assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { newQuartoReprexCommand } from "../../commands/newQuartoReprex";
import { Stubs } from "./stubs";

const ROOT = path.resolve(__dirname, "..", "..", "..");

suite("New Quarto Reprex Command Test Suite", () => {
	const stubs = new Stubs();
	let context: vscode.ExtensionContext;
	let promptOptions: vscode.QuickPickOptions | undefined;
	let offered: readonly string[] | undefined;
	let shown: vscode.TextDocument[];
	let errors: string[];

	function choose(language: string | undefined): void {
		stubs.replace(
			vscode.window,
			"showQuickPick",
			async (items: readonly string[], options: vscode.QuickPickOptions) => {
				offered = items;
				promptOptions = options;
				return language;
			},
		);
	}

	setup(() => {
		promptOptions = undefined;
		offered = undefined;
		shown = [];
		errors = [];
		context = { extensionUri: vscode.Uri.file(ROOT) } as vscode.ExtensionContext;
		stubs.replace(vscode.window, "showTextDocument", async (document: vscode.TextDocument) => {
			shown.push(document);
		});
		stubs.replace(vscode.window, "showErrorMessage", async (message: string) => {
			errors.push(message);
			return undefined;
		});
	});

	teardown(() => stubs.restore());

	test("Should offer R, Python and Julia", async () => {
		choose(undefined);
		await newQuartoReprexCommand(context);
		assert.deepStrictEqual(offered, ["R", "Python", "Julia"]);
		assert.strictEqual(promptOptions?.placeHolder, "Select the computing language");
	});

	for (const [language, template] of [
		["R", "r.qmd"],
		["Python", "python.qmd"],
		["Julia", "julia.qmd"],
	]) {
		test(`Should open an untitled document holding the ${language} template`, async () => {
			choose(language);
			await newQuartoReprexCommand(context);
			assert.strictEqual(shown.length, 1);
			const expected = fs.readFileSync(path.join(ROOT, "assets", "templates", template), "utf-8");
			assert.strictEqual(shown[0].getText(), expected);
			assert.strictEqual(shown[0].isUntitled, true);
			assert.deepStrictEqual(errors, []);
		});
	}

	test("Should report an error and open nothing when no language is chosen", async () => {
		choose(undefined);
		await newQuartoReprexCommand(context);
		assert.deepStrictEqual(errors, ["No computing language selected. Aborting."]);
		assert.strictEqual(shown.length, 0);
	});

	test("Should report an error and open nothing when the template cannot be read", async () => {
		choose("R");
		context = { extensionUri: vscode.Uri.file(path.join(ROOT, "missing-extension-folder")) } as vscode.ExtensionContext;
		await newQuartoReprexCommand(context);
		assert.strictEqual(errors.length, 1);
		assert.ok(errors[0].startsWith("Failed to read the template file:"), errors[0]);
		assert.strictEqual(shown.length, 0);
	});
});
