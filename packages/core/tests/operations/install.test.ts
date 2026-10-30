/**
 * Tests for extension installation operations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parseInstallSource, formatInstallSource, type InstallSource } from "../../src/operations/install.js";
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
			force: true,
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
		const manifest = fs.readFileSync(path.join(projectDir, "_extensions", "owner", "y", "_extension.yml"), "utf-8");
		expect(manifest).toContain("source: owner/repo/b@fed9876");
	});

	it("records owner/repo/b@<ref> as the source", async () => {
		await installFrom("owner/repo/b");

		const manifest = fs.readFileSync(path.join(projectDir, "_extensions", "owner", "y", "_extension.yml"), "utf-8");
		expect(manifest).toContain(`source: owner/repo/b@${SUBDIRECTORY_REPOSITORY_TAG}`);
	});
});
