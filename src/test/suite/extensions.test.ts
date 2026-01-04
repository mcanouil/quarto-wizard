import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
	findQuartoExtensions,
	getInstalledExtensions,
	getInstalledExtensionsRecord,
	getExtensionRepository,
	getExtensionContributes,
	removeExtension,
} from "../../utils/extensions";

suite("Extensions Utils Test Suite", () => {
	let tempDir: string;
	let extensionsDir: string;

	setup(async () => {
		// Create temporary directory for tests
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quarto-wizard-test-"));
		extensionsDir = path.join(tempDir, "_extensions");
		fs.mkdirSync(extensionsDir, { recursive: true });
	});

	teardown(() => {
		// Clean up temporary directory
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	/**
	 * Helper function to create a test extension structure
	 */
	function createTestExtension(
		author: string,
		name: string,
		extensionData: Partial<{
			title: string;
			author: string;
			version: string;
			contributes: Record<string, string[]>;
			source: string;
		}> = {},
	) {
		const extPath = path.join(extensionsDir, author, name);
		fs.mkdirSync(extPath, { recursive: true });

		const defaultData = {
			title: `${name} Extension`,
			author: author,
			version: "1.0.0",
			contributes: {
				shortcodes: [`${name}.lua`],
			},
			source: `https://github.com/${author}/${name}@main`,
		};

		const mergedData = { ...defaultData, ...extensionData };

		let yamlContent = `title: "${mergedData.title}"
author: "${mergedData.author}"
version: "${mergedData.version}"
contributes:\n`;

		// Handle contributes properly
		for (const [key, value] of Object.entries(mergedData.contributes)) {
			yamlContent += `  ${key}:\n`;
			value.forEach((item) => {
				yamlContent += `    - ${item}\n`;
			});
		}

		if (mergedData.source) {
			yamlContent += `source: "${mergedData.source}"\n`;
		}

		fs.writeFileSync(path.join(extPath, "_extension.yml"), yamlContent);
		return extPath;
	}

	suite("findQuartoExtensions", () => {
		test("Should find extensions in _extensions directory", async () => {
			// Create test extensions
			createTestExtension("quarto-ext", "fancy-text");
			createTestExtension("mcanouil", "test-extension");

			const extensions = await findQuartoExtensions(tempDir);

			assert.strictEqual(extensions.length, 2, "Should find 2 extensions");
			assert.ok(extensions.includes("quarto-ext/fancy-text"), "Should include fancy-text extension");
			assert.ok(extensions.includes("mcanouil/test-extension"), "Should include test-extension");
		});

		test("Should return empty array for non-existent directory", async () => {
			const nonExistentDir = path.join(tempDir, "non-existent");
			const extensions = await findQuartoExtensions(nonExistentDir);

			assert.strictEqual(extensions.length, 0, "Should return empty array for non-existent directory");
		});

		test("Should find extensions with .yaml extension", async () => {
			// Create extension with .yaml file
			const extPath = path.join(extensionsDir, "test-author", "yaml-extension");
			fs.mkdirSync(extPath, { recursive: true });
			fs.writeFileSync(path.join(extPath, "_extension.yaml"), "title: Test Extension\nversion: 1.0.0");

			const extensions = await findQuartoExtensions(tempDir);

			assert.strictEqual(extensions.length, 1, "Should find 1 extension");
			assert.ok(extensions.includes("test-author/yaml-extension"), "Should include yaml extension");
		});

		test("Should handle empty directory", async () => {
			const emptyDir = path.join(tempDir, "empty");
			fs.mkdirSync(emptyDir);

			const extensions = await findQuartoExtensions(emptyDir);

			assert.strictEqual(extensions.length, 0, "Should return empty array for empty directory");
		});
	});

	suite("getInstalledExtensions", () => {
		test("Should return installed extensions array", async () => {
			createTestExtension("quarto-ext", "fancy-text");
			createTestExtension("mcanouil", "test-extension");

			const extensions = await getInstalledExtensions(tempDir);

			assert.strictEqual(extensions.length, 2, "Should find 2 extensions");
		});

		test("Should return empty array for non-existent directory", async () => {
			const nonExistentDir = path.join(tempDir, "non-existent");
			const extensions = await getInstalledExtensions(nonExistentDir);

			assert.strictEqual(extensions.length, 0, "Should return empty array");
		});
	});

	suite("getInstalledExtensionsRecord", () => {
		test("Should return extensions as record", async () => {
			createTestExtension("quarto-ext", "fancy-text", {
				title: "Fancy Text Extension",
				version: "2.1.0",
			});

			const record = await getInstalledExtensionsRecord(tempDir);

			assert.strictEqual(Object.keys(record).length, 1, "Should have 1 extension");
			assert.ok(record["quarto-ext/fancy-text"], "Should include the extension");
			assert.strictEqual(record["quarto-ext/fancy-text"].manifest.title, "Fancy Text Extension");
			assert.strictEqual(record["quarto-ext/fancy-text"].manifest.version, "2.1.0");
		});
	});

	suite("getExtensionRepository", () => {
		test("Should extract repository from source", async () => {
			createTestExtension("quarto-ext", "fancy-text", {
				source: "https://github.com/quarto-ext/fancy-text@v2.1.0",
			});

			const extensions = await getInstalledExtensions(tempDir);
			const ext = extensions[0];

			const repository = getExtensionRepository(ext);
			assert.strictEqual(repository, "https://github.com/quarto-ext/fancy-text");
		});

		test("Should return undefined for missing source", async () => {
			createTestExtension("quarto-ext", "no-source", {
				source: undefined,
			});

			const extensions = await getInstalledExtensions(tempDir);
			const ext = extensions[0];

			const repository = getExtensionRepository(ext);
			assert.strictEqual(repository, undefined);
		});
	});

	suite("getExtensionContributes", () => {
		test("Should return comma-separated contributes", async () => {
			createTestExtension("quarto-ext", "fancy-text", {
				contributes: {
					shortcodes: ["fancy-text.lua"],
					filters: ["fancy-filter.lua"],
				},
			});

			const extensions = await getInstalledExtensions(tempDir);
			const ext = extensions[0];

			const contributes = getExtensionContributes(ext);
			// Core library normalises plural keys to singular (e.g., "shortcodes" -> "shortcode")
			assert.ok(contributes?.includes("shortcode"));
			assert.ok(contributes?.includes("filter"));
		});
	});

	suite("removeExtension", () => {
		test("Should remove extension and clean up empty parent directories", async () => {
			const extPath = createTestExtension("author", "test-extension");

			assert.ok(fs.existsSync(extPath), "Extension should exist before removal");

			const result = await removeExtension("author/test-extension", extensionsDir);

			assert.strictEqual(result, true, "Should return true on successful removal");
			assert.ok(!fs.existsSync(extPath), "Extension directory should be removed");
			assert.ok(!fs.existsSync(path.dirname(extPath)), "Parent author directory should be removed if empty");
		});

		test("Should not remove parent directory if it contains other extensions", async () => {
			createTestExtension("author", "extension1");
			createTestExtension("author", "extension2");

			const authorDir = path.join(extensionsDir, "author");
			assert.ok(fs.existsSync(authorDir), "Author directory should exist");

			const result = await removeExtension("author/extension1", extensionsDir);

			assert.strictEqual(result, true, "Should return true on successful removal");
			assert.ok(fs.existsSync(authorDir), "Author directory should still exist when containing other extensions");
			assert.ok(fs.existsSync(path.join(authorDir, "extension2")), "Other extension should still exist");
		});

		test("Should remove root _extensions directory if it becomes empty", async () => {
			createTestExtension("author", "test-extension");

			const result = await removeExtension("author/test-extension", extensionsDir);

			assert.strictEqual(result, true, "Should return true on successful removal");
			assert.ok(!fs.existsSync(extensionsDir), "Root _extensions directory should be removed if empty");
		});

		test("Should not remove root directory if it contains other extensions", async () => {
			createTestExtension("author1", "extension1");
			createTestExtension("author2", "extension2");

			const result = await removeExtension("author1/extension1", extensionsDir);

			assert.strictEqual(result, true, "Should return true on successful removal");
			assert.ok(fs.existsSync(extensionsDir), "Root directory should still exist when containing other extensions");
		});

		test("Should return false for non-existent extension", async () => {
			const result = await removeExtension("non-existent/extension", extensionsDir);

			assert.strictEqual(result, false, "Should return false for non-existent extension");
		});

		test("Should handle removal errors gracefully", async () => {
			// Create extension with restricted permissions to simulate removal error
			const extPath = createTestExtension("author", "restricted-extension");

			// Make directory read-only on Unix systems
			if (process.platform !== "win32") {
				fs.chmodSync(path.dirname(extPath), 0o444);

				const result = await removeExtension("author/restricted-extension", extensionsDir);

				assert.strictEqual(result, false, "Should return false when removal fails");

				// Restore permissions for cleanup
				fs.chmodSync(path.dirname(extPath), 0o755);
			} else {
				// On Windows, simulate by testing non-existent path
				const result = await removeExtension("non-existent/extension", extensionsDir);
				assert.strictEqual(result, false, "Should return false for non-existent extension on Windows");
			}
		});
	});
});
