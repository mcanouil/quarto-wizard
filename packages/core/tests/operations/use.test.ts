/**
 * Tests for "use extension" operations.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { getTemplateFiles, use } from "../../src/operations/use.js";

describe("getTemplateFiles", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qw-use-test-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	function createFile(relativePath: string, content = ""): void {
		const fullPath = path.join(tempDir, relativePath);
		fs.mkdirSync(path.dirname(fullPath), { recursive: true });
		fs.writeFileSync(fullPath, content);
	}

	it("should list template files from repo root excluding _extensions", async () => {
		// Create a repo structure with extension in _extensions and template files at root
		createFile("_extensions/owner/my-extension/_extension.yml", "title: Test");
		createFile("_extensions/owner/my-extension/filter.lua", "-- filter");
		createFile("template.qmd", "---\ntitle: Template\n---");
		createFile("assets/style.css", "body {}");

		// Pass repo root (tempDir) directly
		const files = await getTemplateFiles(tempDir);

		expect(files).toContain("template.qmd");
		expect(files).toContain("assets/style.css");
		// _extensions should be excluded by default
		expect(files.some((f) => f.includes("_extensions"))).toBe(false);
	});

	it("should exclude _extensions directory by default", async () => {
		createFile("_extensions/owner/ext/_extension.yml", "title: Test");
		createFile("_extensions/other/ext.yml", "title: Other");
		createFile("template.qmd", "content");

		const files = await getTemplateFiles(tempDir);

		expect(files).toContain("template.qmd");
		expect(files.some((f) => f.includes("_extensions"))).toBe(false);
	});

	it("should exclude default patterns", async () => {
		createFile("_extensions/owner/ext/_extension.yml", "title: Test");
		createFile("template.qmd", "content");
		createFile(".git/config", "git config");
		createFile(".github/workflows/ci.yml", "workflow");
		createFile(".gitignore", "*.log");
		createFile("node_modules/pkg/index.js", "module");
		createFile(".vscode/settings.json", "{}");
		createFile("debug.log", "log content");
		createFile("backup.bak", "backup");

		const files = await getTemplateFiles(tempDir);

		expect(files).toContain("template.qmd");
		expect(files.some((f) => f.startsWith(".git/"))).toBe(false);
		expect(files.some((f) => f.startsWith(".github/"))).toBe(false);
		expect(files.some((f) => f.startsWith("node_modules/"))).toBe(false);
		expect(files.some((f) => f.startsWith(".vscode/"))).toBe(false);
		expect(files.some((f) => f.endsWith(".log"))).toBe(false);
		expect(files.some((f) => f.endsWith(".bak"))).toBe(false);
	});

	it("should return empty for extension-only repository", async () => {
		// Only extension files, no template files at root
		createFile("_extensions/owner/my-extension/_extension.yml", "title: Test");
		createFile("_extensions/owner/my-extension/filter.lua", "-- filter");
		createFile("_extensions/owner/my-extension/styles.css", "body {}");

		const files = await getTemplateFiles(tempDir);

		// All files are in _extensions which is excluded
		expect(files).toHaveLength(0);
	});

	it("should support custom exclude patterns", async () => {
		createFile("_extensions/owner/ext/_extension.yml", "title: Test");
		createFile("template.qmd", "content");
		createFile("README.md", "readme");
		createFile("LICENSE", "mit");

		const files = await getTemplateFiles(tempDir, ["_extensions/**", "README.md", "LICENSE"]);

		expect(files).toContain("template.qmd");
		expect(files).not.toContain("README.md");
		expect(files).not.toContain("LICENSE");
	});
});

describe("use with targetSubdir", () => {
	let sourceDir: string;
	let projectDir: string;

	beforeEach(() => {
		sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "qw-use-source-"));
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "qw-use-project-"));
	});

	afterEach(() => {
		fs.rmSync(sourceDir, { recursive: true, force: true });
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	function createSourceFile(relativePath: string, content = ""): void {
		const fullPath = path.join(sourceDir, relativePath);
		fs.mkdirSync(path.dirname(fullPath), { recursive: true });
		fs.writeFileSync(fullPath, content);
	}

	function createProjectFile(relativePath: string, content = ""): void {
		const fullPath = path.join(projectDir, relativePath);
		fs.mkdirSync(path.dirname(fullPath), { recursive: true });
		fs.writeFileSync(fullPath, content);
	}

	it("should copy files to subdirectory when targetSubdir is provided", async () => {
		// Create source with extension and template files
		createSourceFile(
			"_extensions/owner/my-ext/_extension.yml",
			"title: Test\ncontributes:\n  shortcodes:\n    - test.lua",
		);
		createSourceFile("_extensions/owner/my-ext/test.lua", "-- test");
		createSourceFile("template.qmd", "---\ntitle: Template\n---");
		createSourceFile("assets/style.css", "body {}");

		const result = await use(
			{ type: "local", path: sourceDir },
			{
				projectDir,
				targetSubdir: "my-subdir",
				noTemplate: false,
			},
		);

		expect(result.install.success).toBe(true);
		expect(result.templateFiles).toContain("template.qmd");
		expect(result.templateFiles).toContain("assets/style.css");

		// Verify files are in subdirectory
		expect(fs.existsSync(path.join(projectDir, "my-subdir", "template.qmd"))).toBe(true);
		expect(fs.existsSync(path.join(projectDir, "my-subdir", "assets", "style.css"))).toBe(true);

		// Verify extension is at root (not in subdirectory)
		expect(fs.existsSync(path.join(projectDir, "_extensions", "owner", "my-ext", "_extension.yml"))).toBe(true);
	});

	it("should auto-create subdirectory if it does not exist", async () => {
		createSourceFile(
			"_extensions/owner/my-ext/_extension.yml",
			"title: Test\ncontributes:\n  shortcodes:\n    - test.lua",
		);
		createSourceFile("_extensions/owner/my-ext/test.lua", "-- test");
		createSourceFile("template.qmd", "content");

		const subdir = "deep/nested/path";

		const result = await use(
			{ type: "local", path: sourceDir },
			{
				projectDir,
				targetSubdir: subdir,
			},
		);

		expect(result.install.success).toBe(true);
		expect(fs.existsSync(path.join(projectDir, subdir, "template.qmd"))).toBe(true);
	});

	it("should detect existing files in target subdirectory", async () => {
		createSourceFile(
			"_extensions/owner/my-ext/_extension.yml",
			"title: Test\ncontributes:\n  shortcodes:\n    - test.lua",
		);
		createSourceFile("_extensions/owner/my-ext/test.lua", "-- test");
		createSourceFile("template.qmd", "new content");

		// Create existing file in target subdirectory
		createProjectFile("subdir/template.qmd", "existing content");

		const result = await use(
			{ type: "local", path: sourceDir },
			{
				projectDir,
				targetSubdir: "subdir",
				// No confirmOverwrite callback, so conflicts should be skipped
			},
		);

		expect(result.install.success).toBe(true);
		expect(result.skippedFiles).toContain("template.qmd");

		// Verify existing file was not overwritten
		const content = fs.readFileSync(path.join(projectDir, "subdir", "template.qmd"), "utf-8");
		expect(content).toBe("existing content");
	});

	it("should use project root when targetSubdir is empty", async () => {
		createSourceFile(
			"_extensions/owner/my-ext/_extension.yml",
			"title: Test\ncontributes:\n  shortcodes:\n    - test.lua",
		);
		createSourceFile("_extensions/owner/my-ext/test.lua", "-- test");
		createSourceFile("template.qmd", "content");

		const result = await use(
			{ type: "local", path: sourceDir },
			{
				projectDir,
				targetSubdir: "", // Empty string means project root
			},
		);

		expect(result.install.success).toBe(true);
		expect(fs.existsSync(path.join(projectDir, "template.qmd"))).toBe(true);
	});

	it("should use project root when targetSubdir is not provided", async () => {
		createSourceFile(
			"_extensions/owner/my-ext/_extension.yml",
			"title: Test\ncontributes:\n  shortcodes:\n    - test.lua",
		);
		createSourceFile("_extensions/owner/my-ext/test.lua", "-- test");
		createSourceFile("template.qmd", "content");

		const result = await use(
			{ type: "local", path: sourceDir },
			{
				projectDir,
				// No targetSubdir
			},
		);

		expect(result.install.success).toBe(true);
		expect(fs.existsSync(path.join(projectDir, "template.qmd"))).toBe(true);
	});
});
