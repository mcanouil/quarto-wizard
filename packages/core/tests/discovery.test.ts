import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
	discoverInstalledExtensions,
	discoverInstalledExtensionsSync,
	findInstalledExtension,
	getExtensionsDir,
	hasExtensionsDir,
} from "../src/filesystem/discovery.js";

describe("discovery.ts", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "discovery-test-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	function createExtension(owner: string | null, name: string, manifest: string): string {
		const extensionsDir = path.join(tempDir, "_extensions");
		let extPath: string;

		if (owner) {
			extPath = path.join(extensionsDir, owner, name);
		} else {
			extPath = path.join(extensionsDir, name);
		}

		fs.mkdirSync(extPath, { recursive: true });
		fs.writeFileSync(path.join(extPath, "_extension.yml"), manifest);

		return extPath;
	}

	describe("getExtensionsDir", () => {
		it("returns path to _extensions directory", () => {
			const result = getExtensionsDir(tempDir);
			expect(result).toBe(path.join(tempDir, "_extensions"));
		});
	});

	describe("hasExtensionsDir", () => {
		it("returns false when no _extensions directory", () => {
			expect(hasExtensionsDir(tempDir)).toBe(false);
		});

		it("returns true when _extensions directory exists", () => {
			fs.mkdirSync(path.join(tempDir, "_extensions"));
			expect(hasExtensionsDir(tempDir)).toBe(true);
		});

		it("returns false when _extensions is a file", () => {
			fs.writeFileSync(path.join(tempDir, "_extensions"), "not a directory");
			expect(hasExtensionsDir(tempDir)).toBe(false);
		});
	});

	describe("discoverInstalledExtensions (async)", () => {
		it("returns empty array when no _extensions directory", async () => {
			const extensions = await discoverInstalledExtensions(tempDir);
			expect(extensions).toEqual([]);
		});

		it("discovers extension with owner", async () => {
			createExtension("quarto-ext", "lightbox", "title: Lightbox\nversion: 1.0.0\n");

			const extensions = await discoverInstalledExtensions(tempDir);

			expect(extensions).toHaveLength(1);
			expect(extensions[0].id.owner).toBe("quarto-ext");
			expect(extensions[0].id.name).toBe("lightbox");
			expect(extensions[0].manifest.title).toBe("Lightbox");
		});

		it("discovers extension without owner", async () => {
			createExtension(null, "myext", "title: My Extension\nversion: 2.0.0\n");

			const extensions = await discoverInstalledExtensions(tempDir);

			expect(extensions).toHaveLength(1);
			expect(extensions[0].id.owner).toBeNull();
			expect(extensions[0].id.name).toBe("myext");
		});

		it("discovers multiple extensions", async () => {
			createExtension("owner1", "ext1", "title: Ext1\n");
			createExtension("owner2", "ext2", "title: Ext2\n");
			createExtension(null, "ext3", "title: Ext3\n");

			const extensions = await discoverInstalledExtensions(tempDir);

			expect(extensions).toHaveLength(3);
		});

		it("includes invalid extensions when includeInvalid is true", async () => {
			const extensionsDir = path.join(tempDir, "_extensions", "owner", "broken");
			fs.mkdirSync(extensionsDir, { recursive: true });
			// No manifest file

			const extensions = await discoverInstalledExtensions(tempDir, { includeInvalid: true });

			expect(extensions).toHaveLength(1);
			expect(extensions[0].id.name).toBe("broken");
		});

		it("excludes invalid extensions by default", async () => {
			const extensionsDir = path.join(tempDir, "_extensions", "owner", "broken");
			fs.mkdirSync(extensionsDir, { recursive: true });
			// No manifest file

			const extensions = await discoverInstalledExtensions(tempDir);

			expect(extensions).toHaveLength(0);
		});

		it("skips non-directory entries", async () => {
			const extensionsDir = path.join(tempDir, "_extensions");
			fs.mkdirSync(extensionsDir);
			fs.writeFileSync(path.join(extensionsDir, "somefile.txt"), "not a directory");

			createExtension("owner", "ext", "title: Test\n");

			const extensions = await discoverInstalledExtensions(tempDir);

			expect(extensions).toHaveLength(1);
		});
	});

	describe("discoverInstalledExtensionsSync", () => {
		it("returns empty array when no _extensions directory", () => {
			const extensions = discoverInstalledExtensionsSync(tempDir);
			expect(extensions).toEqual([]);
		});

		it("discovers extension with owner", () => {
			createExtension("quarto-ext", "lightbox", "title: Lightbox\nversion: 1.0.0\n");

			const extensions = discoverInstalledExtensionsSync(tempDir);

			expect(extensions).toHaveLength(1);
			expect(extensions[0].id.owner).toBe("quarto-ext");
			expect(extensions[0].id.name).toBe("lightbox");
		});

		it("discovers extension without owner", () => {
			createExtension(null, "myext", "title: My Extension\n");

			const extensions = discoverInstalledExtensionsSync(tempDir);

			expect(extensions).toHaveLength(1);
			expect(extensions[0].id.owner).toBeNull();
			expect(extensions[0].id.name).toBe("myext");
		});

		it("includes invalid extensions when includeInvalid is true", () => {
			const extensionsDir = path.join(tempDir, "_extensions", "owner", "broken");
			fs.mkdirSync(extensionsDir, { recursive: true });

			const extensions = discoverInstalledExtensionsSync(tempDir, { includeInvalid: true });

			expect(extensions).toHaveLength(1);
		});

		it("handles errors gracefully by returning empty array", () => {
			// Create a structure that might cause errors
			const extensionsDir = path.join(tempDir, "_extensions");
			fs.mkdirSync(extensionsDir);

			// This should not throw
			const extensions = discoverInstalledExtensionsSync(tempDir);
			expect(extensions).toEqual([]);
		});
	});

	describe("findInstalledExtension (async)", () => {
		it("finds extension by id", async () => {
			createExtension("quarto-ext", "lightbox", "title: Lightbox\nversion: 1.0.0\n");

			const ext = await findInstalledExtension(tempDir, { owner: "quarto-ext", name: "lightbox" });

			expect(ext).not.toBeNull();
			expect(ext!.manifest.title).toBe("Lightbox");
		});

		it("returns null for non-existent extension", async () => {
			const ext = await findInstalledExtension(tempDir, { owner: "none", name: "none" });

			expect(ext).toBeNull();
		});

		it("finds extension without owner", async () => {
			createExtension(null, "myext", "title: My Ext\n");

			const ext = await findInstalledExtension(tempDir, { owner: null, name: "myext" });

			expect(ext).not.toBeNull();
			expect(ext!.id.owner).toBeNull();
		});
	});
});
