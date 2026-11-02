/**
 * Tests for extension installation operations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as tar from "tar";
import { install, parseInstallSource, formatInstallSource, type InstallSource } from "../../src/operations/install.js";
import { ExtensionError, LocalEditsError } from "../../src/errors.js";
import {
	getInstalledState,
	hashExtensionFiles,
	readSourceRecord,
	writeSourceRecord,
	SOURCE_RECORD_FILENAME,
	type SourceRecord,
} from "../../src/filesystem/sourceRecord.js";
// Internal exports for testing only
import { normaliseSubdirectory } from "../../src/archive/security.js";
import { resolveExtensionId } from "../../src/operations/internal.js";
import { downloadGitHubArchive } from "../../src/github/download.js";
import { fetchRegistry } from "../../src/registry/fetcher.js";
import {
	createSubdirectoryRepositoryArchive,
	SUBDIRECTORY_REPOSITORY_TAG,
} from "../fixtures/subdirectory-repository.js";

vi.mock("../../src/github/download.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/github/download.js")>()),
	downloadGitHubArchive: vi.fn(),
}));

vi.mock("../../src/registry/fetcher.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/registry/fetcher.js")>()),
	fetchRegistry: vi.fn().mockRejectedValue(new Error("registry offline")),
}));

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

		it("parses owner/repo/sub/dir@v1 with its subdirectory", () => {
			expect(parseInstallSource("owner/repo/sub/dir@v1")).toEqual({
				type: "github",
				owner: "owner",
				repo: "repo",
				subdirectory: "sub/dir",
				version: { type: "tag", tag: "v1" },
			});
		});

		it("parses a ref that contains a slash", () => {
			expect(parseInstallSource("owner/repo/sub@feature/x")).toEqual({
				type: "github",
				owner: "owner",
				repo: "repo",
				subdirectory: "sub",
				version: { type: "branch", branch: "feature/x" },
			});
		});

		it("drops a trailing slash and empty segments", () => {
			expect(parseInstallSource("owner/repo//sub/")).toEqual({
				type: "github",
				owner: "owner",
				repo: "repo",
				subdirectory: "sub",
				version: { type: "latest" },
			});
		});

		it("drops . segments", () => {
			expect(parseInstallSource("owner/repo/a/./b")).toMatchObject({ subdirectory: "a/b" });
			expect(parseInstallSource("owner/repo/.")).toEqual({
				type: "github",
				owner: "owner",
				repo: "repo",
				version: { type: "latest" },
			});
		});

		it("refuses .. in a subdirectory", () => {
			expect(() => parseInstallSource("owner/repo/a/../b")).toThrow(/Invalid subdirectory/);
		});

		it("refuses a backslash in a subdirectory", () => {
			expect(() => parseInstallSource("owner/repo/a\\b")).toThrow(/Invalid subdirectory/);
		});

		it("leaves owner/repo without a subdirectory unchanged", () => {
			const result = parseInstallSource("owner/repo");
			expect(result).toEqual({ type: "github", owner: "owner", repo: "repo", version: { type: "latest" } });
			expect(result).not.toHaveProperty("subdirectory");
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

describe("normaliseSubdirectory", () => {
	it("refuses a leading slash", () => {
		expect(() => normaliseSubdirectory("/sub")).toThrow(expect.objectContaining({ code: "INVALID_SUBDIRECTORY" }));
	});

	it("refuses .. and a backslash with the subdirectory error code", () => {
		expect(() => normaliseSubdirectory("a/../b")).toThrow(expect.objectContaining({ code: "INVALID_SUBDIRECTORY" }));
		expect(() => normaliseSubdirectory("a\\b")).toThrow(expect.objectContaining({ code: "INVALID_SUBDIRECTORY" }));
	});

	it("drops empty segments and a trailing slash", () => {
		expect(normaliseSubdirectory("a//b/")).toBe("a/b");
	});

	it("drops . segments", () => {
		expect(normaliseSubdirectory("a/./b")).toBe("a/b");
		expect(normaliseSubdirectory(".")).toBe("");
	});
});

describe("formatInstallSource", () => {
	it("round-trips a subdirectory source", () => {
		const input = "owner/repo/sub/dir@v1";
		expect(formatInstallSource(parseInstallSource(input))).toBe(input);
	});

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

	it("installs a new extension when the first selected one is already at the same version", async () => {
		const { install, parseInstallSource } = await import("../../src/operations/install.js");
		const preInstallExt1 = path.join(projectDir, "_extensions", "testowner", "ext1");
		fs.mkdirSync(preInstallExt1, { recursive: true });
		fs.writeFileSync(path.join(preInstallExt1, "_extension.yml"), "title: Old Extension 1\nversion: 1.0.0\n");

		const result = await install(parseInstallSource(sourceDir), {
			projectDir,
			selectExtension: async (extensions) => extensions,
		});

		expect(result.success).toBe(true);
		expect(result.unchanged).toBe(true);
		expect(fs.readFileSync(path.join(preInstallExt1, "_extension.yml"), "utf-8")).toContain("Old Extension 1");
		expect(result.additionalInstalls?.map((r) => r.success)).toEqual([true]);
		expect(fs.existsSync(path.join(projectDir, "_extensions", "testowner", "ext2", "filter2.lua"))).toBe(true);
	});

	it("writes no extension when a later selected one is locally edited", async () => {
		const { install, parseInstallSource } = await import("../../src/operations/install.js");
		const preInstallExt1 = path.join(projectDir, "_extensions", "testowner", "ext1");
		const preInstallExt2 = path.join(projectDir, "_extensions", "testowner", "ext2");
		for (const dir of [preInstallExt1, preInstallExt2]) {
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(path.join(dir, "_extension.yml"), "title: Old\nversion: 0.1.0\n");
			writeSourceRecord(dir, { source: "./old", kind: "local-dir" });
		}
		fs.writeFileSync(path.join(preInstallExt2, "_extension.yml"), "title: Edited\nversion: 0.1.0\n");
		const confirmOverwrite = vi.fn(async () => true);

		await expect(
			install(parseInstallSource(sourceDir), {
				projectDir,
				confirmOverwrite,
				selectExtension: async (extensions) => extensions,
			}),
		).rejects.toBeInstanceOf(LocalEditsError);

		expect(confirmOverwrite).not.toHaveBeenCalled();
		expect(fs.readFileSync(path.join(preInstallExt1, "_extension.yml"), "utf-8")).toBe("title: Old\nversion: 0.1.0\n");
	});

	it("keeps only the expected extension from a source with several", async () => {
		const { install, parseInstallSource } = await import("../../src/operations/install.js");
		const selectExtension = vi.fn(async (extensions) => extensions);

		const result = await install(parseInstallSource(sourceDir), {
			projectDir,
			selectExtension,
			expectedExtensionId: { owner: "TestOwner", name: "EXT2" },
		});

		expect(result.success).toBe(true);
		expect(selectExtension).not.toHaveBeenCalled();
		expect(fs.readdirSync(path.join(projectDir, "_extensions", "testowner"))).toEqual(["ext2"]);
	});

	it("fails when the expected extension is not the only extension of a one-extension source", async () => {
		const { install, parseInstallSource } = await import("../../src/operations/install.js");
		fs.rmSync(path.join(sourceDir, "_extensions", "testowner", "ext2"), { recursive: true });

		await expect(
			install(parseInstallSource(sourceDir), {
				projectDir,
				expectedExtensionId: { owner: "testowner", name: "ext2" },
			}),
		).rejects.toThrow(`testowner/ext2 is no longer in ${sourceDir}`);
		expect(fs.existsSync(path.join(projectDir, "_extensions"))).toBe(false);
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

	it("should report partial failure when an additional extension install throws", async () => {
		const { install, parseInstallSource } = await import("../../src/operations/install.js");

		const preInstallExt1 = path.join(projectDir, "_extensions", "testowner", "ext1");
		const preInstallExt2 = path.join(projectDir, "_extensions", "testowner", "ext2");

		fs.mkdirSync(preInstallExt1, { recursive: true });
		fs.mkdirSync(preInstallExt2, { recursive: true });

		fs.writeFileSync(path.join(preInstallExt1, "_extension.yml"), "title: Old Extension 1\nversion: 0.1.0\n");
		fs.writeFileSync(path.join(preInstallExt2, "_extension.yml"), "title: Old Extension 2\nversion: 0.1.0\n");

		let callCount = 0;
		const confirmOverwrite = vi.fn(async () => {
			callCount++;
			if (callCount === 1) {
				return true;
			}
			throw new Error("intentional additional install failure");
		});

		const selectExtension = vi.fn(async (extensions) => extensions);

		const source = parseInstallSource(sourceDir);
		const result = await install(source, {
			projectDir,
			confirmOverwrite,
			selectExtension,
		});

		expect(result.success).toBe(true);
		expect(result.additionalInstallFailures).toBeDefined();
		expect(result.additionalInstallFailures).toHaveLength(1);
		expect(result.additionalInstallFailures![0].extensionId).toEqual({ owner: "testowner", name: "ext2" });
		expect(result.additionalInstallFailures![0].error).toContain("intentional additional install failure");
	});
});

describe("install from a repository subdirectory", () => {
	let tempDir: string;
	let projectDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qw-subdir-install-"));
		projectDir = path.join(tempDir, "project");
		fs.mkdirSync(projectDir);
		vi.mocked(downloadGitHubArchive).mockImplementation(async () => ({
			archivePath: await createSubdirectoryRepositoryArchive(tempDir),
			tagName: SUBDIRECTORY_REPOSITORY_TAG,
			format: "tarball",
		}));
	});

	afterEach(() => {
		vi.mocked(downloadGitHubArchive).mockReset();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	async function installFrom(input: string) {
		const { install } = await import("../../src/operations/install.js");
		return install(parseInstallSource(input), {
			projectDir,
			selectExtension: async (extensions) => extensions,
		});
	}

	function installedExtensions(): string[] {
		const extensionsDir = path.join(projectDir, "_extensions");
		return fs
			.readdirSync(extensionsDir, { recursive: true, encoding: "utf-8" })
			.filter((entry) => path.basename(entry) === "_extension.yml")
			.map((entry) => path.dirname(entry).split(path.sep).join("/"))
			.sort();
	}

	it("installs only the extensions below the subdirectory", async () => {
		const result = await installFrom("owner/repo/b");

		expect(result.success).toBe(true);
		expect(installedExtensions()).toEqual(["owner/y"]);
	});

	it("accepts a subdirectory that is the extension folder", async () => {
		const result = await installFrom("owner/repo/c");

		expect(result.success).toBe(true);
		expect(installedExtensions()).toEqual(["owner/c"]);
	});

	it("accepts a subdirectory that is an _extensions folder", async () => {
		const result = await installFrom("owner/repo/a/_extensions");

		expect(result.success).toBe(true);
		expect(installedExtensions()).toEqual(["owner/x"]);
	});

	it("fails with Subdirectory not found for an absent path", async () => {
		await expect(installFrom("owner/repo/missing/dir")).rejects.toThrow(
			`Subdirectory not found in owner/repo@${SUBDIRECTORY_REPOSITORY_TAG}: missing/dir`,
		);
	});

	it("fails with Subdirectory not found for a file", async () => {
		await expect(installFrom("owner/repo/README.md")).rejects.toThrow(
			`Subdirectory not found in owner/repo@${SUBDIRECTORY_REPOSITORY_TAG}: README.md`,
		);
	});

	it.skipIf(process.platform === "darwin" || process.platform === "win32")(
		"does not match a subdirectory written with a different case",
		async () => {
			await expect(installFrom("owner/repo/B")).rejects.toThrow(
				`Subdirectory not found in owner/repo@${SUBDIRECTORY_REPOSITORY_TAG}: B`,
			);
		},
	);

	it("install records the latest path commit for an untagged subdirectory source", async () => {
		vi.mocked(fetchRegistry).mockResolvedValueOnce({
			"owner/repo": { fullName: "owner/repo", defaultBranchRef: "main", latestCommit: "0000000aaaaaaa" },
		} as never);
		vi.mocked(downloadGitHubArchive).mockImplementation(async () => ({
			archivePath: await createSubdirectoryRepositoryArchive(tempDir),
			tagName: "fed9876",
			format: "tarball",
			commitSha: "fed9876",
		}));

		await installFrom("owner/repo/b");

		expect(downloadGitHubArchive).toHaveBeenCalledWith(
			"owner",
			"repo",
			{ type: "latest" },
			expect.objectContaining({ path: "b", latestCommit: undefined, defaultBranch: "main" }),
		);
		const record = readSourceRecord(path.join(projectDir, "_extensions", "owner", "y"));
		expect(record).toMatchObject({
			status: "ok",
			record: { source: "owner/repo/b", quartoWizard: { commit: "fed9876" } },
		});
	});

	it("records owner/repo/b as the source, without the resolved tag", async () => {
		await installFrom("owner/repo/b");

		const record = readSourceRecord(path.join(projectDir, "_extensions", "owner", "y"));
		expect(record).toMatchObject({ status: "ok", record: { source: "owner/repo/b", kind: "github" } });
		expect(record.status === "ok" && record.record.ref).toBeUndefined();
	});
});

describe("install record", () => {
	const MANIFEST = "title: Demo\nversion: 1.2.0\ncontributes:\n  filters:\n    - demo.lua\n";
	let tempDir: string;
	let projectDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qw-install-record-"));
		projectDir = path.join(tempDir, "project");
		fs.mkdirSync(projectDir);
	});

	afterEach(() => {
		vi.mocked(downloadGitHubArchive).mockReset();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	function writeFiles(root: string, files: Record<string, string>): void {
		for (const [relativePath, content] of Object.entries(files)) {
			const fullPath = path.join(root, relativePath);
			fs.mkdirSync(path.dirname(fullPath), { recursive: true });
			fs.writeFileSync(fullPath, content);
		}
	}

	function extensionSource(root: string): string {
		writeFiles(root, { "_extensions/demo/_extension.yml": MANIFEST, "_extensions/demo/demo.lua": "-- demo\n" });
		return root;
	}

	function mockGitHubDownload(resolution: { tagName: string; commitSha?: string; fromTag?: boolean }): void {
		vi.mocked(downloadGitHubArchive).mockImplementation(async () => {
			const workDir = fs.mkdtempSync(path.join(tempDir, "archive-"));
			extensionSource(path.join(workDir, "repo-main"));
			const archivePath = path.join(workDir, "repo.tar.gz");
			await tar.create({ gzip: true, file: archivePath, cwd: workDir }, ["repo-main"]);
			return { archivePath, format: "tarball", ...resolution };
		});
	}

	function installedDir(owner = "owner"): string {
		return path.join(projectDir, "_extensions", owner, "demo");
	}

	function recordOf(dir: string): SourceRecord {
		const result = readSourceRecord(dir);
		if (result.status !== "ok") {
			throw new Error(`No readable install record in ${dir}: ${result.status}`);
		}
		return result.record;
	}

	it("install writes a record and leaves _extension.yml as the archive had it", async () => {
		const source = extensionSource(path.join(tempDir, "source"));

		const result = await install(parseInstallSource(source), { projectDir });

		const dir = path.join(projectDir, "_extensions", "demo");
		expect(fs.readFileSync(path.join(dir, "_extension.yml"), "utf-8")).toBe(MANIFEST);
		const record = recordOf(dir);
		expect(record.files).toEqual(hashExtensionFiles(dir));
		expect(result.extension.record).toEqual(record);
		expect(result.extension.recordStatus).toBe("ok");
		expect(result.extension.manifest.source).toBe(record.source);
		expect(result.extension.manifest.sourceType).toBe("local");
	});

	it("install records ref for a pinned source", async () => {
		mockGitHubDownload({ tagName: "v1.2.0" });

		await install(parseInstallSource("owner/repo@v1.2.0"), { projectDir });

		const record = recordOf(installedDir());
		expect(record.source).toBe("owner/repo@v1.2.0");
		expect(record.ref).toBe("v1.2.0");
	});

	it("a registry install records kind github and source-type registry", async () => {
		mockGitHubDownload({ tagName: "v1.2.0", fromTag: true });

		const result = await install(parseInstallSource("owner/repo"), { projectDir, sourceType: "registry" });

		const record = recordOf(installedDir());
		expect(record.kind).toBe("github");
		expect(record.quartoWizard).toEqual({ track: "tag", sourceType: "registry" });
		expect(result.extension.manifest.sourceType).toBe("registry");
	});

	it("a reinstall of an unpinned source at the recorded commit and the same version is unchanged", async () => {
		mockGitHubDownload({ tagName: "fed9876", commitSha: "fed9876" });
		await install(parseInstallSource("owner/repo"), { projectDir });
		fs.writeFileSync(path.join(installedDir(), "demo.lua"), "-- edited\n");
		mockGitHubDownload({ tagName: "FED9876abc", commitSha: "FED9876abc" });

		const result = await install(parseInstallSource("owner/repo"), { projectDir });

		expect(result.unchanged).toBe(true);
		expect(fs.readFileSync(path.join(installedDir(), "demo.lua"), "utf-8")).toBe("-- edited\n");
	});

	it("a reinstall of an unpinned source that moved to a new commit at the same version is an update", async () => {
		mockGitHubDownload({ tagName: "fed9876", commitSha: "fed9876" });
		await install(parseInstallSource("owner/repo"), { projectDir });
		mockGitHubDownload({ tagName: "abc1234", commitSha: "abc1234" });

		const result = await install(parseInstallSource("owner/repo"), { projectDir });

		expect(result.unchanged).toBeUndefined();
		expect(recordOf(installedDir()).quartoWizard).toEqual({ track: "tag", commit: "abc1234" });
	});

	it("a reinstall of an unpinned source that moved to a new commit refuses a locally edited copy", async () => {
		mockGitHubDownload({ tagName: "fed9876", commitSha: "fed9876" });
		await install(parseInstallSource("owner/repo"), { projectDir });
		fs.writeFileSync(path.join(installedDir(), "demo.lua"), "-- edited\n");
		mockGitHubDownload({ tagName: "abc1234", commitSha: "abc1234" });

		await expect(install(parseInstallSource("owner/repo"), { projectDir })).rejects.toBeInstanceOf(LocalEditsError);
		expect(recordOf(installedDir()).quartoWizard).toEqual({ track: "tag", commit: "fed9876" });
	});

	it("an install pinned to another commit at the same version replaces the copy", async () => {
		mockGitHubDownload({ tagName: "fed9876", commitSha: "fed9876" });
		await install(parseInstallSource("owner/repo@fed9876"), { projectDir });
		mockGitHubDownload({ tagName: "abc1234", commitSha: "abc1234" });

		const result = await install(parseInstallSource("owner/repo@abc1234"), { projectDir });

		expect(result.unchanged).toBeUndefined();
		expect(recordOf(installedDir()).source).toBe("owner/repo@abc1234");
	});

	it("an install pinned to a commit replaces an unpinned copy at another commit", async () => {
		mockGitHubDownload({ tagName: "fed9876", commitSha: "fed9876" });
		await install(parseInstallSource("owner/repo"), { projectDir });
		mockGitHubDownload({ tagName: "abc1234", commitSha: "abc1234" });

		const result = await install(parseInstallSource("owner/repo@abc1234"), { projectDir });

		expect(result.unchanged).toBeUndefined();
		expect(recordOf(installedDir()).ref).toBe("abc1234");
	});

	it("an install pinned to another commit refuses a locally edited copy", async () => {
		mockGitHubDownload({ tagName: "fed9876", commitSha: "fed9876" });
		await install(parseInstallSource("owner/repo@fed9876"), { projectDir });
		fs.writeFileSync(path.join(installedDir(), "demo.lua"), "-- edited\n");
		mockGitHubDownload({ tagName: "abc1234", commitSha: "abc1234" });

		await expect(install(parseInstallSource("owner/repo@abc1234"), { projectDir })).rejects.toBeInstanceOf(
			LocalEditsError,
		);
		expect(recordOf(installedDir()).ref).toBe("fed9876");
	});

	it("an update recorded unpinned keeps the record unpinned with the new commit", async () => {
		mockGitHubDownload({ tagName: "fed9876", commitSha: "fed9876" });
		await install(parseInstallSource("owner/repo"), { projectDir });
		mockGitHubDownload({ tagName: "abc1234", commitSha: "abc1234" });

		const result = await install(parseInstallSource("owner/repo@abc1234"), { projectDir, recordSource: "owner/repo" });

		expect(result.unchanged).toBeUndefined();
		const record = recordOf(installedDir());
		expect(record.source).toBe("owner/repo");
		expect(record).not.toHaveProperty("ref");
		expect(record.quartoWizard).toEqual({ track: "tag", commit: "abc1234" });
	});

	it("a Quarto Wizard 3 copy at the same commit is unchanged", async () => {
		writeQuartoWizard3Copy("owner/repo@fed9876");
		mockGitHubDownload({ tagName: "fed9876", commitSha: "fed9876" });

		const result = await install(parseInstallSource("owner/repo@FED9876abc"), { projectDir });

		expect(result.unchanged).toBe(true);
		expect(readSourceRecord(installedDir()).status).toBe("absent");
	});

	it("a Quarto Wizard 3 copy at another commit is replaced", async () => {
		writeQuartoWizard3Copy("owner/repo@fed9876");
		mockGitHubDownload({ tagName: "abc1234", commitSha: "abc1234" });

		const result = await install(parseInstallSource("owner/repo@abc1234"), { projectDir });

		expect(result.unchanged).toBeUndefined();
		expect(result.replacedUntracked).toBe(true);
		expect(recordOf(installedDir()).ref).toBe("abc1234");
	});

	describe("by update mode", () => {
		const SHA = "fed9876543210fedcba9876543210fedcba98765";

		it("tag mode records the latest tag as the ref", async () => {
			mockGitHubDownload({ tagName: "v1.4.0", fromTag: true });

			await install(parseInstallSource("owner/repo"), { projectDir });

			const record = recordOf(installedDir());
			expect(record.source).toBe("owner/repo@v1.4.0");
			expect(record.ref).toBe("v1.4.0");
			expect(record.quartoWizard).toEqual({ track: "tag" });
			expect(downloadGitHubArchive).toHaveBeenCalledWith(
				"owner",
				"repo",
				{ type: "latest" },
				expect.objectContaining({ track: "tag" }),
			);
		});

		it("branch mode records the default branch head without a ref", async () => {
			mockGitHubDownload({ tagName: "fed9876", commitSha: SHA, fromTag: false });

			await install(parseInstallSource("owner/repo"), { projectDir, track: "branch" });

			const record = recordOf(installedDir());
			expect(record.source).toBe("owner/repo");
			expect(record).not.toHaveProperty("ref");
			expect(record.quartoWizard).toEqual({ track: "branch", commit: SHA });
			expect(downloadGitHubArchive).toHaveBeenCalledWith(
				"owner",
				"repo",
				{ type: "latest" },
				expect.objectContaining({ track: "branch" }),
			);
		});

		it("an explicit branch records the branch and its head commit", async () => {
			mockGitHubDownload({ tagName: "dev", commitSha: SHA, fromTag: false });

			await install(parseInstallSource("owner/repo@dev"), { projectDir });

			const record = recordOf(installedDir());
			expect(record.source).toBe("owner/repo@dev");
			expect(record.ref).toBe("dev");
			expect(record.quartoWizard).toEqual({ track: "branch", commit: SHA });
		});

		it("an explicit tag records the tag in tag mode without a commit", async () => {
			mockGitHubDownload({ tagName: "v1.2.0", fromTag: true });

			await install(parseInstallSource("owner/repo@v1.2.0"), { projectDir });

			const record = recordOf(installedDir());
			expect(record.source).toBe("owner/repo@v1.2.0");
			expect(record.ref).toBe("v1.2.0");
			expect(record.quartoWizard).toEqual({ track: "tag" });
		});

		it("an explicit commit records the commit in tag mode without quarto-wizard.commit", async () => {
			mockGitHubDownload({ tagName: "fed9876", commitSha: SHA, fromTag: false });

			await install(parseInstallSource("owner/repo@fed9876"), { projectDir });

			const record = recordOf(installedDir());
			expect(record.source).toBe("owner/repo@fed9876");
			expect(record.ref).toBe("fed9876");
			expect(record.quartoWizard).toEqual({ track: "tag" });
		});

		it("tag mode without a version tag records the default branch head commit", async () => {
			mockGitHubDownload({ tagName: "fed9876", commitSha: SHA, fromTag: false });

			await install(parseInstallSource("owner/repo"), { projectDir });

			const record = recordOf(installedDir());
			expect(record.source).toBe("owner/repo");
			expect(record).not.toHaveProperty("ref");
			expect(record.quartoWizard).toEqual({ track: "tag", commit: SHA });
		});

		it("the mode option does not change a source with a ref", async () => {
			mockGitHubDownload({ tagName: "v1.2.0", fromTag: true });

			await install(parseInstallSource("owner/repo@v1.2.0"), { projectDir, track: "branch" });

			expect(recordOf(installedDir()).quartoWizard).toEqual({ track: "tag" });
		});

		it("a subdirectory source in branch mode records its path commit", async () => {
			vi.mocked(downloadGitHubArchive).mockImplementation(async () => ({
				archivePath: await createSubdirectoryRepositoryArchive(tempDir),
				tagName: "fed9876",
				commitSha: SHA,
				fromTag: false,
				format: "tarball",
			}));

			await install(parseInstallSource("owner/repo/b"), { projectDir, track: "branch" });

			expect(downloadGitHubArchive).toHaveBeenCalledWith(
				"owner",
				"repo",
				{ type: "latest" },
				expect.objectContaining({ path: "b", track: "branch" }),
			);
			const record = recordOf(path.join(projectDir, "_extensions", "owner", "y"));
			expect(record.source).toBe("owner/repo/b");
			expect(record).not.toHaveProperty("ref");
			expect(record.quartoWizard).toEqual({ track: "branch", commit: SHA });
		});

		it("an install of the commit a check saw downloads that commit, not the moved branch head", async () => {
			mockGitHubDownload({ tagName: "fed9876", commitSha: SHA, fromTag: false });

			await install(parseInstallSource(`owner/repo@${SHA}`), {
				projectDir,
				recordSource: "owner/repo@dev",
				track: "branch",
			});

			expect(downloadGitHubArchive).toHaveBeenCalledWith(
				"owner",
				"repo",
				{ type: "commit", commit: SHA },
				expect.anything(),
			);
			const record = recordOf(installedDir());
			expect(record.source).toBe("owner/repo@dev");
			expect(record.ref).toBe("dev");
			expect(record.quartoWizard).toEqual({ track: "branch", commit: SHA });
		});

		it("a record source takes the mode from the option, tag by default", async () => {
			mockGitHubDownload({ tagName: "fed9876", commitSha: SHA, fromTag: false });

			await install(parseInstallSource(`owner/repo@${SHA}`), { projectDir, recordSource: "owner/repo" });

			expect(recordOf(installedDir()).quartoWizard).toEqual({ track: "tag", commit: SHA });
		});

		it("a record source pinned to the downloaded commit records no quarto-wizard.commit", async () => {
			mockGitHubDownload({ tagName: "fed9876", commitSha: SHA, fromTag: false });

			await install(parseInstallSource(`owner/repo@${SHA}`), { projectDir, recordSource: "owner/repo@fed9876" });

			const record = recordOf(installedDir());
			expect(record.ref).toBe("fed9876");
			expect(record.quartoWizard).toEqual({ track: "tag" });
		});

		it("a reinstall at the full commit of a seven-character record is unchanged", async () => {
			mockGitHubDownload({ tagName: "fed9876", commitSha: "fed9876", fromTag: false });
			await install(parseInstallSource("owner/repo"), { projectDir });
			fs.writeFileSync(path.join(installedDir(), "demo.lua"), "-- edited\n");
			mockGitHubDownload({ tagName: "fed9876", commitSha: SHA, fromTag: false });

			const result = await install(parseInstallSource("owner/repo"), { projectDir });

			expect(result.unchanged).toBe(true);
		});
	});

	function writeQuartoWizard3Copy(source: string): void {
		writeFiles(installedDir(), {
			"_extension.yml": `${MANIFEST}source: ${source}\nsource-type: github\n`,
			"demo.lua": "-- demo\n",
		});
	}

	it("a local install inside the project records a relative path", async () => {
		const source = extensionSource(path.join(projectDir, "vendor", "ext-source"));

		await install(parseInstallSource(source), { projectDir });

		const record = recordOf(path.join(projectDir, "_extensions", "demo"));
		expect(record.source).toBe("./vendor/ext-source");
		expect(record.kind).toBe("local-dir");
	});

	it("a local install outside the project records an absolute path", async () => {
		const source = extensionSource(path.join(tempDir, "source"));

		await install(parseInstallSource(path.relative(process.cwd(), source)), { projectDir });

		const record = recordOf(path.join(projectDir, "_extensions", "demo"));
		expect(record.source).toBe(source);
		expect(record.kind).toBe("local-dir");
	});

	it("a local archive install records kind local-archive", async () => {
		const workDir = path.join(tempDir, "work");
		extensionSource(path.join(workDir, "ext"));
		const archivePath = path.join(tempDir, "ext.tar.gz");
		await tar.create({ gzip: true, file: archivePath, cwd: workDir }, ["ext"]);

		await install(parseInstallSource(archivePath), { projectDir });

		const record = recordOf(path.join(projectDir, "_extensions", "demo"));
		expect(record.source).toBe(archivePath);
		expect(record.kind).toBe("local-archive");
	});

	it("every extension selected from one source gets a record", async () => {
		vi.mocked(downloadGitHubArchive).mockImplementation(async () => {
			const workDir = fs.mkdtempSync(path.join(tempDir, "archive-"));
			writeFiles(path.join(workDir, "repo-main"), {
				"_extensions/one/_extension.yml": MANIFEST,
				"_extensions/two/_extension.yml": MANIFEST,
			});
			const archivePath = path.join(workDir, "repo.tar.gz");
			await tar.create({ gzip: true, file: archivePath, cwd: workDir }, ["repo-main"]);
			return { archivePath, format: "tarball", tagName: "v1.2.0", fromTag: true };
		});

		const result = await install(parseInstallSource("owner/repo"), {
			projectDir,
			sourceType: "registry",
			selectExtension: async (extensions) => extensions,
		});

		for (const name of ["one", "two"]) {
			const record = recordOf(path.join(projectDir, "_extensions", "owner", name));
			expect(record.source).toBe("owner/repo@v1.2.0");
			expect(record.quartoWizard).toEqual({ track: "tag", sourceType: "registry" });
		}
		expect(result.additionalInstalls?.[0].extension.recordStatus).toBe("ok");
	});

	it("no record is written for an embedded extension inside an installed one", async () => {
		const source = extensionSource(path.join(tempDir, "source"));
		writeFiles(source, { "_extensions/demo/_extensions/inner/_extension.yml": "title: Inner\n" });

		await install(parseInstallSource(source), { projectDir });

		const dir = path.join(projectDir, "_extensions", "demo");
		expect(fs.existsSync(path.join(dir, "_extensions", "inner", SOURCE_RECORD_FILENAME))).toBe(false);
		expect(Object.keys(recordOf(dir).files)).toContain("_extensions/inner/_extension.yml");
	});
});

describe("install over an installed copy", () => {
	let tempDir: string;
	let projectDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qw-install-replace-"));
		projectDir = path.join(tempDir, "project");
		fs.mkdirSync(projectDir);
	});

	afterEach(() => {
		vi.mocked(downloadGitHubArchive).mockReset();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	function sourceAt(version: string, lua: string): string {
		const root = fs.mkdtempSync(path.join(tempDir, "source-"));
		const dir = path.join(root, "_extensions", "demo");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, "_extension.yml"), `title: Demo\nversion: ${version}\n`);
		fs.writeFileSync(path.join(dir, "demo.lua"), lua);
		return root;
	}

	function installedDir(): string {
		return path.join(projectDir, "_extensions", "demo");
	}

	function installedLua(): string {
		return fs.readFileSync(path.join(installedDir(), "demo.lua"), "utf-8");
	}

	async function installTracked(version: string, lua: string): Promise<void> {
		await install(parseInstallSource(sourceAt(version, lua)), { projectDir });
	}

	function installUntracked(version: string, lua: string): void {
		fs.mkdirSync(installedDir(), { recursive: true });
		fs.writeFileSync(path.join(installedDir(), "_extension.yml"), `title: Demo\nversion: ${version}\n`);
		fs.writeFileSync(path.join(installedDir(), "demo.lua"), lua);
	}

	it("refuses to replace a locally edited extension and lists the edits", async () => {
		await installTracked("1.0.0", "-- one\n");
		fs.writeFileSync(path.join(installedDir(), "demo.lua"), "-- edited\n");
		fs.writeFileSync(path.join(installedDir(), "notes.txt"), "mine\n");
		const confirmOverwrite = vi.fn(async () => true);

		const attempt = install(parseInstallSource(sourceAt("2.0.0", "-- two\n")), { projectDir, confirmOverwrite });

		await expect(attempt).rejects.toBeInstanceOf(LocalEditsError);
		await expect(attempt).rejects.toMatchObject({
			code: "LOCAL_EDITS",
			extensionId: { owner: null, name: "demo" },
			edits: [
				{ path: "demo.lua", change: "modified" },
				{ path: "notes.txt", change: "added" },
			],
			message: "demo has local changes: demo.lua (modified), notes.txt (added)",
		});
		expect(confirmOverwrite).not.toHaveBeenCalled();
		expect(installedLua()).toBe("-- edited\n");
		expect(fs.existsSync(path.join(installedDir(), "notes.txt"))).toBe(true);
	});

	it("force replaces a locally edited extension", async () => {
		await installTracked("1.0.0", "-- one\n");
		fs.writeFileSync(path.join(installedDir(), "demo.lua"), "-- edited\n");

		const result = await install(parseInstallSource(sourceAt("2.0.0", "-- two\n")), { projectDir, force: true });

		expect(result.success).toBe(true);
		expect(installedLua()).toBe("-- two\n");
		expect(getInstalledState(installedDir()).kind).toBe("unmodified");
	});

	it("replaces an unmodified extension after confirmation", async () => {
		await installTracked("1.0.0", "-- one\n");
		const confirmOverwrite = vi.fn(async () => true);

		const result = await install(parseInstallSource(sourceAt("2.0.0", "-- two\n")), { projectDir, confirmOverwrite });

		expect(result.success).toBe(true);
		expect(confirmOverwrite).toHaveBeenCalledTimes(1);
		expect(installedLua()).toBe("-- two\n");
	});

	it("replaces an untracked extension after confirmation", async () => {
		installUntracked("1.0.0", "-- one\n");
		const confirmOverwrite = vi.fn(async () => true);

		const result = await install(parseInstallSource(sourceAt("2.0.0", "-- two\n")), { projectDir, confirmOverwrite });

		expect(result.success).toBe(true);
		expect(confirmOverwrite).toHaveBeenCalledTimes(1);
		expect(installedLua()).toBe("-- two\n");
		expect(getInstalledState(installedDir()).kind).toBe("unmodified");
	});

	it("reports that it replaced an untracked copy", async () => {
		installUntracked("1.0.0", "-- one\n");

		const result = await install(parseInstallSource(sourceAt("2.0.0", "-- two\n")), { projectDir });

		expect(result.replacedUntracked).toBe(true);
	});

	it("does not report an untracked copy when it replaced a tracked one or installed a new one", async () => {
		const first = await install(parseInstallSource(sourceAt("1.0.0", "-- one\n")), { projectDir });
		const second = await install(parseInstallSource(sourceAt("2.0.0", "-- two\n")), { projectDir });

		expect(first.replacedUntracked).toBeUndefined();
		expect(second.replacedUntracked).toBeUndefined();
	});

	it("writes nothing for the same version and reports unchanged", async () => {
		await installTracked("1.0.0", "-- one\n");
		const recordBefore = fs.readFileSync(path.join(installedDir(), SOURCE_RECORD_FILENAME), "utf-8");
		const confirmOverwrite = vi.fn(async () => true);

		const result = await install(parseInstallSource(sourceAt("1.0", "-- other\n")), { projectDir, confirmOverwrite });

		expect(result.success).toBe(true);
		expect(result.unchanged).toBe(true);
		expect(result.filesCreated).toEqual([]);
		expect(result.extension.directory).toBe(installedDir());
		expect(confirmOverwrite).not.toHaveBeenCalled();
		expect(installedLua()).toBe("-- one\n");
		expect(fs.readFileSync(path.join(installedDir(), SOURCE_RECORD_FILENAME), "utf-8")).toBe(recordBefore);
	});

	it("writes nothing for an untracked copy at the same version", async () => {
		installUntracked("1.0.0", "-- one\n");

		const result = await install(parseInstallSource(sourceAt("v1", "-- other\n")), { projectDir });

		expect(result.unchanged).toBe(true);
		expect(installedLua()).toBe("-- one\n");
		expect(fs.existsSync(path.join(installedDir(), SOURCE_RECORD_FILENAME))).toBe(false);
	});

	it("force reinstalls the same version", async () => {
		await installTracked("1.0.0", "-- one\n");
		fs.writeFileSync(path.join(installedDir(), "demo.lua"), "-- edited\n");

		const result = await install(parseInstallSource(sourceAt("1.0.0", "-- one\n")), { projectDir, force: true });

		expect(result.success).toBe(true);
		expect(result.unchanged).toBeUndefined();
		expect(installedLua()).toBe("-- one\n");
		expect(getInstalledState(installedDir()).kind).toBe("unmodified");
	});

	it("dry run with force is refused", async () => {
		const attempt = install(parseInstallSource("owner/repo"), { projectDir, dryRun: true, force: true });

		await expect(attempt).rejects.toBeInstanceOf(ExtensionError);
		await expect(attempt).rejects.toThrow("The dryRun option cannot be combined with the force option");
		expect(downloadGitHubArchive).not.toHaveBeenCalled();
		expect(fs.readdirSync(projectDir)).toEqual([]);
	});
});
