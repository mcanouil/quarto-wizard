import * as path from "path";
import { glob } from "glob";

export function run(): Promise<void> {
	// Create the Mocha test runner
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const Mocha = require("mocha");
	const mocha = new Mocha({
		ui: "tdd",
		color: true,
		reporter: "spec",
		timeout: 20000,
	});

	const testsRoot = path.resolve(__dirname, "..");

	return new Promise((resolve, reject) => {
		// Find all test files
		glob("**/**.test.js", { cwd: testsRoot })
			.then((files) => {
				// Add files to the test suite
				files.forEach((file) => mocha.addFile(path.resolve(testsRoot, file)));

				try {
					// Run the Mocha test suite
					mocha.run((failures: number) => {
						if (failures > 0) {
							reject(new Error(`${failures} tests failed.`));
						} else {
							resolve();
						}
					});
				} catch (err) {
					reject(err);
				}
			})
			.catch((err) => {
				reject(err);
			});
	});
}
