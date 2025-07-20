import * as assert from "assert";
import * as vscode from "vscode";

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

	test("Should register all commands", () => {
		const registeredCommands = vscode.commands.getCommands(true);
		return registeredCommands.then((commands) => {
			const expectedCommands = [
				"quartoWizard.installExtension",
				"quartoWizard.extensionsInstalled.install",
				"quartoWizard.newQuartoReprex",
			];

			expectedCommands.forEach((command) => {
				assert.ok(commands.includes(command), `Command ${command} should be registered`);
			});
		});
	});
});
