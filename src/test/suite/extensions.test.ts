import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
	findQuartoExtensions,
	getInstalledExtensions,
	getInstalledExtensionsRecord,
	getExtensionRepository,
	getExtensionSourceUrl,
	getEffectiveSourceType,
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
			"source-type": string;
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
			source: `${author}/${name}@main`,
			"source-type": "github",
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

		if (mergedData["source-type"]) {
			yamlContent += `source-type: "${mergedData["source-type"]}"\n`;
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
		test("Should extract repository from GitHub source with sourceType", async () => {
			createTestExtension("quarto-ext", "fancy-text", {
				source: "quarto-ext/fancy-text@v2.1.0",
				"source-type": "github",
			});

			const extensions = await getInstalledExtensions(tempDir);
			const ext = extensions[0];

			const repository = getExtensionRepository(ext);
			assert.strictEqual(repository, "quarto-ext/fancy-text");
		});

		test("Should extract repository from legacy owner/repo source", async () => {
			createTestExtension("quarto-ext", "legacy-ext", {
				source: "quarto-ext/legacy-ext@v1.0.0",
				"source-type": undefined,
			});

			const extensions = await getInstalledExtensions(tempDir);
			const ext = extensions[0];

			const repository = getExtensionRepository(ext);
			assert.strictEqual(repository, "quarto-ext/legacy-ext");
		});

		test("Should return undefined for URL source type", async () => {
			createTestExtension("quarto-ext", "url-ext", {
				source: "https://example.com/ext.zip",
				"source-type": "url",
			});

			const extensions = await getInstalledExtensions(tempDir);
			const ext = extensions[0];

			const repository = getExtensionRepository(ext);
			assert.strictEqual(repository, undefined);
		});

		test("Should return undefined for local source type", async () => {
			createTestExtension("quarto-ext", "local-ext", {
				source: "./my-extension",
				"source-type": "local",
			});

			const extensions = await getInstalledExtensions(tempDir);
			const ext = extensions[0];

			const repository = getExtensionRepository(ext);
			assert.strictEqual(repository, undefined);
		});

		test("Should return undefined for missing source", async () => {
			createTestExtension("quarto-ext", "no-source", {
				source: undefined,
				"source-type": undefined,
			});

			const extensions = await getInstalledExtensions(tempDir);
			const ext = extensions[0];

			const repository = getExtensionRepository(ext);
			assert.strictEqual(repository, undefined);
		});
	});

	suite("getExtensionSourceUrl", () => {
		test("Should return GitHub URL for GitHub source type", async () => {
			createTestExtension("quarto-ext", "gh-ext", {
				source: "quarto-ext/gh-ext@v1.0.0",
				"source-type": "github",
			});

			const extensions = await getInstalledExtensions(tempDir);
			const ext = extensions[0];

			const url = getExtensionSourceUrl(ext);
			assert.strictEqual(url, "https://github.com/quarto-ext/gh-ext");
		});

		test("Should return URL as-is for URL source type", async () => {
			createTestExtension("quarto-ext", "url-ext2", {
				source: "https://example.com/ext.zip",
				"source-type": "url",
			});

			const extensions = await getInstalledExtensions(tempDir);
			const ext = extensions[0];

			const url = getExtensionSourceUrl(ext);
			assert.strictEqual(url, "https://example.com/ext.zip");
		});

		test("Should return path for local source type", async () => {
			createTestExtension("quarto-ext", "local-ext2", {
				source: "./my-extension",
				"source-type": "local",
			});

			const extensions = await getInstalledExtensions(tempDir);
			const ext = extensions[0];

			const url = getExtensionSourceUrl(ext);
			assert.strictEqual(url, "./my-extension");
		});

		test("Should return GitHub URL for registry source type", async () => {
			createTestExtension("quarto-ext", "reg-ext", {
				source: "quarto-ext/reg-ext@v1.0.0",
				"source-type": "registry",
			});

			const extensions = await getInstalledExtensions(tempDir);
			const ext = extensions[0];

			const url = getExtensionSourceUrl(ext);
			assert.strictEqual(url, "https://github.com/quarto-ext/reg-ext");
		});

		test("Should return undefined for missing source", async () => {
			createTestExtension("quarto-ext", "no-source2", {
				source: undefined,
				"source-type": undefined,
			});

			const extensions = await getInstalledExtensions(tempDir);
			const ext = extensions[0];

			const url = getExtensionSourceUrl(ext);
			assert.strictEqual(url, undefined);
		});

		test("Should infer GitHub URL for legacy owner/repo source", async () => {
			createTestExtension("quarto-ext", "legacy-ext2", {
				source: "quarto-ext/legacy-ext2",
				"source-type": undefined,
			});

			const extensions = await getInstalledExtensions(tempDir);
			const ext = extensions[0];

			const url = getExtensionSourceUrl(ext);
			assert.strictEqual(url, "https://github.com/quarto-ext/legacy-ext2");
		});
	});

	suite("getEffectiveSourceType", () => {
		test("Should return explicit sourceType when present", async () => {
			createTestExtension("quarto-ext", "typed-ext", {
				source: "quarto-ext/typed-ext",
				"source-type": "github",
			});

			const extensions = await getInstalledExtensions(tempDir);
			const ext = extensions[0];

			assert.strictEqual(getEffectiveSourceType(ext), "github");
		});

		test("Should infer url from https source", async () => {
			createTestExtension("quarto-ext", "infer-url", {
				source: "https://example.com/ext.zip",
				"source-type": undefined,
			});

			const extensions = await getInstalledExtensions(tempDir);
			const ext = extensions[0];

			assert.strictEqual(getEffectiveSourceType(ext), "url");
		});

		test("Should infer local from relative path", async () => {
			createTestExtension("quarto-ext", "infer-local", {
				source: "./my-extension",
				"source-type": undefined,
			});

			const extensions = await getInstalledExtensions(tempDir);
			const ext = extensions[0];

			assert.strictEqual(getEffectiveSourceType(ext), "local");
		});

		test("Should infer local from absolute path", async () => {
			createTestExtension("quarto-ext", "infer-abs", {
				source: "/opt/extensions/my-ext",
				"source-type": undefined,
			});

			const extensions = await getInstalledExtensions(tempDir);
			const ext = extensions[0];

			assert.strictEqual(getEffectiveSourceType(ext), "local");
		});

		test("Should infer github from owner/repo pattern", async () => {
			createTestExtension("quarto-ext", "infer-gh", {
				source: "quarto-ext/infer-gh@v1.0.0",
				"source-type": undefined,
			});

			const extensions = await getInstalledExtensions(tempDir);
			const ext = extensions[0];

			assert.strictEqual(getEffectiveSourceType(ext), "github");
		});

		test("Should return undefined for no source", async () => {
			createTestExtension("quarto-ext", "no-src", {
				source: undefined,
				"source-type": undefined,
			});

			const extensions = await getInstalledExtensions(tempDir);
			const ext = extensions[0];

			assert.strictEqual(getEffectiveSourceType(ext), undefined);
		});

		test("Should default to registry for unrecognised source pattern", async () => {
			createTestExtension("quarto-ext", "unknown-src", {
				source: "some-extension",
				"source-type": undefined,
			});

			const extensions = await getInstalledExtensions(tempDir);
			const ext = extensions[0];

			assert.strictEqual(getEffectiveSourceType(ext), "registry");
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
