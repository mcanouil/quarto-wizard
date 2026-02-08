/**
 * Tests for "use brand" operations.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as tar from "tar";
import {
	checkForBrandExtension,
	findBrandFile,
	extractBrandFilePaths,
	resolveStagedDir,
	useBrand,
} from "../../src/operations/brand.js";

// --- Helpers ---

function createTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "qw-brand-test-"));
}

function createFile(baseDir: string, relativePath: string, content = ""): string {
	const fullPath = path.join(baseDir, relativePath);
	fs.mkdirSync(path.dirname(fullPath), { recursive: true });
	fs.writeFileSync(fullPath, content);
	return fullPath;
}

// --- checkForBrandExtension ---

describe("checkForBrandExtension", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = createTempDir();
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("should detect brand extension from _extension.yml", () => {
		createFile(
			tempDir,
			"_extension.yml",
			[
				"title: My Brand",
				"author: Test",
				"version: 1.0.0",
				"contributes:",
				"  metadata:",
				"    project:",
				"      brand: brand.yml",
			].join("\n"),
		);

		const result = checkForBrandExtension(tempDir);

		expect(result.isBrandExtension).toBe(true);
		expect(result.extensionDir).toBe(tempDir);
		expect(result.brandFileName).toBe("brand.yml");
	});

	it("should detect brand extension from _extension.yaml", () => {
		createFile(
			tempDir,
			"_extension.yaml",
			[
				"title: My Brand",
				"author: Test",
				"version: 1.0.0",
				"contributes:",
				"  metadata:",
				"    project:",
				"      brand: _brand.yml",
			].join("\n"),
		);

		const result = checkForBrandExtension(tempDir);

		expect(result.isBrandExtension).toBe(true);
		expect(result.brandFileName).toBe("_brand.yml");
	});

	it("should return false for extension without brand contribution", () => {
		createFile(
			tempDir,
			"_extension.yml",
			[
				"title: Filter Extension",
				"author: Test",
				"version: 1.0.0",
				"contributes:",
				"  filters:",
				"    - filter.lua",
			].join("\n"),
		);

		const result = checkForBrandExtension(tempDir);

		expect(result.isBrandExtension).toBe(false);
	});

	it("should return false for directory without extension file", () => {
		createFile(tempDir, "README.md", "# Not an extension");

		const result = checkForBrandExtension(tempDir);

		expect(result.isBrandExtension).toBe(false);
	});

	it("should return false for invalid YAML", () => {
		createFile(tempDir, "_extension.yml", ":::invalid yaml:::");

		const result = checkForBrandExtension(tempDir);

		expect(result.isBrandExtension).toBe(false);
	});

	it("should return false when brand field is empty string", () => {
		createFile(
			tempDir,
			"_extension.yml",
			[
				"title: My Brand",
				"author: Test",
				"version: 1.0.0",
				'contributes:',
				"  metadata:",
				"    project:",
				'      brand: ""',
			].join("\n"),
		);

		const result = checkForBrandExtension(tempDir);

		expect(result.isBrandExtension).toBe(false);
	});
});

// --- findBrandFile ---

describe("findBrandFile", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = createTempDir();
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("should find _brand.yml at root (plain brand repo)", () => {
		createFile(tempDir, "_brand.yml", "color:\n  background: white");

		const result = findBrandFile(tempDir);

		expect(result).not.toBeNull();
		expect(result!.isBrandExtension).toBe(false);
		expect(result!.brandFilePath).toBe(path.join(tempDir, "_brand.yml"));
		expect(result!.brandFileDir).toBe(tempDir);
	});

	it("should find _brand.yaml at root", () => {
		createFile(tempDir, "_brand.yaml", "color:\n  background: white");

		const result = findBrandFile(tempDir);

		expect(result).not.toBeNull();
		expect(result!.brandFilePath).toBe(path.join(tempDir, "_brand.yaml"));
	});

	it("should find brand in _extensions/name/ (direct child)", () => {
		createFile(
			tempDir,
			"_extensions/my-brand/_extension.yml",
			[
				"title: My Brand",
				"author: Test",
				"version: 1.0.0",
				"contributes:",
				"  metadata:",
				"    project:",
				"      brand: brand.yml",
			].join("\n"),
		);
		createFile(tempDir, "_extensions/my-brand/brand.yml", "color:\n  background: white");

		const result = findBrandFile(tempDir);

		expect(result).not.toBeNull();
		expect(result!.isBrandExtension).toBe(true);
		expect(result!.brandFilePath).toBe(path.join(tempDir, "_extensions/my-brand/brand.yml"));
		expect(result!.brandFileDir).toBe(path.join(tempDir, "_extensions/my-brand"));
	});

	it("should find brand in _extensions/owner/name/ (nested)", () => {
		createFile(
			tempDir,
			"_extensions/mcanouil/my-brand/_extension.yml",
			[
				"title: My Brand",
				"author: Test",
				"version: 1.0.0",
				"contributes:",
				"  metadata:",
				"    project:",
				"      brand: brand.yml",
			].join("\n"),
		);
		createFile(tempDir, "_extensions/mcanouil/my-brand/brand.yml", "color:\n  background: white");

		const result = findBrandFile(tempDir);

		expect(result).not.toBeNull();
		expect(result!.isBrandExtension).toBe(true);
		expect(result!.brandFilePath).toBe(path.join(tempDir, "_extensions/mcanouil/my-brand/brand.yml"));
	});

	it("should prefer root _brand.yml over extension brand", () => {
		createFile(tempDir, "_brand.yml", "color:\n  background: root");
		createFile(
			tempDir,
			"_extensions/ext/_extension.yml",
			[
				"title: Ext",
				"author: Test",
				"version: 1.0.0",
				"contributes:",
				"  metadata:",
				"    project:",
				"      brand: brand.yml",
			].join("\n"),
		);
		createFile(tempDir, "_extensions/ext/brand.yml", "color:\n  background: ext");

		const result = findBrandFile(tempDir);

		expect(result).not.toBeNull();
		expect(result!.isBrandExtension).toBe(false);
		expect(result!.brandFilePath).toBe(path.join(tempDir, "_brand.yml"));
	});

	it("should return null when no brand file exists", () => {
		createFile(tempDir, "README.md", "# Nothing here");

		const result = findBrandFile(tempDir);

		expect(result).toBeNull();
	});

	it("should return null when extension references brand file that does not exist", () => {
		createFile(
			tempDir,
			"_extensions/ext/_extension.yml",
			[
				"title: Ext",
				"author: Test",
				"version: 1.0.0",
				"contributes:",
				"  metadata:",
				"    project:",
				"      brand: missing.yml",
			].join("\n"),
		);

		const result = findBrandFile(tempDir);

		expect(result).toBeNull();
	});
});

// --- extractBrandFilePaths ---

describe("extractBrandFilePaths", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = createTempDir();
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("should extract logo image paths (object with path and alt)", () => {
		const brandPath = createFile(
			tempDir,
			"_brand.yml",
			[
				"logo:",
				"  images:",
				"    light:",
				"      path: logos/logo-dark.svg",
				'      alt: "Light logo"',
				"    dark:",
				"      path: logos/logo-light.svg",
				'      alt: "Dark logo"',
			].join("\n"),
		);

		const paths = extractBrandFilePaths(brandPath);

		expect(paths).toContain("logos/logo-dark.svg");
		expect(paths).toContain("logos/logo-light.svg");
		expect(paths).toHaveLength(2);
	});

	it("should extract logo image paths (string format)", () => {
		const brandPath = createFile(
			tempDir,
			"_brand.yml",
			[
				"logo:",
				"  images:",
				"    main: images/logo.png",
			].join("\n"),
		);

		const paths = extractBrandFilePaths(brandPath);

		expect(paths).toContain("images/logo.png");
	});

	it("should extract logo size paths (light/dark object)", () => {
		const brandPath = createFile(
			tempDir,
			"_brand.yml",
			[
				"logo:",
				"  small:",
				"    light: images/small-light.png",
				"    dark: images/small-dark.png",
			].join("\n"),
		);

		const paths = extractBrandFilePaths(brandPath);

		expect(paths).toContain("images/small-light.png");
		expect(paths).toContain("images/small-dark.png");
	});

	it("should extract logo size path (direct string)", () => {
		const brandPath = createFile(
			tempDir,
			"_brand.yml",
			[
				"logo:",
				"  medium: images/medium.png",
			].join("\n"),
		);

		const paths = extractBrandFilePaths(brandPath);

		expect(paths).toContain("images/medium.png");
	});

	it("should skip named image references (not file paths)", () => {
		const brandPath = createFile(
			tempDir,
			"_brand.yml",
			[
				"logo:",
				"  images:",
				"    light:",
				"      path: logos/logo-dark.svg",
				'      alt: "Light logo"',
				"    dark:",
				"      path: logos/logo-light.svg",
				'      alt: "Dark logo"',
				"  small:",
				"    light: light",
				"    dark: dark",
			].join("\n"),
		);

		const paths = extractBrandFilePaths(brandPath);

		// "light" and "dark" are named references, not file paths.
		expect(paths).not.toContain("light");
		expect(paths).not.toContain("dark");
		expect(paths).toContain("logos/logo-dark.svg");
		expect(paths).toContain("logos/logo-light.svg");
		expect(paths).toHaveLength(2);
	});

	it("should extract font file paths with source: file", () => {
		const brandPath = createFile(
			tempDir,
			"_brand.yml",
			[
				"typography:",
				"  fonts:",
				"    - family: Custom Font",
				"      source: file",
				"      files:",
				"        - fonts/custom-regular.woff2",
				"        - fonts/custom-bold.woff2",
			].join("\n"),
		);

		const paths = extractBrandFilePaths(brandPath);

		expect(paths).toContain("fonts/custom-regular.woff2");
		expect(paths).toContain("fonts/custom-bold.woff2");
	});

	it("should skip fonts with non-file sources (e.g., google)", () => {
		const brandPath = createFile(
			tempDir,
			"_brand.yml",
			[
				"typography:",
				"  fonts:",
				"    - family: Roboto",
				"      source: google",
				"    - family: Custom",
				"      source: file",
				"      files:",
				"        - fonts/custom.woff2",
			].join("\n"),
		);

		const paths = extractBrandFilePaths(brandPath);

		expect(paths).toHaveLength(1);
		expect(paths).toContain("fonts/custom.woff2");
	});

	it("should skip URLs", () => {
		const brandPath = createFile(
			tempDir,
			"_brand.yml",
			[
				"logo:",
				"  images:",
				"    remote: https://example.com/logo.png",
				"    local: images/logo.png",
			].join("\n"),
		);

		const paths = extractBrandFilePaths(brandPath);

		expect(paths).not.toContain("https://example.com/logo.png");
		expect(paths).toContain("images/logo.png");
	});

	it("should deduplicate paths", () => {
		const brandPath = createFile(
			tempDir,
			"_brand.yml",
			[
				"logo:",
				"  images:",
				"    main: logos/logo.svg",
				"  small: logos/logo.svg",
			].join("\n"),
		);

		const paths = extractBrandFilePaths(brandPath);

		expect(paths).toHaveLength(1);
		expect(paths).toContain("logos/logo.svg");
	});

	it("should return empty array for missing file", () => {
		const paths = extractBrandFilePaths(path.join(tempDir, "nonexistent.yml"));

		expect(paths).toEqual([]);
	});

	it("should call onWarning for missing file", () => {
		const warnings: string[] = [];
		const paths = extractBrandFilePaths(path.join(tempDir, "nonexistent.yml"), (msg) => warnings.push(msg));

		expect(paths).toEqual([]);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("Failed to read brand file");
	});

	it("should call onWarning for invalid YAML", () => {
		const brandPath = createFile(tempDir, "_brand.yml", "[invalid: yaml:");
		const warnings: string[] = [];
		const paths = extractBrandFilePaths(brandPath, (msg) => warnings.push(msg));

		expect(paths).toEqual([]);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("Failed to read brand file");
	});

	it("should return empty array for empty YAML", () => {
		const brandPath = createFile(tempDir, "_brand.yml", "");

		const paths = extractBrandFilePaths(brandPath);

		expect(paths).toEqual([]);
	});

	it("should handle the mcanouil/quarto-mcanouil brand structure", () => {
		const brandPath = createFile(
			tempDir,
			"brand.yml",
			[
				"logo:",
				"  images:",
				"    light:",
				"      path: logos/logo-dark-path.svg",
				'      alt: "Light logo"',
				"    dark:",
				"      path: logos/logo-light-path.svg",
				'      alt: "Dark logo"',
				"  small:",
				"    light: light",
				"    dark: dark",
				"  medium:",
				"    light: light",
				"    dark: dark",
				"  large:",
				"    light: light",
				"    dark: dark",
				"typography:",
				"  fonts:",
				"    - family: Alegreya Sans",
				"      source: google",
				"    - family: Fira Code",
				"      source: google",
			].join("\n"),
		);

		const paths = extractBrandFilePaths(brandPath);

		expect(paths).toContain("logos/logo-dark-path.svg");
		expect(paths).toContain("logos/logo-light-path.svg");
		expect(paths).toHaveLength(2);
	});
});

// --- resolveStagedDir ---

describe("resolveStagedDir", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = createTempDir();
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("should return the single subdirectory when extract contains one directory and no files", () => {
		fs.mkdirSync(path.join(tempDir, "owner-repo-abc123"), { recursive: true });

		const result = resolveStagedDir(tempDir);

		expect(result).toBe(path.join(tempDir, "owner-repo-abc123"));
	});

	it("should return the extract directory itself when it contains multiple directories", () => {
		fs.mkdirSync(path.join(tempDir, "dir1"), { recursive: true });
		fs.mkdirSync(path.join(tempDir, "dir2"), { recursive: true });

		const result = resolveStagedDir(tempDir);

		expect(result).toBe(tempDir);
	});

	it("should return the extract directory itself when it contains files alongside a directory", () => {
		fs.mkdirSync(path.join(tempDir, "subdir"), { recursive: true });
		fs.writeFileSync(path.join(tempDir, "file.txt"), "content");

		const result = resolveStagedDir(tempDir);

		expect(result).toBe(tempDir);
	});

	it("should return the extract directory itself when it is empty", () => {
		const result = resolveStagedDir(tempDir);

		expect(result).toBe(tempDir);
	});

	it("should return the extract directory itself when it contains only files", () => {
		fs.writeFileSync(path.join(tempDir, "_brand.yml"), "color: white");

		const result = resolveStagedDir(tempDir);

		expect(result).toBe(tempDir);
	});

	it("should return the extract directory unchanged when it does not exist", () => {
		const nonExistent = path.join(tempDir, "no-such-dir");

		const result = resolveStagedDir(nonExistent);

		expect(result).toBe(nonExistent);
	});
});

// --- useBrand (local source) ---

describe("useBrand", () => {
	let sourceDir: string;
	let projectDir: string;

	beforeEach(() => {
		sourceDir = createTempDir();
		projectDir = createTempDir();
	});

	afterEach(() => {
		fs.rmSync(sourceDir, { recursive: true, force: true });
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it("should copy brand file and assets from plain brand repo", async () => {
		createFile(
			sourceDir,
			"_brand.yml",
			[
				"logo:",
				"  images:",
				"    main:",
				"      path: logos/logo.svg",
				'      alt: "Logo"',
			].join("\n"),
		);
		createFile(sourceDir, "logos/logo.svg", "<svg></svg>");

		const result = await useBrand(sourceDir, { projectDir });

		expect(result.success).toBe(true);
		expect(result.created).toContain("_brand.yml");
		expect(result.created).toContain("logos/logo.svg");
		expect(fs.existsSync(path.join(projectDir, "_brand", "_brand.yml"))).toBe(true);
		expect(fs.existsSync(path.join(projectDir, "_brand", "logos", "logo.svg"))).toBe(true);
	});

	it("should copy brand from extension structure and rename to _brand.yml", async () => {
		createFile(
			sourceDir,
			"_extensions/owner/my-brand/_extension.yml",
			[
				"title: My Brand",
				"author: Test",
				"version: 1.0.0",
				"contributes:",
				"  metadata:",
				"    project:",
				"      brand: brand.yml",
			].join("\n"),
		);
		createFile(
			sourceDir,
			"_extensions/owner/my-brand/brand.yml",
			[
				"logo:",
				"  images:",
				"    light:",
				"      path: logos/light.svg",
				'      alt: "Light"',
			].join("\n"),
		);
		createFile(sourceDir, "_extensions/owner/my-brand/logos/light.svg", "<svg>light</svg>");

		const result = await useBrand(sourceDir, { projectDir });

		expect(result.success).toBe(true);
		expect(result.created).toContain("_brand.yml");
		expect(result.created).toContain("logos/light.svg");
		expect(fs.existsSync(path.join(projectDir, "_brand", "_brand.yml"))).toBe(true);
		expect(fs.existsSync(path.join(projectDir, "_brand", "logos", "light.svg"))).toBe(true);
	});

	it("should throw when no brand file is found", async () => {
		createFile(sourceDir, "README.md", "# No brand here");

		await expect(useBrand(sourceDir, { projectDir })).rejects.toThrow("No brand file found");
	});

	it("should handle overwrite confirmation (approved)", async () => {
		// Pre-existing brand file.
		createFile(path.join(projectDir, "_brand"), "_brand.yml", "old content");

		// New brand source.
		createFile(sourceDir, "_brand.yml", "new content");

		const result = await useBrand(sourceDir, {
			projectDir,
			confirmOverwrite: async () => true,
		});

		expect(result.success).toBe(true);
		expect(result.overwritten).toContain("_brand.yml");

		const content = fs.readFileSync(path.join(projectDir, "_brand", "_brand.yml"), "utf-8");
		expect(content).toBe("new content");
	});

	it("should handle overwrite confirmation (declined)", async () => {
		createFile(path.join(projectDir, "_brand"), "_brand.yml", "old content");
		createFile(sourceDir, "_brand.yml", "new content");

		const result = await useBrand(sourceDir, {
			projectDir,
			confirmOverwrite: async () => false,
		});

		expect(result.success).toBe(true);
		expect(result.skipped).toContain("_brand.yml");

		const content = fs.readFileSync(path.join(projectDir, "_brand", "_brand.yml"), "utf-8");
		expect(content).toBe("old content");
	});

	it("should create new files even when overwrite is declined", async () => {
		const brandYaml = [
			"logo:",
			"  images:",
			"    main:",
			"      path: logo.png",
			'      alt: "Logo"',
		].join("\n");

		// Pre-existing brand file.
		createFile(path.join(projectDir, "_brand"), "_brand.yml", "old content");

		// New brand source has both the existing file and a referenced asset.
		createFile(sourceDir, "_brand.yml", brandYaml);
		createFile(sourceDir, "logo.png", "logo data");

		const result = await useBrand(sourceDir, {
			projectDir,
			confirmOverwrite: async () => false,
		});

		expect(result.success).toBe(true);
		expect(result.skipped).toContain("_brand.yml");
		expect(result.created).toContain("logo.png");

		// Existing file should be unchanged.
		const oldContent = fs.readFileSync(path.join(projectDir, "_brand", "_brand.yml"), "utf-8");
		expect(oldContent).toBe("old content");

		// New file should be created.
		const newContent = fs.readFileSync(path.join(projectDir, "_brand", "logo.png"), "utf-8");
		expect(newContent).toBe("logo data");
	});

	it("should clean up extra files when confirmed", async () => {
		// Pre-existing extra file.
		createFile(path.join(projectDir, "_brand"), "old-logo.svg", "old");
		createFile(path.join(projectDir, "_brand"), "_brand.yml", "old");

		// New source has only _brand.yml.
		createFile(sourceDir, "_brand.yml", "new content");

		const result = await useBrand(sourceDir, {
			projectDir,
			confirmOverwrite: async () => true,
			cleanupExtra: async () => true,
		});

		expect(result.success).toBe(true);
		expect(result.cleaned).toContain("old-logo.svg");
		expect(fs.existsSync(path.join(projectDir, "_brand", "old-logo.svg"))).toBe(false);
	});

	it("should not clean up extra files when declined", async () => {
		createFile(path.join(projectDir, "_brand"), "old-logo.svg", "old");
		createFile(sourceDir, "_brand.yml", "new content");

		const result = await useBrand(sourceDir, {
			projectDir,
			cleanupExtra: async () => false,
		});

		expect(result.success).toBe(true);
		expect(result.cleaned).toEqual([]);
		expect(fs.existsSync(path.join(projectDir, "_brand", "old-logo.svg"))).toBe(true);
	});

	it("should skip missing referenced assets without failing", async () => {
		createFile(
			sourceDir,
			"_brand.yml",
			[
				"logo:",
				"  images:",
				"    main:",
				"      path: logos/missing.svg",
				'      alt: "Missing"',
			].join("\n"),
		);
		// Do not create logos/missing.svg.

		const result = await useBrand(sourceDir, { projectDir });

		expect(result.success).toBe(true);
		expect(result.created).toContain("_brand.yml");
		expect(result.created).not.toContain("logos/missing.svg");
	});

	it("should skip path traversal references in brand YAML", async () => {
		// Create a brand file referencing a path that escapes _brand/.
		// Use a nested source directory so the traversal target stays within the temp dir.
		const nestedSource = path.join(sourceDir, "deep", "nested", "source");
		fs.mkdirSync(nestedSource, { recursive: true });

		createFile(
			nestedSource,
			"_brand.yml",
			[
				"logo:",
				"  images:",
				"    evil:",
				"      path: ../../etc/passwd",
				'      alt: "Traversal"',
				"    safe:",
				"      path: logos/safe.svg",
				'      alt: "Safe"',
			].join("\n"),
		);
		createFile(nestedSource, "logos/safe.svg", "<svg>safe</svg>");
		// Create the traversal target outside nestedSource but still within the temp dir.
		createFile(nestedSource, "../../etc/passwd", "root:x:0:0");

		const result = await useBrand(nestedSource, { projectDir });

		expect(result.success).toBe(true);
		expect(result.created).toContain("_brand.yml");
		expect(result.created).toContain("logos/safe.svg");
		// The traversal path must not appear in created files.
		expect(result.created).not.toContain("../../etc/passwd");
		// Ensure nothing was written outside _brand/.
		expect(fs.existsSync(path.join(projectDir, "etc", "passwd"))).toBe(false);
	});

	it("should report progress phases", async () => {
		createFile(sourceDir, "_brand.yml", "color:\n  background: white");

		const phases: string[] = [];
		const result = await useBrand(sourceDir, {
			projectDir,
			onProgress: ({ phase }) => {
				phases.push(phase);
			},
		});

		expect(result.success).toBe(true);
		expect(phases).toContain("detecting");
		expect(phases).toContain("copying");
	});

	it("should copy brand file from a local archive source", async () => {
		// Create a directory with brand files, then pack it into a tar.gz archive.
		const archiveContentDir = fs.mkdtempSync(path.join(os.tmpdir(), "qw-brand-archive-content-"));
		const archiveFile = path.join(sourceDir, "brand.tar.gz");

		try {
			createFile(archiveContentDir, "_brand.yml", "color:\n  background: blue");

			await tar.create(
				{
					gzip: true,
					file: archiveFile,
					cwd: path.dirname(archiveContentDir),
				},
				[path.basename(archiveContentDir)],
			);

			const result = await useBrand(archiveFile, { projectDir });

			expect(result.success).toBe(true);
			expect(result.created).toContain("_brand.yml");
			expect(fs.existsSync(path.join(projectDir, "_brand", "_brand.yml"))).toBe(true);

			const content = fs.readFileSync(path.join(projectDir, "_brand", "_brand.yml"), "utf-8");
			expect(content).toBe("color:\n  background: blue");
		} finally {
			fs.rmSync(archiveContentDir, { recursive: true, force: true });
			fs.rmSync(archiveFile, { force: true });
		}
	});
});
