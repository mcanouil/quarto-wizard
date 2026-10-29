import * as assert from "assert";
import * as vscode from "vscode";
import { readPackageJson } from "./packageFixtures";

suite("Extension Test Suite", () => {
	vscode.window.showInformationMessage("Start all tests.");

	test("Extension should be present", () => {
		const extension = vscode.extensions.getExtension("mcanouil.quarto-wizard");
		assert.ok(extension, "Extension should be present");
	});

	test("Extension should activate", async () => {
		const extension = vscode.extensions.getExtension("mcanouil.quarto-wizard");
		if (extension) {
			await extension.activate();
			assert.ok(extension.isActive, "Extension should activate");
		}
	});

	test("Should register all commands declared in package.json", async () => {
		const declaredCommands = readPackageJson().contributes.commands.map((cmd) => cmd.command);

		assert.ok(declaredCommands.length > 0, "package.json should declare at least one command");

		const registeredCommands = await vscode.commands.getCommands(true);

		for (const command of declaredCommands) {
			assert.ok(
				registeredCommands.includes(command),
				`Command "${command}" is declared in package.json but not registered`,
			);
		}
	});
});
