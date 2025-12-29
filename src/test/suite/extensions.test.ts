import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
	findQuartoExtensions,
	getMtimeExtensions,
	findModifiedExtensions,
	readExtensions,
	removeExtension,
	ExtensionData,
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
		test("Should find extensions in _extensions directory", () => {
			// Create test extensions
			createTestExtension("quarto-ext", "fancy-text");
			createTestExtension("mcanouil", "test-extension");

			const extensions = findQuartoExtensions(extensionsDir).map(path.normalize);

			assert.strictEqual(extensions.length, 2, "Should find 2 extensions");
			assert.ok(extensions.includes(path.normalize("quarto-ext/fancy-text")), "Should include fancy-text extension");
			assert.ok(extensions.includes(path.normalize("mcanouil/test-extension")), "Should include test-extension");
		});

		test("Should return empty array for non-existent directory", () => {
			const nonExistentDir = path.join(tempDir, "non-existent");
			const extensions = findQuartoExtensions(nonExistentDir);

			assert.strictEqual(extensions.length, 0, "Should return empty array for non-existent directory");
		});

		test("Should find extensions with .yaml extension", () => {
			// Create extension with .yaml file
			const extPath = path.join(extensionsDir, "test-author", "yaml-extension");
			fs.mkdirSync(extPath, { recursive: true });
			fs.writeFileSync(path.join(extPath, "_extension.yaml"), "title: Test Extension");

			const extensions = findQuartoExtensions(extensionsDir).map(path.normalize);

			assert.strictEqual(extensions.length, 1, "Should find 1 extension");
			assert.ok(extensions.includes(path.normalize("test-author/yaml-extension")), "Should include yaml extension");
		});

		test("Should ignore _extensions subdirectories", () => {
			// Create nested _extensions directory (should be ignored)
			const nestedExtDir = path.join(extensionsDir, "author", "extension", "_extensions");
			fs.mkdirSync(nestedExtDir, { recursive: true });
			fs.writeFileSync(path.join(nestedExtDir, "_extension.yml"), "title: Nested Extension");

			// Create valid extension
			createTestExtension("author", "valid-extension");

			const extensions = findQuartoExtensions(extensionsDir).map(path.normalize);

			assert.strictEqual(extensions.length, 1, "Should find only 1 extension");
			assert.ok(extensions.includes(path.normalize("author/valid-extension")), "Should include valid extension");
		});

		test("Should handle empty directory", () => {
			const emptyDir = path.join(tempDir, "empty");
			fs.mkdirSync(emptyDir);

			const extensions = findQuartoExtensions(emptyDir);

			assert.strictEqual(extensions.length, 0, "Should return empty array for empty directory");
		});
	});

	suite("getMtimeExtensions", () => {
		test("Should return modification times for extensions", async () => {
			createTestExtension("author1", "ext1");
			createTestExtension("author2", "ext2");

			// Add delay to ensure different modification times
			await new Promise((resolve) => setTimeout(resolve, 10));

			const mtimes = getMtimeExtensions(extensionsDir);

			assert.strictEqual(Object.keys(mtimes).length, 2, "Should return mtimes for 2 extensions");
			assert.ok(mtimes[path.normalize("author1/ext1")] instanceof Date, "Should return Date for first extension");
			assert.ok(mtimes[path.normalize("author2/ext2")] instanceof Date, "Should return Date for second extension");
		});

		test("Should return empty object for non-existent directory", () => {
			const nonExistentDir = path.join(tempDir, "non-existent");
			const mtimes = getMtimeExtensions(nonExistentDir);

			assert.deepStrictEqual(mtimes, {}, "Should return empty object for non-existent directory");
		});

		test("Should handle empty directory", () => {
			const emptyDir = path.join(tempDir, "empty");
			fs.mkdirSync(emptyDir);

			const mtimes = getMtimeExtensions(emptyDir);

			assert.deepStrictEqual(mtimes, {}, "Should return empty object for empty directory");
		});
	});

	suite("findModifiedExtensions", () => {
		test("Should find newly added extensions", () => {
			// Get initial state (empty)
			const initialMtimes = getMtimeExtensions(extensionsDir);

			// Add extensions
			createTestExtension("author1", "ext1");
			createTestExtension("author2", "ext2");

			const modifiedExtensions = findModifiedExtensions(initialMtimes, extensionsDir).map(path.normalize);

			assert.strictEqual(modifiedExtensions.length, 2, "Should find 2 modified extensions");
			assert.ok(modifiedExtensions.includes(path.normalize("author1/ext1")), "Should include new extension 1");
			assert.ok(modifiedExtensions.includes(path.normalize("author2/ext2")), "Should include new extension 2");
		});

		test("Should find modified extensions", async () => {
			// Create initial extensions
			const ext1Path = createTestExtension("author1", "ext1");
			createTestExtension("author2", "ext2");

			const initialMtimes = getMtimeExtensions(extensionsDir);

			// Wait a bit to ensure different modification time
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Modify one extension by adding a new file to change directory mtime
			fs.writeFileSync(path.join(ext1Path, "new-file.txt"), "This will change the directory modification time");

			const modifiedExtensions = findModifiedExtensions(initialMtimes, extensionsDir).map(path.normalize);

			assert.strictEqual(modifiedExtensions.length, 1, "Should find 1 modified extension");
			assert.ok(modifiedExtensions.includes(path.normalize("author1/ext1")), "Should include modified extension");
		});

		test("Should return empty array for non-existent directory", () => {
			const nonExistentDir = path.join(tempDir, "non-existent");
			const modifiedExtensions = findModifiedExtensions({}, nonExistentDir);

			assert.strictEqual(modifiedExtensions.length, 0, "Should return empty array for non-existent directory");
		});

		test("Should return empty array when no extensions are modified", () => {
			createTestExtension("author1", "ext1");
			const mtimes = getMtimeExtensions(extensionsDir);

			const modifiedExtensions = findModifiedExtensions(mtimes, extensionsDir);

			assert.strictEqual(modifiedExtensions.length, 0, "Should return empty array when no extensions are modified");
		});
	});

	suite("readExtensions", () => {
		test("Should read extension data correctly", () => {
			createTestExtension("quarto-ext", "fancy-text", {
				title: "Fancy Text Extension",
				author: "Quarto Team",
				version: "2.1.0",
				contributes: {
					shortcodes: ["fancy-text.lua"],
					filters: ["fancy-filter.lua"],
				},
				source: "https://github.com/quarto-ext/fancy-text@v2.1.0",
			});

			const extensionData = readExtensions(tempDir, ["quarto-ext/fancy-text"]);

			assert.strictEqual(Object.keys(extensionData).length, 1, "Should read 1 extension");

			const data = extensionData["quarto-ext/fancy-text"];
			assert.strictEqual(data.title, "Fancy Text Extension", "Should read correct title");
			assert.strictEqual(data.author, "Quarto Team", "Should read correct author");
			assert.strictEqual(data.version, "2.1.0", "Should read correct version");
			assert.strictEqual(data.contributes, "shortcodes, filters", "Should join contributes correctly");
			assert.strictEqual(data.source, "https://github.com/quarto-ext/fancy-text@v2.1.0", "Should read correct source");
			assert.strictEqual(
				data.repository,
				"https://github.com/quarto-ext/fancy-text",
				"Should extract repository correctly",
			);
		});

		test("Should handle .yaml extension files", () => {
			const extPath = path.join(extensionsDir, "test-author", "yaml-ext");
			fs.mkdirSync(extPath, { recursive: true });

			const yamlContent = `title: "YAML Extension"
author: "Test Author"
version: "1.0.0"
contributes:
  shortcodes:
    - test.lua
source: "https://github.com/test-author/yaml-ext@main"
`;
			fs.writeFileSync(path.join(extPath, "_extension.yaml"), yamlContent);

			const extensionData = readExtensions(tempDir, ["test-author/yaml-ext"]);

			assert.strictEqual(Object.keys(extensionData).length, 1, "Should read 1 extension from .yaml file");
			assert.strictEqual(
				extensionData["test-author/yaml-ext"].title,
				"YAML Extension",
				"Should read title from .yaml file",
			);
		});

		test("Should skip non-existent extensions", () => {
			createTestExtension("existing-author", "existing-ext");

			const extensionData = readExtensions(tempDir, ["existing-author/existing-ext", "non-existent/extension"]);

			assert.strictEqual(Object.keys(extensionData).length, 1, "Should read only existing extension");
			assert.ok(extensionData["existing-author/existing-ext"], "Should include existing extension");
			assert.strictEqual(
				extensionData["non-existent/extension"],
				undefined,
				"Should not include non-existent extension",
			);
		});

		test("Should handle extensions without repository in source", () => {
			createTestExtension("local-author", "local-ext", {
				source: undefined,
			});

			const extensionData = readExtensions(tempDir, ["local-author/local-ext"]);

			const data = extensionData["local-author/local-ext"];
			assert.strictEqual(data.source, undefined, "Should handle missing source gracefully");
			assert.strictEqual(data.repository, undefined, "Should handle missing source gracefully");
		});

		test("Should return empty object for empty extension list", () => {
			const extensionData = readExtensions(tempDir, []);

			assert.deepStrictEqual(extensionData, {}, "Should return empty object for empty extension list");
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

	suite("ExtensionData interface", () => {
		test("Should handle all optional properties", () => {
			const extensionData: ExtensionData = {};

			assert.strictEqual(extensionData.title, undefined, "Title should be optional");
			assert.strictEqual(extensionData.author, undefined, "Author should be optional");
			assert.strictEqual(extensionData.version, undefined, "Version should be optional");
			assert.strictEqual(extensionData.contributes, undefined, "Contributes should be optional");
			assert.strictEqual(extensionData.source, undefined, "Source should be optional");
			assert.strictEqual(extensionData.repository, undefined, "Repository should be optional");
		});

		test("Should handle partial data", () => {
			const extensionData: ExtensionData = {
				title: "Test Extension",
				version: "1.0.0",
			};

			assert.strictEqual(extensionData.title, "Test Extension", "Should preserve provided title");
			assert.strictEqual(extensionData.version, "1.0.0", "Should preserve provided version");
			assert.strictEqual(extensionData.author, undefined, "Unprovided author should be undefined");
		});
	});
});
