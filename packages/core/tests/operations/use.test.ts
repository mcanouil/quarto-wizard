/**
 * Tests for "use extension" operations.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { getTemplateFiles } from "../../src/operations/use.js";

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

  it("should list template files excluding extension directory", async () => {
    createFile("my-extension/_extension.yml", "title: Test");
    createFile("my-extension/filter.lua", "-- filter");
    createFile("template.qmd", "---\ntitle: Template\n---");
    createFile("assets/style.css", "body {}");

    const extensionDir = path.join(tempDir, "my-extension");
    const files = await getTemplateFiles(extensionDir);

    expect(files).toContain("template.qmd");
    expect(files).toContain("assets/style.css");
    expect(files).not.toContain("my-extension/_extension.yml");
    expect(files).not.toContain("my-extension/filter.lua");
  });

  it("should exclude _extensions directory", async () => {
    createFile("my-extension/_extension.yml", "title: Test");
    createFile("_extensions/other/ext.yml", "title: Other");
    createFile("template.qmd", "content");

    const extensionDir = path.join(tempDir, "my-extension");
    const files = await getTemplateFiles(extensionDir);

    expect(files).toContain("template.qmd");
    expect(files.some((f) => f.includes("_extensions"))).toBe(false);
  });

  it("should exclude default patterns", async () => {
    createFile("my-extension/_extension.yml", "title: Test");
    createFile("template.qmd", "content");
    createFile(".git/config", "git config");
    createFile(".github/workflows/ci.yml", "workflow");
    createFile(".gitignore", "*.log");
    createFile("node_modules/pkg/index.js", "module");
    createFile(".vscode/settings.json", "{}");
    createFile("debug.log", "log content");
    createFile("backup.bak", "backup");

    const extensionDir = path.join(tempDir, "my-extension");
    const files = await getTemplateFiles(extensionDir);

    expect(files).toContain("template.qmd");
    expect(files.some((f) => f.startsWith(".git/"))).toBe(false);
    expect(files.some((f) => f.startsWith(".github/"))).toBe(false);
    expect(files.some((f) => f.startsWith("node_modules/"))).toBe(false);
    expect(files.some((f) => f.startsWith(".vscode/"))).toBe(false);
    expect(files.some((f) => f.endsWith(".log"))).toBe(false);
    expect(files.some((f) => f.endsWith(".bak"))).toBe(false);
  });

  it("should return empty for extension-only repository", async () => {
    createFile("my-extension/_extension.yml", "title: Test");
    createFile("my-extension/filter.lua", "-- filter");
    createFile("my-extension/styles.css", "body {}");

    const extensionDir = path.join(tempDir, "my-extension");
    const files = await getTemplateFiles(extensionDir);

    expect(files).toHaveLength(0);
  });

  it("should support custom exclude patterns", async () => {
    createFile("my-extension/_extension.yml", "title: Test");
    createFile("template.qmd", "content");
    createFile("README.md", "readme");
    createFile("LICENSE", "mit");

    const extensionDir = path.join(tempDir, "my-extension");
    const files = await getTemplateFiles(extensionDir, [
      "_extensions/**",
      "README.md",
      "LICENSE",
    ]);

    expect(files).toContain("template.qmd");
    expect(files).not.toContain("README.md");
    expect(files).not.toContain("LICENSE");
  });
});
