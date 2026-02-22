import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
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

	test("Should register all commands declared in package.json", async () => {
		const pkgPath = path.resolve(__dirname, "../../../package.json");
		const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
		const declaredCommands: string[] = pkg.contributes.commands.map((cmd: { command: string }) => cmd.command);

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
