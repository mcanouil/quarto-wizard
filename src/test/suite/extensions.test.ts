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
	formatExtensionId,
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

	suite("formatExtensionId", () => {
		test("Should format extension ID with owner", () => {
			const result = formatExtensionId({ owner: "quarto-ext", name: "fancy-text" });
			assert.strictEqual(result, "quarto-ext/fancy-text");
		});

		test("Should format extension ID without owner", () => {
			const result = formatExtensionId({ owner: null, name: "fancy-text" });
			assert.strictEqual(result, "fancy-text");
		});
	});

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
});
