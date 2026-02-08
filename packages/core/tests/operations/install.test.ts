/**
 * Tests for extension installation operations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parseInstallSource, formatInstallSource, type InstallSource } from "../../src/operations/install.js";
// Internal exports for testing only
import { resolveExtensionId } from "../../src/operations/internal.js";

describe("parseInstallSource", () => {
	describe("GitHub sources", () => {
		it("should parse owner/repo format", () => {
			const result = parseInstallSource("quarto-ext/fontawesome");
			expect(result).toEqual({
				type: "github",
				owner: "quarto-ext",
				repo: "fontawesome",
				version: { type: "latest" },
			});
		});

		it("should parse owner/repo@tag format", () => {
			const result = parseInstallSource("quarto-ext/fontawesome@v1.0.0");
			expect(result).toEqual({
				type: "github",
				owner: "quarto-ext",
				repo: "fontawesome",
				version: { type: "tag", tag: "v1.0.0" },
			});
		});

		it("should parse owner/repo@branch format", () => {
			const result = parseInstallSource("quarto-ext/fontawesome@main");
			expect(result).toEqual({
				type: "github",
				owner: "quarto-ext",
				repo: "fontawesome",
				version: { type: "branch", branch: "main" },
			});
		});

		it("should throw for invalid format without owner", () => {
			expect(() => parseInstallSource("fontawesome")).toThrow(/Invalid extension reference/);
		});
	});

	describe("URL sources", () => {
		it("should parse https URL", () => {
			const result = parseInstallSource("https://github.com/quarto-ext/fontawesome/archive/main.zip");
			expect(result).toEqual({
				type: "url",
				url: "https://github.com/quarto-ext/fontawesome/archive/main.zip",
			});
		});

		it("should parse http URL", () => {
			const result = parseInstallSource("http://example.com/extension.zip");
			expect(result).toEqual({
				type: "url",
				url: "http://example.com/extension.zip",
			});
		});
	});

	describe("local sources", () => {
		it("should parse absolute path", () => {
			const result = parseInstallSource("/path/to/extension");
			expect(result).toEqual({
				type: "local",
				path: "/path/to/extension",
			});
		});

		it("should parse relative path starting with ./", () => {
			const result = parseInstallSource("./my-extension");
			expect(result).toEqual({
				type: "local",
				path: "./my-extension",
			});
		});

		it("should parse relative path starting with ../", () => {
			const result = parseInstallSource("../parent-extension");
			expect(result).toEqual({
				type: "local",
				path: "../parent-extension",
			});
		});

		it("should detect existing path as local", () => {
			const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qw-test-"));
			try {
				const result = parseInstallSource(tempDir);
				expect(result).toEqual({
					type: "local",
					path: tempDir,
				});
			} finally {
				fs.rmSync(tempDir, { recursive: true, force: true });
			}
		});

		it("should parse file:// URL with absolute path", () => {
			const result = parseInstallSource("file:///path/to/extension");
			expect(result).toEqual({
				type: "local",
				path: "/path/to/extension",
			});
		});

		it("should parse file:// URL with relative path", () => {
			const result = parseInstallSource("file://./relative/path");
			expect(result).toEqual({
				type: "local",
				path: "./relative/path",
			});
		});

		it("should parse tilde path as local", () => {
			const result = parseInstallSource("~/my-extension");
			expect(result).toEqual({
				type: "local",
				path: "~/my-extension",
			});
		});

		it("should parse Windows path with backslashes", () => {
			const result = parseInstallSource("C:\\Users\\test\\extension");
			expect(result).toEqual({
				type: "local",
				path: "C:\\Users\\test\\extension",
			});
		});

		it("should parse Windows path with forward slashes", () => {
			const result = parseInstallSource("C:/Users/test/extension");
			expect(result).toEqual({
				type: "local",
				path: "C:/Users/test/extension",
			});
		});

		it("should parse Windows UNC path with backslashes", () => {
			const result = parseInstallSource("\\\\server\\share\\extension");
			expect(result).toEqual({
				type: "local",
				path: "\\\\server\\share\\extension",
			});
		});

		it("should parse Windows UNC path with forward slashes", () => {
			const result = parseInstallSource("//server/share/extension");
			expect(result).toEqual({
				type: "local",
				path: "//server/share/extension",
			});
		});

		it("should parse bare zip filename as local", () => {
			const result = parseInstallSource("quarto-test-main.zip");
			expect(result).toEqual({
				type: "local",
				path: "quarto-test-main.zip",
			});
		});

		it("should parse subdirectory zip path as local", () => {
			const result = parseInstallSource("subdirectory/quarto-test-main.zip");
			expect(result).toEqual({
				type: "local",
				path: "subdirectory/quarto-test-main.zip",
			});
		});

		it("should parse bare tar.gz filename as local", () => {
			const result = parseInstallSource("extension.tar.gz");
			expect(result).toEqual({
				type: "local",
				path: "extension.tar.gz",
			});
		});

		it("should parse subdirectory tar.gz path as local", () => {
			const result = parseInstallSource("path/to/extension.tar.gz");
			expect(result).toEqual({
				type: "local",
				path: "path/to/extension.tar.gz",
			});
		});

		it("should parse tgz filename as local", () => {
			const result = parseInstallSource("extension.tgz");
			expect(result).toEqual({
				type: "local",
				path: "extension.tgz",
			});
		});
	});
});

describe("formatInstallSource", () => {
	it("should format GitHub source without version", () => {
		const source: InstallSource = {
			type: "github",
			owner: "quarto-ext",
			repo: "fontawesome",
			version: { type: "latest" },
		};
		expect(formatInstallSource(source)).toBe("quarto-ext/fontawesome");
	});

	it("should format GitHub source with tag", () => {
		const source: InstallSource = {
			type: "github",
			owner: "quarto-ext",
			repo: "fontawesome",
			version: { type: "tag", tag: "v1.0.0" },
		};
		expect(formatInstallSource(source)).toBe("quarto-ext/fontawesome@v1.0.0");
	});

	it("should format GitHub source with branch", () => {
		const source: InstallSource = {
			type: "github",
			owner: "quarto-ext",
			repo: "fontawesome",
			version: { type: "branch", branch: "develop" },
		};
		expect(formatInstallSource(source)).toBe("quarto-ext/fontawesome@develop");
	});

	it("should format GitHub source with exact version", () => {
		const source: InstallSource = {
			type: "github",
			owner: "quarto-ext",
			repo: "fontawesome",
			version: { type: "exact", version: "1.0.0" },
		};
		expect(formatInstallSource(source)).toBe("quarto-ext/fontawesome@v1.0.0");
	});

	it("should format URL source", () => {
		const source: InstallSource = {
			type: "url",
			url: "https://example.com/extension.zip",
		};
		expect(formatInstallSource(source)).toBe("https://example.com/extension.zip");
	});

	it("should format local source", () => {
		const source: InstallSource = {
			type: "local",
			path: "/path/to/extension",
		};
		expect(formatInstallSource(source)).toBe("/path/to/extension");
	});
});

describe("resolveExtensionId", () => {
	describe("with GitHub source", () => {
		it("should use GitHub owner and repo", () => {
			const source: InstallSource = {
				type: "github",
				owner: "quarto-ext",
				repo: "fontawesome",
				version: { type: "latest" },
			};
			const extensionRoot = "/tmp/extract/repo-main/_extensions/other/name";

			const result = resolveExtensionId(source, extensionRoot);

			expect(result.owner).toBe("quarto-ext");
			expect(result.name).toBe("fontawesome");
		});
	});

	describe("with URL source", () => {
		const urlSource: InstallSource = { type: "url", url: "https://example.com/ext.zip" };

		it("should extract owner/name from _extensions/owner/name structure", () => {
			const extensionRoot = "/tmp/extract/repo-main/_extensions/myowner/myext";

			const result = resolveExtensionId(urlSource, extensionRoot);

			expect(result.owner).toBe("myowner");
			expect(result.name).toBe("myext");
		});

		it("should return null owner for _extensions/name structure", () => {
			const extensionRoot = "/tmp/extract/repo-main/_extensions/test";

			const result = resolveExtensionId(urlSource, extensionRoot);

			expect(result.owner).toBeNull();
			expect(result.name).toBe("test");
		});

		it("should not use _extensions as owner name", () => {
			const extensionRoot = "/tmp/extract/repo-main/_extensions/test";

			const result = resolveExtensionId(urlSource, extensionRoot);

			expect(result.owner).not.toBe("_extensions");
		});

		it("should throw error when no _extensions in path", () => {
			const extensionRoot = "/tmp/extract/some/other/path";

			expect(() => resolveExtensionId(urlSource, extensionRoot)).toThrow(/Invalid extension structure/);
		});
	});

	describe("with local source", () => {
		const localSource: InstallSource = { type: "local", path: "/some/path" };

		it("should extract owner/name from _extensions/owner/name structure", () => {
			const extensionRoot = "/project/_extensions/owner/name";

			const result = resolveExtensionId(localSource, extensionRoot);

			expect(result.owner).toBe("owner");
			expect(result.name).toBe("name");
		});

		it("should return null owner for _extensions/name structure", () => {
			const extensionRoot = "/project/_extensions/myext";

			const result = resolveExtensionId(localSource, extensionRoot);

			expect(result.owner).toBeNull();
			expect(result.name).toBe("myext");
		});

		it("should throw error when no _extensions in path", () => {
			const extensionRoot = "/project/myext";

			expect(() => resolveExtensionId(localSource, extensionRoot)).toThrow(/Invalid extension structure/);
		});
	});
});

describe("install with multiple extensions", () => {
	let tempDir: string;
	let projectDir: string;
	let sourceDir: string;

	beforeEach(async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qw-multi-ext-test-"));
		projectDir = path.join(tempDir, "project");
		sourceDir = path.join(tempDir, "source");

		// Create project directory
		fs.mkdirSync(projectDir, { recursive: true });

		// Create a source with multiple extensions
		// Structure: source/_extensions/owner/ext1/_extension.yml
		//            source/_extensions/owner/ext2/_extension.yml
		const ext1Dir = path.join(sourceDir, "_extensions", "testowner", "ext1");
		const ext2Dir = path.join(sourceDir, "_extensions", "testowner", "ext2");

		fs.mkdirSync(ext1Dir, { recursive: true });
		fs.mkdirSync(ext2Dir, { recursive: true });

		fs.writeFileSync(
			path.join(ext1Dir, "_extension.yml"),
			"title: Extension 1\nversion: 1.0.0\ncontributes:\n  filters:\n    - filter1.lua\n",
		);
		fs.writeFileSync(path.join(ext1Dir, "filter1.lua"), "-- filter 1");

		fs.writeFileSync(
			path.join(ext2Dir, "_extension.yml"),
			"title: Extension 2\nversion: 1.0.0\ncontributes:\n  filters:\n    - filter2.lua\n",
		);
		fs.writeFileSync(path.join(ext2Dir, "filter2.lua"), "-- filter 2");
	});

	afterEach(async () => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("should call confirmOverwrite for ALL extensions when they already exist", async () => {
		const { install, parseInstallSource } = await import("../../src/operations/install.js");

		// Pre-install both extensions to simulate existing installations
		const preInstallExt1 = path.join(projectDir, "_extensions", "testowner", "ext1");
		const preInstallExt2 = path.join(projectDir, "_extensions", "testowner", "ext2");

		fs.mkdirSync(preInstallExt1, { recursive: true });
		fs.mkdirSync(preInstallExt2, { recursive: true });

		fs.writeFileSync(path.join(preInstallExt1, "_extension.yml"), "title: Old Extension 1\nversion: 0.1.0\n");
		fs.writeFileSync(path.join(preInstallExt2, "_extension.yml"), "title: Old Extension 2\nversion: 0.1.0\n");

		// Track which extensions confirmOverwrite was called for
		const confirmedExtensions: string[] = [];
		const confirmOverwrite = vi.fn(async (extension) => {
			const extId = extension.id.owner ? `${extension.id.owner}/${extension.id.name}` : extension.id.name;
			confirmedExtensions.push(extId);
			return true; // Allow overwrite
		});

		// Select all extensions
		const selectExtension = vi.fn(async (extensions) => extensions);

		const source = parseInstallSource(sourceDir);
		const result = await install(source, {
			projectDir,
			force: true,
			confirmOverwrite,
			selectExtension,
		});

		expect(result.success).toBe(true);

		// The bug: confirmOverwrite is only called for the first extension
		// Expected: confirmOverwrite should be called for BOTH extensions
		expect(confirmOverwrite).toHaveBeenCalledTimes(2);
		expect(confirmedExtensions).toContain("testowner/ext1");
		expect(confirmedExtensions).toContain("testowner/ext2");
	});

	it("should skip additional extension when confirmOverwrite returns false for it", async () => {
		const { install, parseInstallSource } = await import("../../src/operations/install.js");

		// Pre-install both extensions
		const preInstallExt1 = path.join(projectDir, "_extensions", "testowner", "ext1");
		const preInstallExt2 = path.join(projectDir, "_extensions", "testowner", "ext2");

		fs.mkdirSync(preInstallExt1, { recursive: true });
		fs.mkdirSync(preInstallExt2, { recursive: true });

		fs.writeFileSync(path.join(preInstallExt1, "_extension.yml"), "title: Old Extension 1\nversion: 0.1.0\n");
		fs.writeFileSync(path.join(preInstallExt2, "_extension.yml"), "title: Old Extension 2\nversion: 0.1.0\n");

		// Allow first, deny second
		let callCount = 0;
		const confirmOverwrite = vi.fn(async () => {
			callCount++;
			return callCount === 1; // Allow first, deny second
		});

		const selectExtension = vi.fn(async (extensions) => extensions);

		const source = parseInstallSource(sourceDir);
		const result = await install(source, {
			projectDir,
			force: true,
			confirmOverwrite,
			selectExtension,
		});

		expect(result.success).toBe(true);

		// First extension should be installed (new version)
		const ext1Manifest = fs.readFileSync(path.join(preInstallExt1, "_extension.yml"), "utf-8");
		expect(ext1Manifest).toContain("Extension 1");

		// Second extension should still have old version (overwrite was denied)
		const ext2Manifest = fs.readFileSync(path.join(preInstallExt2, "_extension.yml"), "utf-8");
		expect(ext2Manifest).toContain("Old Extension 2");

		// Additional install should be marked as cancelled or skipped
		expect(result.additionalInstalls).toBeDefined();
		expect(result.additionalInstalls![0].cancelled).toBe(true);
	});
});
