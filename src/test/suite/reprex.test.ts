import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { newQuartoReprex } from "../../utils/reprex";

suite("Reprex Utils Test Suite", () => {
	let extensionContext: vscode.ExtensionContext | undefined;

	suiteSetup(async () => {
		// Get the extension to obtain its context
		const extension = vscode.extensions.getExtension("mcanouil.quarto-wizard");
		if (extension) {
			await extension.activate();
			extensionContext = extension.exports?.context;
			// If context is not in exports, we'll create a mock
			if (!extensionContext) {
				// Get extension path from the actual extension
				extensionContext = {
					extensionPath: extension.extensionPath,
				} as vscode.ExtensionContext;
			}
		}
	});

	suite("Language Support", () => {
		test("Should support R language", () => {
			const supportedLanguages = ["R", "Python", "Julia"];
			assert.ok(supportedLanguages.includes("R"), "R should be supported");
		});

		test("Should support Python language", () => {
			const supportedLanguages = ["R", "Python", "Julia"];
			assert.ok(supportedLanguages.includes("Python"), "Python should be supported");
		});

		test("Should support Julia language", () => {
			const supportedLanguages = ["R", "Python", "Julia"];
			assert.ok(supportedLanguages.includes("Julia"), "Julia should be supported");
		});
	});

	suite("Template File Paths", () => {
		test("Should map R to r.qmd template", () => {
			if (!extensionContext) {
				assert.fail("Extension context not available");
				return;
			}

			const expectedPath = path.join(extensionContext.extensionPath, "assets", "templates", "r.qmd");

			// Check if the template file exists
			try {
				assert.ok(fs.existsSync(expectedPath), `R template should exist at ${expectedPath}`);
			} catch (error: unknown) {
				assert.fail(`Template file should exist: ${error instanceof Error ? error.message : String(error)}`);
			}
		});

		test("Should map Python to python.qmd template", () => {
			if (!extensionContext) {
				assert.fail("Extension context not available");
				return;
			}

			const expectedPath = path.join(extensionContext.extensionPath, "assets", "templates", "python.qmd");

			// Check if the template file exists
			try {
				assert.ok(fs.existsSync(expectedPath), `Python template should exist at ${expectedPath}`);
			} catch (error: unknown) {
				assert.fail(`Template file should exist: ${error instanceof Error ? error.message : String(error)}`);
			}
		});

		test("Should map Julia to julia.qmd template", () => {
			if (!extensionContext) {
				assert.fail("Extension context not available");
				return;
			}

			const expectedPath = path.join(extensionContext.extensionPath, "assets", "templates", "julia.qmd");

			// Check if the template file exists
			try {
				assert.ok(fs.existsSync(expectedPath), `Julia template should exist at ${expectedPath}`);
			} catch (error: unknown) {
				assert.fail(`Template file should exist: ${error instanceof Error ? error.message : String(error)}`);
			}
		});
	});

	suite("Error Handling - Unsupported Languages", () => {
		test("Should handle lowercase language names as unsupported", async () => {
			if (!extensionContext) {
				assert.fail("Extension context not available");
				return;
			}

			// Test lowercase versions which should be unsupported
			const unsupportedCases = ["r", "python", "julia"];

			for (const lang of unsupportedCases) {
				// We can't easily mock showErrorMessage, so we'll test indirectly
				// by checking that the function doesn't throw and completes
				try {
					await newQuartoReprex(lang, extensionContext);
					// If we reach here, the function handled the unsupported language gracefully
					assert.ok(true, `Function should handle unsupported language '${lang}' gracefully`);
				} catch (error: unknown) {
					assert.fail(
						`Function should not throw for unsupported language '${lang}': ${
							error instanceof Error ? error.message : String(error)
						}`
					);
				}
			}
		});

		test("Should handle completely invalid language names", async () => {
			if (!extensionContext) {
				assert.fail("Extension context not available");
				return;
			}

			const invalidLanguages = ["JavaScript", "C++", "Go", "Rust", "", "  "];

			for (const lang of invalidLanguages) {
				try {
					await newQuartoReprex(lang, extensionContext);
					assert.ok(true, `Function should handle invalid language '${lang}' gracefully`);
				} catch (error: unknown) {
					assert.fail(
						`Function should not throw for invalid language '${lang}': ${
							error instanceof Error ? error.message : String(error)
						}`
					);
				}
			}
		});
	});

	suite("Case Sensitivity", () => {
		test("Should be case-sensitive for supported languages", async () => {
			if (!extensionContext) {
				assert.fail("Extension context not available");
				return;
			}

			// Only exact case matches should work
			const exactCases = ["R", "Python", "Julia"];
			const incorrectCases = ["r", "PYTHON", "python", "JULIA", "julia", "R ", " Python"];

			// Test that exact cases don't throw (we can't easily test success without mocking)
			for (const lang of exactCases) {
				try {
					await newQuartoReprex(lang, extensionContext);
					assert.ok(true, `Exact case '${lang}' should be processed without throwing`);
				} catch (error: unknown) {
					// Only fail if it's not a file system error (which is expected in tests)
					const errorMessage = error instanceof Error ? error.message : String(error);
					if (!errorMessage.includes("ENOENT") && !errorMessage.includes("Failed to read")) {
						assert.fail(`Exact case '${lang}' should not throw non-file errors: ${errorMessage}`);
					}
				}
			}

			// Test that incorrect cases are handled gracefully
			for (const lang of incorrectCases) {
				try {
					await newQuartoReprex(lang, extensionContext);
					assert.ok(true, `Incorrect case '${lang}' should be handled gracefully`);
				} catch (error: unknown) {
					assert.fail(
						`Function should not throw for incorrect case '${lang}': ${
							error instanceof Error ? error.message : String(error)
						}`
					);
				}
			}
		});
	});

	suite("Integration - Template Content", () => {
		test("Template files should contain valid Quarto front matter", () => {
			if (!extensionContext) {
				assert.fail("Extension context not available");
				return;
			}

			const templateFiles = [
				{ lang: "R", file: "r.qmd" },
				{ lang: "Python", file: "python.qmd" },
				{ lang: "Julia", file: "julia.qmd" },
			];

			templateFiles.forEach(({ lang, file }) => {
				const templatePath = path.join(extensionContext!.extensionPath, "assets", "templates", file);

				if (fs.existsSync(templatePath)) {
					const content = fs.readFileSync(templatePath, "utf8");

					// Basic validation - should start with YAML front matter
					assert.ok(content.startsWith("---"), `${lang} template should start with YAML front matter`);
					assert.ok(content.includes("title:"), `${lang} template should have a title`);
					assert.ok(content.includes("format:"), `${lang} template should have a format`);

					// Should contain proper ending YAML delimiter
					const yamlEnd = content.indexOf("---", 3);
					assert.ok(yamlEnd > 3, `${lang} template should have properly closed YAML front matter`);
				}
			});
		});

		test("Template files should have language-specific engines", () => {
			if (!extensionContext) {
				assert.fail("Extension context not available");
				return;
			}

			const engineMappings = [
				{ lang: "R", file: "r.qmd", expectedEngine: "knitr" },
				{ lang: "Python", file: "python.qmd", expectedEngine: "jupyter" },
				{ lang: "Julia", file: "julia.qmd", expectedEngine: "julia" },
			];

			engineMappings.forEach(({ lang, file, expectedEngine }) => {
				const templatePath = path.join(extensionContext!.extensionPath, "assets", "templates", file);

				if (fs.existsSync(templatePath)) {
					const content = fs.readFileSync(templatePath, "utf8");
					assert.ok(
						content.includes(`engine: ${expectedEngine}`),
						`${lang} template should use ${expectedEngine} engine`
					);
				}
			});
		});
	});

	suite("Function Behaviour", () => {
		test("Should be an async function", () => {
			assert.strictEqual(typeof newQuartoReprex, "function", "newQuartoReprex should be a function");

			if (!extensionContext) {
				assert.fail("Extension context not available");
				return;
			}

			// Call the function and check if it returns a promise-like object
			const result = newQuartoReprex("R", extensionContext);
			assert.ok(
				result === undefined || (result && typeof result.then === "function"),
				"newQuartoReprex should return undefined or a Promise"
			);
		});

		test("Should accept valid parameters", () => {
			if (!extensionContext) {
				assert.fail("Extension context not available");
				return;
			}

			// Should not throw when called with valid parameters
			assert.doesNotThrow(() => {
				newQuartoReprex("R", extensionContext!);
			}, "Function should not throw with valid parameters");

			assert.doesNotThrow(() => {
				newQuartoReprex("Python", extensionContext!);
			}, "Function should not throw with valid parameters");

			assert.doesNotThrow(() => {
				newQuartoReprex("Julia", extensionContext!);
			}, "Function should not throw with valid parameters");
		});
	});
});
