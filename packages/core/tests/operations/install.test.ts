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
	const mockManifest = {
		title: "Test Extension",
		author: "Test Author",
		version: "1.0.0",
		contributes: {},
	};

	describe("with GitHub source", () => {
		it("should use GitHub owner and repo", () => {
			const source: InstallSource = {
				type: "github",
				owner: "quarto-ext",
				repo: "fontawesome",
				version: { type: "latest" },
			};
			const extensionRoot = "/tmp/extract/repo-main/_extensions/other/name";

			const result = resolveExtensionId(source, extensionRoot, mockManifest);

			expect(result.owner).toBe("quarto-ext");
			expect(result.name).toBe("fontawesome");
		});
	});

	describe("with URL source", () => {
		const urlSource: InstallSource = { type: "url", url: "https://example.com/ext.zip" };

		it("should extract owner/name from _extensions/owner/name structure", () => {
			const extensionRoot = "/tmp/extract/repo-main/_extensions/myowner/myext";

			const result = resolveExtensionId(urlSource, extensionRoot, mockManifest);

			expect(result.owner).toBe("myowner");
			expect(result.name).toBe("myext");
		});

		it("should return null owner for _extensions/name structure", () => {
			const extensionRoot = "/tmp/extract/repo-main/_extensions/test";

			const result = resolveExtensionId(urlSource, extensionRoot, mockManifest);

			expect(result.owner).toBeNull();
			expect(result.name).toBe("test");
		});

		it("should not use _extensions as owner name", () => {
			const extensionRoot = "/tmp/extract/repo-main/_extensions/test";

			const result = resolveExtensionId(urlSource, extensionRoot, mockManifest);

			expect(result.owner).not.toBe("_extensions");
		});

		it("should throw error when no _extensions in path", () => {
			const extensionRoot = "/tmp/extract/some/other/path";

			expect(() => resolveExtensionId(urlSource, extensionRoot, mockManifest)).toThrow(/Invalid extension structure/);
		});
	});

	describe("with local source", () => {
		const localSource: InstallSource = { type: "local", path: "/some/path" };

		it("should extract owner/name from _extensions/owner/name structure", () => {
			const extensionRoot = "/project/_extensions/owner/name";

			const result = resolveExtensionId(localSource, extensionRoot, mockManifest);

			expect(result.owner).toBe("owner");
			expect(result.name).toBe("name");
		});

		it("should return null owner for _extensions/name structure", () => {
			const extensionRoot = "/project/_extensions/myext";

			const result = resolveExtensionId(localSource, extensionRoot, mockManifest);

			expect(result.owner).toBeNull();
			expect(result.name).toBe("myext");
		});

		it("should throw error when no _extensions in path", () => {
			const extensionRoot = "/project/myext";

			expect(() => resolveExtensionId(localSource, extensionRoot, mockManifest)).toThrow(/Invalid extension structure/);
		});
	});
});
