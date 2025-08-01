import * as path from "path";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
	try {
		// The folder containing the Extension Manifest package.json
		// Passed to `--extensionDevelopmentPath`
		const extensionDevelopmentPath = path.resolve(__dirname, "../../");

		// The path to the extension test runner script
		// Passed to `--extensionTestsPath`
		const extensionTestsPath = path.resolve(__dirname, "./suite/index");

		// Download VS Code, unzip it and run the integration test
		await runTests({
			extensionDevelopmentPath,
			extensionTestsPath,
			launchArgs: [
				"--disable-extensions",
				// '--no-sandbox' // uncomment if running in CI
			],
		});
	} catch (err) {
		console.error("Failed to run tests");
		console.error(err);
		process.exit(1);
	}
}

main();
