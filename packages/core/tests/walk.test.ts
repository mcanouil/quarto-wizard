import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { walkDirectory, collectFiles, copyDirectory } from "../src/filesystem/walk.js";

describe("walk.ts", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "walk-test-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	describe("walkDirectory", () => {
		it("walks all files and directories", async () => {
			// Create test structure
			fs.mkdirSync(path.join(tempDir, "subdir"));
			fs.writeFileSync(path.join(tempDir, "file1.txt"), "content1");
			fs.writeFileSync(path.join(tempDir, "subdir", "file2.txt"), "content2");

			const entries: string[] = [];
			await walkDirectory(tempDir, (entry) => {
				entries.push(entry.name);
			});

			expect(entries).toContain("file1.txt");
			expect(entries).toContain("subdir");
			expect(entries).toContain("file2.txt");
		});

		it("provides correct isDirectory flag", async () => {
			fs.mkdirSync(path.join(tempDir, "dir"));
			fs.writeFileSync(path.join(tempDir, "file.txt"), "content");

			const dirs: string[] = [];
			const files: string[] = [];

			await walkDirectory(tempDir, (entry) => {
				if (entry.isDirectory) {
					dirs.push(entry.name);
				} else {
					files.push(entry.name);
				}
			});

			expect(dirs).toEqual(["dir"]);
			expect(files).toEqual(["file.txt"]);
		});

		it("skips subdirectory when callback returns false", async () => {
			fs.mkdirSync(path.join(tempDir, "skip"));
			fs.mkdirSync(path.join(tempDir, "include"));
			fs.writeFileSync(path.join(tempDir, "skip", "skipped.txt"), "skip");
			fs.writeFileSync(path.join(tempDir, "include", "included.txt"), "include");

			const entries: string[] = [];
			await walkDirectory(tempDir, (entry) => {
				entries.push(entry.name);
				// Skip the "skip" directory
				if (entry.name === "skip") {
					return false;
				}
			});

			expect(entries).toContain("skip");
			expect(entries).toContain("include");
			expect(entries).toContain("included.txt");
			expect(entries).not.toContain("skipped.txt");
		});

		it("handles async callbacks", async () => {
			fs.writeFileSync(path.join(tempDir, "file.txt"), "content");

			const entries: string[] = [];
			await walkDirectory(tempDir, async (entry) => {
				await new Promise((resolve) => setTimeout(resolve, 1));
				entries.push(entry.name);
			});

			expect(entries).toContain("file.txt");
		});

		it("provides full path", async () => {
			fs.writeFileSync(path.join(tempDir, "file.txt"), "content");

			let fullPath: string | undefined;
			await walkDirectory(tempDir, (entry) => {
				if (entry.name === "file.txt") {
					fullPath = entry.path;
				}
			});

			expect(fullPath).toBe(path.join(tempDir, "file.txt"));
		});
	});

	describe("collectFiles", () => {
		it("collects all files recursively", async () => {
			fs.mkdirSync(path.join(tempDir, "dir1"));
			fs.mkdirSync(path.join(tempDir, "dir1", "dir2"));
			fs.writeFileSync(path.join(tempDir, "root.txt"), "root");
			fs.writeFileSync(path.join(tempDir, "dir1", "level1.txt"), "level1");
			fs.writeFileSync(path.join(tempDir, "dir1", "dir2", "level2.txt"), "level2");

			const files = await collectFiles(tempDir);

			expect(files).toHaveLength(3);
			expect(files).toContain(path.join(tempDir, "root.txt"));
			expect(files).toContain(path.join(tempDir, "dir1", "level1.txt"));
			expect(files).toContain(path.join(tempDir, "dir1", "dir2", "level2.txt"));
		});

		it("excludes directories from result", async () => {
			fs.mkdirSync(path.join(tempDir, "dir"));
			fs.writeFileSync(path.join(tempDir, "file.txt"), "content");

			const files = await collectFiles(tempDir);

			expect(files).toHaveLength(1);
			expect(files[0]).toContain("file.txt");
		});

		it("returns empty array for empty directory", async () => {
			const files = await collectFiles(tempDir);

			expect(files).toEqual([]);
		});
	});

	describe("copyDirectory", () => {
		it("copies all files to target directory", async () => {
			const targetDir = path.join(tempDir, "target");
			const sourceDir = path.join(tempDir, "source");

			fs.mkdirSync(sourceDir);
			fs.writeFileSync(path.join(sourceDir, "file1.txt"), "content1");
			fs.writeFileSync(path.join(sourceDir, "file2.txt"), "content2");

			const created = await copyDirectory(sourceDir, targetDir);

			expect(created).toHaveLength(2);
			expect(fs.existsSync(path.join(targetDir, "file1.txt"))).toBe(true);
			expect(fs.existsSync(path.join(targetDir, "file2.txt"))).toBe(true);
			expect(fs.readFileSync(path.join(targetDir, "file1.txt"), "utf-8")).toBe("content1");
		});

		it("copies nested directories", async () => {
			const targetDir = path.join(tempDir, "target");
			const sourceDir = path.join(tempDir, "source");

			fs.mkdirSync(sourceDir);
			fs.mkdirSync(path.join(sourceDir, "nested"));
			fs.writeFileSync(path.join(sourceDir, "root.txt"), "root");
			fs.writeFileSync(path.join(sourceDir, "nested", "deep.txt"), "deep");

			const created = await copyDirectory(sourceDir, targetDir);

			expect(created).toHaveLength(2);
			expect(fs.existsSync(path.join(targetDir, "root.txt"))).toBe(true);
			expect(fs.existsSync(path.join(targetDir, "nested", "deep.txt"))).toBe(true);
		});

		it("creates target directory if it doesn't exist", async () => {
			const targetDir = path.join(tempDir, "new", "nested", "target");
			const sourceDir = path.join(tempDir, "source");

			fs.mkdirSync(sourceDir);
			fs.writeFileSync(path.join(sourceDir, "file.txt"), "content");

			await copyDirectory(sourceDir, targetDir);

			expect(fs.existsSync(targetDir)).toBe(true);
			expect(fs.existsSync(path.join(targetDir, "file.txt"))).toBe(true);
		});

		it("returns list of created file paths", async () => {
			const targetDir = path.join(tempDir, "target");
			const sourceDir = path.join(tempDir, "source");

			fs.mkdirSync(sourceDir);
			fs.writeFileSync(path.join(sourceDir, "file.txt"), "content");

			const created = await copyDirectory(sourceDir, targetDir);

			expect(created).toEqual([path.join(targetDir, "file.txt")]);
		});
	});
});
