import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import {
  detectArchiveFormat,
  extractArchive,
  findExtensionRoot,
  cleanupExtraction,
} from "../src/archive/extract.js";
import { extractZip } from "../src/archive/zip.js";
import { extractTar } from "../src/archive/tar.js";
import { SecurityError } from "../src/errors.js";

describe("detectArchiveFormat", () => {
  it("detects zip format", () => {
    expect(detectArchiveFormat("file.zip")).toBe("zip");
    expect(detectArchiveFormat("FILE.ZIP")).toBe("zip");
  });

  it("detects tarball formats", () => {
    expect(detectArchiveFormat("file.tar.gz")).toBe("tarball");
    expect(detectArchiveFormat("file.tgz")).toBe("tarball");
    expect(detectArchiveFormat("file.tar")).toBe("tarball");
  });

  it("returns null for unknown formats", () => {
    expect(detectArchiveFormat("file.txt")).toBeNull();
    expect(detectArchiveFormat("file.rar")).toBeNull();
  });
});

describe("findExtensionRoot", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ext-root-test-"));
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it("finds manifest in root directory", async () => {
    await fs.promises.writeFile(
      path.join(tempDir, "_extension.yml"),
      "title: Test"
    );

    const root = await findExtensionRoot(tempDir);

    expect(root).toBe(tempDir);
  });

  it("finds manifest in subdirectory (GitHub archive style)", async () => {
    const subDir = path.join(tempDir, "repo-main");
    await fs.promises.mkdir(subDir);
    await fs.promises.writeFile(
      path.join(subDir, "_extension.yml"),
      "title: Test"
    );

    const root = await findExtensionRoot(tempDir);

    expect(root).toBe(subDir);
  });

  it("finds manifest with .yaml extension", async () => {
    await fs.promises.writeFile(
      path.join(tempDir, "_extension.yaml"),
      "title: Test"
    );

    const root = await findExtensionRoot(tempDir);

    expect(root).toBe(tempDir);
  });

  it("returns null when no manifest found", async () => {
    const root = await findExtensionRoot(tempDir);

    expect(root).toBeNull();
  });
});

describe("cleanupExtraction", () => {
  it("removes extraction directory", async () => {
    const tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "cleanup-test-")
    );
    expect(fs.existsSync(tempDir)).toBe(true);

    await cleanupExtraction(tempDir);

    expect(fs.existsSync(tempDir)).toBe(false);
  });

  it("does not throw for non-existent directory", async () => {
    await expect(cleanupExtraction("/non/existent/path")).resolves.not.toThrow();
  });
});

describe("ZIP extraction", () => {
  let tempDir: string;
  let zipPath: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "zip-test-"));

    const sourceDir = path.join(tempDir, "source");
    await fs.promises.mkdir(sourceDir);
    await fs.promises.writeFile(
      path.join(sourceDir, "_extension.yml"),
      "title: Test Extension\nversion: 1.0.0"
    );
    await fs.promises.writeFile(
      path.join(sourceDir, "filter.lua"),
      "-- filter code"
    );

    zipPath = path.join(tempDir, "test.zip");
    execSync(`cd "${sourceDir}" && zip -r "${zipPath}" .`);
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it("extracts zip archive", async () => {
    const destDir = path.join(tempDir, "dest");

    const files = await extractZip(zipPath, destDir);

    expect(files.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(destDir, "_extension.yml"))).toBe(true);
  });

  it("reports progress", async () => {
    const destDir = path.join(tempDir, "dest");
    const progressFiles: string[] = [];

    await extractZip(zipPath, destDir, {
      onProgress: (file) => progressFiles.push(file),
    });

    expect(progressFiles.length).toBeGreaterThan(0);
  });
});

describe("TAR extraction", () => {
  let tempDir: string;
  let tarPath: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tar-test-"));

    const sourceDir = path.join(tempDir, "source");
    await fs.promises.mkdir(sourceDir);
    await fs.promises.writeFile(
      path.join(sourceDir, "_extension.yml"),
      "title: Test Extension\nversion: 1.0.0"
    );
    await fs.promises.writeFile(
      path.join(sourceDir, "filter.lua"),
      "-- filter code"
    );

    tarPath = path.join(tempDir, "test.tar.gz");
    execSync(`tar -czf "${tarPath}" -C "${sourceDir}" .`);
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it("extracts tar.gz archive", async () => {
    const destDir = path.join(tempDir, "dest");

    const files = await extractTar(tarPath, destDir);

    expect(files.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(destDir, "_extension.yml"))).toBe(true);
  });
});

describe("extractArchive", () => {
  let tempDir: string;
  let zipPath: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "extract-test-"));

    const sourceDir = path.join(tempDir, "source");
    await fs.promises.mkdir(sourceDir);
    await fs.promises.writeFile(
      path.join(sourceDir, "_extension.yml"),
      "title: Test"
    );

    zipPath = path.join(tempDir, "test.zip");
    execSync(`cd "${sourceDir}" && zip -r "${zipPath}" .`);
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it("extracts and detects format", async () => {
    const result = await extractArchive(zipPath);

    try {
      expect(result.format).toBe("zip");
      expect(result.files.length).toBeGreaterThan(0);
      expect(fs.existsSync(result.extractDir)).toBe(true);
    } finally {
      await cleanupExtraction(result.extractDir);
    }
  });
});

describe("security checks", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "security-test-"));
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it("rejects archives exceeding max size", async () => {
    const largeContent = "x".repeat(1024);
    const sourceDir = path.join(tempDir, "source");
    await fs.promises.mkdir(sourceDir);
    await fs.promises.writeFile(path.join(sourceDir, "large.txt"), largeContent);

    const zipPath = path.join(tempDir, "large.zip");
    execSync(`cd "${sourceDir}" && zip -r "${zipPath}" .`);

    const destDir = path.join(tempDir, "dest");

    await expect(
      extractZip(zipPath, destDir, { maxSize: 100 })
    ).rejects.toThrow(SecurityError);
  });
});
