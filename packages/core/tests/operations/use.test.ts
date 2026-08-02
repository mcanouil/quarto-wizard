/**
 * Tests for "use extension" operations.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as tar from "tar";
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

describe("use honouring .quartoignore", () => {
	let sourceDir: string;
	let projectDir: string;

	beforeEach(() => {
		sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "qw-use-ignore-source-"));
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "qw-use-ignore-project-"));
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

	function createTemplateSource(): void {
		createSourceFile(
			"_extensions/owner/my-ext/_extension.yml",
			"title: Test\ncontributes:\n  shortcodes:\n    - test.lua",
		);
		createSourceFile("_extensions/owner/my-ext/test.lua", "-- test");
		createSourceFile("template.qmd", "---\ntitle: Template\n---");
		createSourceFile("scratch/notes.md", "notes");
		createSourceFile("scratch/nested/deep.md", "deep");
	}

	it("leaves .quartoignore matches unselected but still offered", async () => {
		createTemplateSource();
		createSourceFile(".quartoignore", "# working notes\nscratch\n");

		let offeredFiles: string[] = [];
		let unselectedPatterns: string[] = [];

		const result = await use(
			{ type: "local", path: sourceDir },
			{
				projectDir,
				selectFiles: async (availableFiles, _existingFiles, defaultExcludePatterns) => {
					offeredFiles = availableFiles;
					unselectedPatterns = defaultExcludePatterns;
					// The UI would drop the unselected ones; copy everything to prove they are
					// still selectable rather than removed from the list.
					return { selectedFiles: availableFiles, overwriteExisting: false };
				},
			},
		);

		expect(result.install.success).toBe(true);
		// Still offered, so the user can tick them back on.
		expect(offeredFiles).toContain("scratch/notes.md");
		expect(offeredFiles).toContain("template.qmd");
		// And they start unticked.
		expect(unselectedPatterns).toContain("scratch");
		expect(unselectedPatterns).toContain("scratch/**");
		// Selecting them anyway copies them.
		expect(fs.existsSync(path.join(projectDir, "scratch", "notes.md"))).toBe(true);
	});

	it("does not add unselected patterns when there is no .quartoignore", async () => {
		createTemplateSource();

		let unselectedPatterns: string[] = [];

		await use(
			{ type: "local", path: sourceDir },
			{
				projectDir,
				selectFiles: async (availableFiles, _existingFiles, defaultExcludePatterns) => {
					unselectedPatterns = defaultExcludePatterns;
					return { selectedFiles: availableFiles, overwriteExisting: false };
				},
			},
		);

		expect(unselectedPatterns).not.toContain("scratch");
		// The built-in defaults are still there, minus the extension directory.
		expect(unselectedPatterns).toContain("README.md");
		expect(unselectedPatterns).not.toContain("_extensions/**");
	});

	it("excludes .quartoignore matches outright when there is no selection UI", async () => {
		createTemplateSource();
		createSourceFile(".quartoignore", "scratch\n");

		const result = await use({ type: "local", path: sourceDir }, { projectDir });

		expect(result.install.success).toBe(true);
		expect(result.templateFiles).toContain("template.qmd");
		expect(result.templateFiles.some((file) => file.startsWith("scratch/"))).toBe(false);
		expect(fs.existsSync(path.join(projectDir, "scratch"))).toBe(false);
	});
});

describe("use with an extension at the source root", () => {
	let sourceDir: string;
	let projectDir: string;

	beforeEach(() => {
		sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "qw-use-flat-source-"));
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "qw-use-flat-project-"));
	});

	afterEach(() => {
		fs.rmSync(sourceDir, { recursive: true, force: true });
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it("copies template files from the source root, not from its parent", async () => {
		// A repository that is itself an extension: the manifest sits at the top level
		// instead of under `_extensions/`.
		fs.writeFileSync(
			path.join(sourceDir, "_extension.yml"),
			"title: Flat\ncontributes:\n  shortcodes:\n    - flat.lua",
		);
		fs.writeFileSync(path.join(sourceDir, "flat.lua"), "-- flat");
		fs.writeFileSync(path.join(sourceDir, "template.qmd"), "---\ntitle: Template\n---");

		const result = await use({ type: "local", path: sourceDir }, { projectDir });

		expect(result.install.success).toBe(true);
		expect(result.templateFiles).toContain("template.qmd");
		expect(fs.existsSync(path.join(projectDir, "template.qmd"))).toBe(true);
	});
});

describe("use with a local directory source", () => {
	let sourceDir: string;
	let projectDir: string;

	beforeEach(() => {
		sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "qw-use-keep-source-"));
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "qw-use-keep-project-"));
	});

	afterEach(() => {
		fs.rmSync(sourceDir, { recursive: true, force: true });
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it("leaves the source directory on disk", async () => {
		const extDir = path.join(sourceDir, "_extensions", "owner", "my-ext");
		fs.mkdirSync(extDir, { recursive: true });
		fs.writeFileSync(path.join(extDir, "_extension.yml"), "title: Test\ncontributes:\n  shortcodes:\n    - test.lua");
		fs.writeFileSync(path.join(extDir, "test.lua"), "-- test");
		fs.writeFileSync(path.join(sourceDir, "template.qmd"), "---\ntitle: Template\n---");

		const result = await use({ type: "local", path: sourceDir }, { projectDir });

		expect(result.install.success).toBe(true);
		// A local source is the user's own directory: using it as a template must not consume it.
		expect(fs.existsSync(sourceDir)).toBe(true);
		expect(fs.existsSync(path.join(sourceDir, "template.qmd"))).toBe(true);
	});
});

describe("use with a local archive source", () => {
	let sourceDir: string;
	let projectDir: string;

	beforeEach(() => {
		sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "qw-use-archive-source-"));
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "qw-use-archive-project-"));
	});

	afterEach(() => {
		fs.rmSync(sourceDir, { recursive: true, force: true });
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	function listExtractionDirs(): string[] {
		return fs.readdirSync(os.tmpdir()).filter((entry) => entry.startsWith("quarto-ext-"));
	}

	it("removes the temporary extraction directory", async () => {
		const contents = path.join(sourceDir, "contents");
		const extDir = path.join(contents, "_extensions", "owner", "my-ext");
		fs.mkdirSync(extDir, { recursive: true });
		fs.writeFileSync(path.join(extDir, "_extension.yml"), "title: Test\ncontributes:\n  shortcodes:\n    - test.lua");
		fs.writeFileSync(path.join(extDir, "test.lua"), "-- test");
		fs.writeFileSync(path.join(contents, "template.qmd"), "---\ntitle: Template\n---");

		// Archive the wrapper directory itself, the way a GitHub source archive is shaped.
		const archivePath = path.join(sourceDir, "source.tar.gz");
		await tar.create({ gzip: true, file: archivePath, cwd: sourceDir }, ["contents"]);

		const before = listExtractionDirs();

		const result = await use({ type: "local", path: archivePath }, { projectDir });

		expect(result.install.success).toBe(true);
		expect(result.templateFiles).toContain("template.qmd");
		expect(listExtractionDirs()).toEqual(before);
	});
});
