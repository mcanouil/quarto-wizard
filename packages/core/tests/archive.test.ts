import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import archiver from "archiver";
import * as tar from "tar";
import { detectArchiveFormat, extractArchive, findExtensionRoot, cleanupExtraction } from "../src/archive/extract.js";
import { extractZip } from "../src/archive/zip.js";
import { extractTar } from "../src/archive/tar.js";
import { SecurityError } from "../src/errors.js";

/**
 * Create a ZIP archive from a source directory.
 * Cross-platform alternative to execSync('zip ...').
 */
async function createZipArchive(sourceDir: string, zipPath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const output = fs.createWriteStream(zipPath);
		const archive = archiver("zip", { zlib: { level: 9 } });

		output.on("close", () => resolve());
		archive.on("error", (err) => reject(err));

		archive.pipe(output);
		archive.directory(sourceDir, false);
		archive.finalize();
	});
}

/**
 * Create a TAR.GZ archive from a source directory.
 * Cross-platform alternative to execSync('tar ...').
 */
async function createTarArchive(sourceDir: string, tarPath: string): Promise<void> {
	await tar.create(
		{
			gzip: true,
			file: tarPath,
			cwd: sourceDir,
		},
		["."],
	);
}

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
		await fs.promises.writeFile(path.join(tempDir, "_extension.yml"), "title: Test");

		const root = await findExtensionRoot(tempDir);

		expect(root).toBe(tempDir);
	});

	it("finds manifest in subdirectory (GitHub archive style)", async () => {
		const subDir = path.join(tempDir, "repo-main");
		await fs.promises.mkdir(subDir);
		await fs.promises.writeFile(path.join(subDir, "_extension.yml"), "title: Test");

		const root = await findExtensionRoot(tempDir);

		expect(root).toBe(subDir);
	});

	it("finds manifest with .yaml extension", async () => {
		await fs.promises.writeFile(path.join(tempDir, "_extension.yaml"), "title: Test");

		const root = await findExtensionRoot(tempDir);

		expect(root).toBe(tempDir);
	});

	it("returns null when no manifest found", async () => {
		const root = await findExtensionRoot(tempDir);

		expect(root).toBeNull();
	});

	it("returns null when manifest is deeper than max depth", async () => {
		// Create a deeply nested directory structure (7 levels deep > MAX_FIND_DEPTH of 5)
		let current = tempDir;
		for (let i = 0; i < 7; i++) {
			current = path.join(current, `level${i}`);
			await fs.promises.mkdir(current);
		}
		await fs.promises.writeFile(path.join(current, "_extension.yml"), "title: Deep");

		const root = await findExtensionRoot(tempDir);

		expect(root).toBeNull();
	});

	it("finds manifest at exactly the max depth", async () => {
		// Create directory structure at depth 5 (within MAX_FIND_DEPTH)
		let current = tempDir;
		for (let i = 0; i < 4; i++) {
			current = path.join(current, `level${i}`);
			await fs.promises.mkdir(current);
		}
		await fs.promises.writeFile(path.join(current, "_extension.yml"), "title: AtLimit");

		const root = await findExtensionRoot(tempDir);

		expect(root).toBe(current);
	});
});

describe("cleanupExtraction", () => {
	it("removes extraction directory", async () => {
		const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cleanup-test-"));
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
		await fs.promises.writeFile(path.join(sourceDir, "_extension.yml"), "title: Test Extension\nversion: 1.0.0");
		await fs.promises.writeFile(path.join(sourceDir, "filter.lua"), "-- filter code");

		zipPath = path.join(tempDir, "test.zip");
		await createZipArchive(sourceDir, zipPath);
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
		await fs.promises.writeFile(path.join(sourceDir, "_extension.yml"), "title: Test Extension\nversion: 1.0.0");
		await fs.promises.writeFile(path.join(sourceDir, "filter.lua"), "-- filter code");

		tarPath = path.join(tempDir, "test.tar.gz");
		await createTarArchive(sourceDir, tarPath);
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

	it("reports progress", async () => {
		const destDir = path.join(tempDir, "dest");
		const progressFiles: string[] = [];

		await extractTar(tarPath, destDir, {
			onProgress: (file) => progressFiles.push(file),
		});

		expect(progressFiles.length).toBeGreaterThan(0);
	});
});

describe("extractArchive", () => {
	let tempDir: string;
	let zipPath: string;

	beforeEach(async () => {
		tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "extract-test-"));

		const sourceDir = path.join(tempDir, "source");
		await fs.promises.mkdir(sourceDir);
		await fs.promises.writeFile(path.join(sourceDir, "_extension.yml"), "title: Test");

		zipPath = path.join(tempDir, "test.zip");
		await createZipArchive(sourceDir, zipPath);
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
		await createZipArchive(sourceDir, zipPath);

		const destDir = path.join(tempDir, "dest");

		await expect(extractZip(zipPath, destDir, { maxSize: 100 })).rejects.toThrow(SecurityError);
	});
});
