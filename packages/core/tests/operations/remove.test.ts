/**
 * Tests for extension removal operations.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { remove, removeMultiple } from "../../src/operations/remove.js";

describe("remove", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qw-remove-test-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	function setupExtension(owner: string, name: string): string {
		const extDir = path.join(tempDir, "_extensions", owner, name);
		fs.mkdirSync(extDir, { recursive: true });
		fs.writeFileSync(path.join(extDir, "_extension.yml"), `title: ${name}\nversion: 1.0.0\n`);
		fs.writeFileSync(path.join(extDir, "filter.lua"), "-- filter");
		return extDir;
	}

	it("should remove an installed extension", async () => {
		setupExtension("quarto-ext", "fontawesome");

		const result = await remove({ owner: "quarto-ext", name: "fontawesome" }, { projectDir: tempDir });

		expect(result.success).toBe(true);
		expect(result.extension.id.owner).toBe("quarto-ext");
		expect(result.extension.id.name).toBe("fontawesome");
		expect(result.filesRemoved.length).toBeGreaterThan(0);

		const extDir = path.join(tempDir, "_extensions", "quarto-ext", "fontawesome");
		expect(fs.existsSync(extDir)).toBe(false);
	});

	it("should clean up empty owner directory", async () => {
		setupExtension("single-owner", "only-ext");

		await remove({ owner: "single-owner", name: "only-ext" }, { projectDir: tempDir, cleanupEmpty: true });

		const ownerDir = path.join(tempDir, "_extensions", "single-owner");
		expect(fs.existsSync(ownerDir)).toBe(false);
	});

	it("should not clean up non-empty owner directory", async () => {
		setupExtension("multi-owner", "ext1");
		setupExtension("multi-owner", "ext2");

		await remove({ owner: "multi-owner", name: "ext1" }, { projectDir: tempDir, cleanupEmpty: true });

		const ownerDir = path.join(tempDir, "_extensions", "multi-owner");
		expect(fs.existsSync(ownerDir)).toBe(true);

		const ext2Dir = path.join(ownerDir, "ext2");
		expect(fs.existsSync(ext2Dir)).toBe(true);
	});

	it("should throw for non-existent extension", async () => {
		await expect(remove({ owner: "nonexistent", name: "extension" }, { projectDir: tempDir })).rejects.toThrow(
			/Extension not found/
		);
	});

	it("should respect cleanupEmpty = false", async () => {
		setupExtension("owner", "ext");

		await remove({ owner: "owner", name: "ext" }, { projectDir: tempDir, cleanupEmpty: false });

		const ownerDir = path.join(tempDir, "_extensions", "owner");
		expect(fs.existsSync(ownerDir)).toBe(true);
	});

	it("should remove an extension without owner", async () => {
		// Setup extension directly under _extensions/name (no owner)
		const extDir = path.join(tempDir, "_extensions", "standalone-ext");
		fs.mkdirSync(extDir, { recursive: true });
		fs.writeFileSync(path.join(extDir, "_extension.yml"), "title: standalone\nversion: 1.0.0\n");
		fs.writeFileSync(path.join(extDir, "filter.lua"), "-- filter");

		const result = await remove({ owner: null, name: "standalone-ext" }, { projectDir: tempDir });

		expect(result.success).toBe(true);
		expect(result.extension.id.name).toBe("standalone-ext");
		expect(result.extension.id.owner).toBeNull();
		expect(fs.existsSync(extDir)).toBe(false);
	});
});

describe("removeMultiple", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qw-remove-multi-test-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	function setupExtension(owner: string, name: string): void {
		const extDir = path.join(tempDir, "_extensions", owner, name);
		fs.mkdirSync(extDir, { recursive: true });
		fs.writeFileSync(path.join(extDir, "_extension.yml"), `title: ${name}\nversion: 1.0.0\n`);
	}

	it("should remove multiple extensions", async () => {
		setupExtension("quarto-ext", "fontawesome");
		setupExtension("quarto-ext", "lightbox");
		setupExtension("other", "extension");

		const results = await removeMultiple(
			[
				{ owner: "quarto-ext", name: "fontawesome" },
				{ owner: "quarto-ext", name: "lightbox" },
			],
			{ projectDir: tempDir }
		);

		expect(results).toHaveLength(2);
		expect(results.every((r) => "success" in r && r.success)).toBe(true);

		expect(fs.existsSync(path.join(tempDir, "_extensions", "quarto-ext", "fontawesome"))).toBe(false);
		expect(fs.existsSync(path.join(tempDir, "_extensions", "quarto-ext", "lightbox"))).toBe(false);
		expect(fs.existsSync(path.join(tempDir, "_extensions", "other", "extension"))).toBe(true);
	});

	it("should handle partial failures", async () => {
		setupExtension("quarto-ext", "fontawesome");

		const results = await removeMultiple(
			[
				{ owner: "quarto-ext", name: "fontawesome" },
				{ owner: "nonexistent", name: "extension" },
			],
			{ projectDir: tempDir }
		);

		expect(results).toHaveLength(2);
		expect("success" in results[0] && results[0].success).toBe(true);
		expect("error" in results[1]).toBe(true);
	});

	it("should return empty array for empty input", async () => {
		const results = await removeMultiple([], { projectDir: tempDir });
		expect(results).toHaveLength(0);
	});
});
