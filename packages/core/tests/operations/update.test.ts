/**
 * Tests for extension update operations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { applyUpdates, checkForUpdates, update, type UpdateInfo } from "../../src/operations/update.js";
import {
	AuthenticationError,
	CancellationError,
	NetworkError,
	RateLimitError,
	RepositoryNotFoundError,
} from "../../src/errors.js";

vi.mock("../../src/registry/fetcher.js", () => ({
	fetchRegistry: vi.fn(),
}));

vi.mock("../../src/github/releases.js", async () => {
	const actual = await vi.importActual<typeof import("../../src/github/releases.js")>("../../src/github/releases.js");
	return {
		...actual,
		fetchReleases: vi.fn().mockResolvedValue([]),
		fetchTags: vi.fn().mockResolvedValue([]),
		fetchLatestCommit: vi.fn().mockResolvedValue(null),
		compareCommits: vi.fn(),
	};
});

vi.mock("../../src/github/download.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/github/download.js")>()),
	downloadGitHubArchive: vi.fn(),
}));

vi.mock("../../src/github/raw.js", () => ({
	fetchRawFile: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../src/operations/install.js", async () => {
	const actual = await vi.importActual<typeof import("../../src/operations/install.js")>(
		"../../src/operations/install.js",
	);
	return { ...actual, install: vi.fn() };
});

import { fetchRegistry } from "../../src/registry/fetcher.js";
import { install, parseInstallSource } from "../../src/operations/install.js";
import type { InstallTarget } from "../../src/operations/source.js";
import { formatGitHubLocator } from "../../src/types/manifest.js";
import type { InstalledExtension } from "../../src/filesystem/discovery.js";
import { readSourceRecord, writeSourceRecord, type SourceRecord } from "../../src/filesystem/sourceRecord.js";
import { compareCommits, fetchLatestCommit, fetchReleases, fetchTags } from "../../src/github/releases.js";
import { resolveVersion } from "../../src/github/resolve.js";
import { fetchRawFile } from "../../src/github/raw.js";
import { downloadGitHubArchive } from "../../src/github/download.js";
import {
	createSubdirectoryRepositoryArchive,
	SUBDIRECTORY_REPOSITORY_TAG,
} from "../fixtures/subdirectory-repository.js";
import type { GitHubRelease, GitHubTag } from "../../src/github/releases.js";

const TOKEN = { githubToken: "token", httpHeaders: [] };

function release(tagName: string): GitHubRelease {
	return {
		tagName,
		name: tagName,
		zipballUrl: `https://api.github.com/repos/owner/repo/zipball/${tagName}`,
		tarballUrl: `https://api.github.com/repos/owner/repo/tarball/${tagName}`,
		htmlUrl: `https://github.com/quarto-ext/fontawesome/releases/tag/${tagName}`,
		publishedAt: "",
		prerelease: false,
		draft: false,
	};
}

function tag(name: string): GitHubTag {
	return { name, sha: "abc", zipballUrl: `zip/${name}`, tarballUrl: `tar/${name}` };
}

function registryEntry(fullName: string, fields: Record<string, unknown>): Record<string, unknown> {
	return {
		fullName,
		latestVersion: null,
		latestTag: null,
		latestReleaseUrl: null,
		latestCommit: null,
		htmlUrl: `https://github.com/${fullName}`,
		...fields,
	};
}

function installSource(text: string): InstallTarget["source"] {
	return parseInstallSource(text, () => false);
}

/** Source that an update installs, as `<locator>@<tag or full commit>`. */
function targetText(update: UpdateInfo | undefined): string | undefined {
	if (!update) {
		return undefined;
	}
	const { source } = update.target;
	if (source.type !== "github") {
		return undefined;
	}
	const { version } = source;
	const ref = version.type === "tag" ? version.tag : version.type === "commit" ? version.commit : version.type;
	return `${formatGitHubLocator(source)}@${ref}`;
}

describe("checkForUpdates", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qw-update-test-"));
		vi.clearAllMocks();
		vi.mocked(fetchReleases).mockResolvedValue([]);
		vi.mocked(fetchTags).mockResolvedValue([]);
		vi.mocked(fetchLatestCommit).mockResolvedValue(null);
		vi.mocked(fetchRawFile).mockResolvedValue(null);
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	function setupExtension(
		owner: string,
		name: string,
		version: string,
		source?: string,
		sourceType?: string,
		projectDir = tempDir,
	): void {
		const extDir = path.join(projectDir, "_extensions", owner, name);
		fs.mkdirSync(extDir, { recursive: true });

		let manifest = `title: ${name}\nversion: ${version}\n`;
		if (source) {
			manifest += `source: ${source}\n`;
		}
		if (sourceType) {
			manifest += `source-type: ${sourceType}\n`;
		}

		fs.writeFileSync(path.join(extDir, "_extension.yml"), manifest);
	}

	function setupRecordedExtension(
		owner: string,
		name: string,
		version: string,
		record: string,
		projectDir = tempDir,
	): string {
		const extDir = path.join(projectDir, "_extensions", owner, name);
		fs.mkdirSync(extDir, { recursive: true });
		fs.writeFileSync(path.join(extDir, "_extension.yml"), `title: ${name}\nversion: ${version}\n`);
		fs.writeFileSync(path.join(extDir, ".quarto-source.yml"), record);
		return extDir;
	}

	/** Install record of a GitHub source, with its update mode and its commit when set. */
	function githubRecord(source: string, track: "tag" | "branch", commit?: string): string {
		const ref = source.includes("@") ? `ref: ${source.slice(source.lastIndexOf("@") + 1)}\n` : "";
		const commitLine = commit ? `  commit: ${commit}\n` : "";
		return `version: 1\nsource: ${source}\n${ref}kind: github\nfiles: {}\nquarto-wizard:\n  track: ${track}\n${commitLine}`;
	}

	describe("registry check", () => {
		it("uses the registry without a token", async () => {
			setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome@v1.0.0");

			vi.mocked(fetchRegistry).mockResolvedValue({
				"quarto-ext/fontawesome": registryEntry("quarto-ext/fontawesome", {
					latestVersion: "2.0.0",
					latestTag: "v2.0.0",
					latestReleaseUrl: "https://github.com/quarto-ext/fontawesome/releases/tag/v2.0.0",
				}),
			} as never);

			const result = await checkForUpdates({ projectDirs: [tempDir] });

			expect(result.checkedOn).toBe("registry");
			expect(fetchReleases).not.toHaveBeenCalled();
			expect(result.updates).toHaveLength(1);
			const [found] = result.updates;
			expect(found?.checkedOn).toBe("registry");
			expect(found?.projectDir).toBe(tempDir);
			expect(found?.currentVersion).toBe("1.0.0");
			expect(found?.latestVersion).toBe("2.0.0");
			expect(found?.latestRef).toBe("v2.0.0");
			expect(found?.refKind).toBe("tag");
			expect(found?.releaseUrl).toBe("https://github.com/quarto-ext/fontawesome/releases/tag/v2.0.0");
			expect(targetText(found)).toBe("quarto-ext/fontawesome@v2.0.0");
		});

		it("does not report an update when already at latest", async () => {
			setupExtension("quarto-ext", "fontawesome", "2.0.0", "quarto-ext/fontawesome@v2.0.0");

			vi.mocked(fetchRegistry).mockResolvedValue({
				"quarto-ext/fontawesome": registryEntry("quarto-ext/fontawesome", {
					latestVersion: "2.0.0",
					latestTag: "v2.0.0",
				}),
			} as never);

			const result = await checkForUpdates({ projectDirs: [tempDir] });

			expect(result.updates).toHaveLength(0);
		});

		it("skips extensions without source", async () => {
			setupExtension("quarto-ext", "fontawesome", "1.0.0");

			const result = await checkForUpdates({ projectDirs: [tempDir] });

			expect(fetchRegistry).not.toHaveBeenCalled();
			expect(result.updates).toHaveLength(0);
		});

		it("checks a specific extension when provided", async () => {
			setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome");
			setupExtension("quarto-ext", "lightbox", "1.0.0", "quarto-ext/lightbox");

			vi.mocked(fetchRegistry).mockResolvedValue({
				"quarto-ext/fontawesome": registryEntry("quarto-ext/fontawesome", {
					latestVersion: "2.0.0",
					latestTag: "v2.0.0",
				}),
				"quarto-ext/lightbox": registryEntry("quarto-ext/lightbox", { latestVersion: "2.0.0", latestTag: "v2.0.0" }),
			} as never);

			const result = await checkForUpdates({
				projectDirs: [tempDir],
				extension: { owner: "quarto-ext", name: "fontawesome" },
			});

			expect(result.updates).toHaveLength(1);
			expect(result.updates[0]?.extension.id.name).toBe("fontawesome");
		});

		it("handles a version prefixed with v", async () => {
			setupExtension("quarto-ext", "fontawesome", "v1.0.0", "quarto-ext/fontawesome");

			vi.mocked(fetchRegistry).mockResolvedValue({
				"quarto-ext/fontawesome": registryEntry("quarto-ext/fontawesome", {
					latestVersion: "v2.0.0",
					latestTag: "v2.0.0",
				}),
			} as never);

			const result = await checkForUpdates({ projectDirs: [tempDir] });

			expect(result.updates).toHaveLength(1);
			expect(result.updates[0]?.currentVersion).toBe("1.0.0");
			expect(result.updates[0]?.latestVersion).toBe("2.0.0");
		});

		it("looks up the registry without regard to case", async () => {
			setupExtension("Quarto-Ext", "FontAwesome", "1.0.0", "Quarto-Ext/FontAwesome");

			vi.mocked(fetchRegistry).mockResolvedValue({
				"quarto-ext/fontawesome": registryEntry("quarto-ext/fontawesome", {
					latestVersion: "2.0.0",
					latestTag: "v2.0.0",
				}),
			} as never);

			const result = await checkForUpdates({ projectDirs: [tempDir] });

			expect(result.updates).toHaveLength(1);
		});

		it("returns no update for no installed extensions", async () => {
			const result = await checkForUpdates({ projectDirs: [tempDir] });

			expect(result.updates).toHaveLength(0);
			expect(result.repositoryFailures).toHaveLength(0);
			expect(result.checkFailure).toBeUndefined();
		});

		it("finds updates for a registry-sourced extension with a version ref", async () => {
			setupExtension("mcanouil", "remember", "1.0.0", "mcanouil/quarto-remember@1.0.0", "registry");

			vi.mocked(fetchRegistry).mockResolvedValue({
				"mcanouil/quarto-remember": registryEntry("mcanouil/quarto-remember", {
					latestVersion: "1.1.0",
					latestTag: "1.1.0",
				}),
			} as never);

			const result = await checkForUpdates({ projectDirs: [tempDir] });

			expect(result.updates).toHaveLength(1);
			expect(targetText(result.updates[0])).toBe("mcanouil/quarto-remember@1.1.0");
		});

		it("uses the registry for a github-sourced extension that the registry lists", async () => {
			setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome", "github");

			vi.mocked(fetchRegistry).mockResolvedValue({
				"quarto-ext/fontawesome": registryEntry("quarto-ext/fontawesome", {
					latestVersion: "2.0.0",
					latestTag: "v2.0.0",
				}),
			} as never);

			const result = await checkForUpdates({ projectDirs: [tempDir] });

			expect(fetchReleases).not.toHaveBeenCalled();
			expect(result.updates[0]?.checkedOn).toBe("registry");
		});

		it("reports the latest tag when the installed version is not a version", async () => {
			setupExtension("quarto-ext", "fontawesome", "1.0.0.9000", "quarto-ext/fontawesome@v1.0.0");

			vi.mocked(fetchRegistry).mockResolvedValue({
				"quarto-ext/fontawesome": registryEntry("quarto-ext/fontawesome", {
					latestVersion: "1.2.0",
					latestTag: "v1.2.0",
				}),
			} as never);

			const result = await checkForUpdates({ projectDirs: [tempDir] });

			expect(result.updates).toHaveLength(1);
			const [found] = result.updates;
			expect(found?.checkedOn).toBe("registry");
			expect(found?.currentVersion).toBe("1.0.0.9000");
			expect(found?.latestRef).toBe("v1.2.0");
			expect(targetText(found)).toBe("quarto-ext/fontawesome@v1.2.0");
		});

		it("does not offer a registry tag equal to the first three parts of a four-part version", async () => {
			setupExtension("quarto-ext", "fontawesome", "1.0.0.9000", "quarto-ext/fontawesome");

			vi.mocked(fetchRegistry).mockResolvedValue({
				"quarto-ext/fontawesome": registryEntry("quarto-ext/fontawesome", {
					latestVersion: "1.0.0",
					latestTag: "v1.0.0",
				}),
			} as never);

			const result = await checkForUpdates({ projectDirs: [tempDir] });

			expect(result.updates).toHaveLength(0);
		});

		it("does not offer the installed registry tag again when the installed version is not a version", async () => {
			setupExtension("quarto-ext", "fontawesome", "dev", "quarto-ext/fontawesome@v1.2.0");

			vi.mocked(fetchRegistry).mockResolvedValue({
				"quarto-ext/fontawesome": registryEntry("quarto-ext/fontawesome", {
					latestVersion: "1.2.0",
					latestTag: "v1.2.0",
				}),
			} as never);

			const result = await checkForUpdates({ projectDirs: [tempDir] });

			expect(result.updates).toHaveLength(0);
		});

		it("does not offer a registry prerelease when the installed version is not a version", async () => {
			setupExtension("quarto-ext", "fontawesome", "dev", "quarto-ext/fontawesome@v1.0.0");

			vi.mocked(fetchRegistry).mockResolvedValue({
				"quarto-ext/fontawesome": registryEntry("quarto-ext/fontawesome", {
					latestVersion: "2.0.0-beta.1",
					latestTag: "v2.0.0-beta.1",
				}),
			} as never);

			const result = await checkForUpdates({ projectDirs: [tempDir] });

			expect(result.updates).toHaveLength(0);
		});

		it("does not offer a registry prerelease to a stable install", async () => {
			setupExtension("quarto-ext", "fontawesome", "1.2.0", "quarto-ext/fontawesome@v1.2.0");

			vi.mocked(fetchRegistry).mockResolvedValue({
				"quarto-ext/fontawesome": registryEntry("quarto-ext/fontawesome", {
					latestVersion: "1.3.0-beta.1",
					latestTag: "v1.3.0-beta.1",
				}),
			} as never);

			const result = await checkForUpdates({ projectDirs: [tempDir] });

			expect(result.updates).toHaveLength(0);
		});

		it("offers a registry prerelease to a prerelease install", async () => {
			setupExtension("quarto-ext", "fontawesome", "1.3.0-beta.0", "quarto-ext/fontawesome@v1.3.0-beta.0");

			vi.mocked(fetchRegistry).mockResolvedValue({
				"quarto-ext/fontawesome": registryEntry("quarto-ext/fontawesome", {
					latestVersion: "1.3.0-beta.1",
					latestTag: "v1.3.0-beta.1",
				}),
			} as never);

			const result = await checkForUpdates({ projectDirs: [tempDir] });

			expect(result.updates).toHaveLength(1);
			expect(result.updates[0]?.latestRef).toBe("v1.3.0-beta.1");
		});

		it("reports an unavailable registry as a check failure", async () => {
			setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome");

			vi.mocked(fetchRegistry).mockRejectedValue(
				new NetworkError("HTTP 503: Service Unavailable", { statusCode: 503 }),
			);

			const result = await checkForUpdates({ projectDirs: [tempDir] });

			expect(result.checkFailure?.kind).toBe("registry-unavailable");
			expect(result.checkFailure?.message).toContain("HTTP 503");
			expect(result.updates).toHaveLength(0);
			expect(fetchReleases).not.toHaveBeenCalled();
		});

		it("uses GitHub without a token for an extension missing from the registry", async () => {
			setupExtension("unknown", "extension", "1.0.0", "unknown/extension");

			vi.mocked(fetchRegistry).mockResolvedValue({} as never);
			vi.mocked(fetchTags).mockResolvedValue([tag("v1.1.0")]);

			const result = await checkForUpdates({ projectDirs: [tempDir] });

			expect(result.checkedOn).toBe("registry");
			expect(fetchReleases).toHaveBeenCalledWith("unknown", "extension", expect.anything());
			expect(result.updates).toHaveLength(1);
			expect(result.updates[0]?.checkedOn).toBe("github");
			expect(targetText(result.updates[0])).toBe("unknown/extension@v1.1.0");
		});
	});

	describe("GitHub check", () => {
		it("uses GitHub when a token is set", async () => {
			setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome@v1.0.0");

			vi.mocked(fetchReleases).mockResolvedValue([release("v2.5.0")]);

			const result = await checkForUpdates({ projectDirs: [tempDir], auth: TOKEN });

			expect(fetchRegistry).not.toHaveBeenCalled();
			expect(result.checkedOn).toBe("github");
			expect(result.updates).toHaveLength(1);
			const [found] = result.updates;
			expect(found?.checkedOn).toBe("github");
			expect(found?.latestVersion).toBe("2.5.0");
			expect(found?.latestRef).toBe("v2.5.0");
			expect(found?.refKind).toBe("tag");
			expect(found?.releaseUrl).toBe("https://github.com/quarto-ext/fontawesome/releases/tag/v2.5.0");
		});

		it("source github ignores the registry", async () => {
			setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome", "registry");

			vi.mocked(fetchTags).mockResolvedValue([tag("v3.0.0")]);

			const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

			expect(fetchRegistry).not.toHaveBeenCalled();
			expect(result.checkedOn).toBe("github");
			expect(result.updates).toHaveLength(1);
			expect(result.updates[0]?.latestVersion).toBe("3.0.0");
			expect(result.updates[0]?.releaseUrl).toBe("https://github.com/quarto-ext/fontawesome");
		});

		it("never resolves to a lower version", async () => {
			setupExtension("quarto-ext", "fontawesome", "3.0.0", "quarto-ext/fontawesome@v3.0.0");

			vi.mocked(fetchTags).mockResolvedValue([tag("v2.9.0")]);

			const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

			expect(result.updates).toHaveLength(0);
		});

		it("reports the latest tag when the installed version is not a version", async () => {
			setupExtension("quarto-ext", "fontawesome", "1.0.0.9000", "quarto-ext/fontawesome@v1.0.0", "github");

			vi.mocked(fetchTags).mockResolvedValue([tag("v1.2.0"), tag("v1.1.0"), tag("v2.0.0-beta.1")]);

			const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

			expect(result.updates).toHaveLength(1);
			const [found] = result.updates;
			expect(found?.refKind).toBe("tag");
			expect(found?.currentVersion).toBe("1.0.0.9000");
			expect(found?.latestVersion).toBe("1.2.0");
			expect(found?.latestRef).toBe("v1.2.0");
			expect(targetText(found)).toBe("quarto-ext/fontawesome@v1.2.0");
		});

		it("does not offer the installed tag again when the installed version is not a version", async () => {
			setupExtension("quarto-ext", "fontawesome", "dev", "quarto-ext/fontawesome@V1.2.0", "github");
			setupExtension("quarto-ext", "lightbox", "dev", "quarto-ext/lightbox@1.2.0", "github");

			vi.mocked(fetchTags).mockResolvedValue([tag("v1.2.0"), tag("v1.1.0")]);

			const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

			expect(result.updates).toHaveLength(0);
		});

		it("does not offer a tag equal to the first three parts of a four-part version", async () => {
			setupExtension("quarto-ext", "fontawesome", "1.0.0.9000", "quarto-ext/fontawesome", "github");

			vi.mocked(fetchTags).mockResolvedValue([tag("v1.0.0"), tag("v0.9.0")]);

			const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

			expect(result.updates).toHaveLength(0);
		});

		it("does not offer a tag lower than the recorded tag when the installed version is not a version", async () => {
			setupExtension("quarto-ext", "fontawesome", "dev", "quarto-ext/fontawesome@v1.3.0", "github");

			vi.mocked(fetchTags).mockResolvedValue([tag("v1.2.0"), tag("v1.1.0")]);

			const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

			expect(result.updates).toHaveLength(0);
		});

		it("does not count a non-numeric fourth part as ahead of the tag", async () => {
			setupExtension("quarto-ext", "fontawesome", "1.2.3.dev0", "quarto-ext/fontawesome@v1.2.0", "github");

			vi.mocked(fetchTags).mockResolvedValue([tag("v1.2.3"), tag("v1.2.0")]);

			const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

			expect(result.updates).toHaveLength(1);
			expect(result.updates[0]?.latestRef).toBe("v1.2.3");
		});

		it("offers the latest tag when an unparsable install records an older tag", async () => {
			setupExtension("quarto-ext", "fontawesome", "dev", "quarto-ext/fontawesome@v1.1.0", "github");

			vi.mocked(fetchTags).mockResolvedValue([tag("v1.2.0"), tag("v1.1.0")]);

			const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

			expect(result.updates).toHaveLength(1);
			expect(result.updates[0]?.latestRef).toBe("v1.2.0");
			expect(targetText(result.updates[0])).toBe("quarto-ext/fontawesome@v1.2.0");
		});

		it("resolves each repository once across project roots", async () => {
			const roots = ["a", "b", "c"].map((name) => path.join(tempDir, name));
			for (const root of roots) {
				setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome@v1.0.0", "github", root);
			}

			vi.mocked(fetchReleases).mockResolvedValue([release("v2.0.0")]);

			const result = await checkForUpdates({ projectDirs: roots, source: "github" });

			expect(fetchReleases).toHaveBeenCalledTimes(1);
			expect(fetchTags).toHaveBeenCalledTimes(1);
			expect(result.updates.map((u) => u.projectDir)).toEqual(roots);
		});

		it("update source is owner/repo@latestRef", async () => {
			setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome@v1.0.0", "github");

			vi.mocked(fetchTags).mockResolvedValue([tag("2.0.0")]);

			const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

			expect(fetchReleases).toHaveBeenCalledWith("quarto-ext", "fontawesome", expect.anything());
			expect(result.updates[0]?.latestRef).toBe("2.0.0");
			expect(targetText(result.updates[0])).toBe("quarto-ext/fontawesome@2.0.0");
		});

		describe("for a subdirectory source", () => {
			const SUB_SOURCE = "quarto-ext/monorepo/sub/dir@v1.0.0";

			it("offers an update when the subdirectory manifest version is higher", async () => {
				setupExtension("quarto-ext", "sub", "0.3.0", SUB_SOURCE, "github");

				vi.mocked(fetchTags).mockResolvedValue([tag("v2.0.0")]);
				vi.mocked(fetchRawFile).mockResolvedValue("title: Sub\nversion: 0.4.0\n");

				const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

				expect(fetchRawFile).toHaveBeenCalledWith(
					"quarto-ext",
					"monorepo",
					"v2.0.0",
					"sub/dir/_extension.yml",
					expect.anything(),
				);
				expect(result.updates).toHaveLength(1);
				const [found] = result.updates;
				expect(found?.currentVersion).toBe("0.3.0");
				expect(found?.latestVersion).toBe("0.4.0");
				expect(found?.latestRef).toBe("v2.0.0");
				expect(found?.refKind).toBe("tag");
				expect(found?.checkedOn).toBe("github");
			});

			it("offers no update when the subdirectory manifest version is equal", async () => {
				setupExtension("quarto-ext", "sub", "0.3.0", SUB_SOURCE, "github");

				vi.mocked(fetchTags).mockResolvedValue([tag("v2.0.0")]);
				vi.mocked(fetchRawFile).mockResolvedValue("title: Sub\nversion: 0.3.0\n");

				const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

				expect(fetchRawFile).toHaveBeenCalled();
				expect(result.updates).toHaveLength(0);
			});

			it("offers no prerelease manifest version to a stable install", async () => {
				setupExtension("quarto-ext", "sub", "0.3.0", SUB_SOURCE, "github");

				vi.mocked(fetchTags).mockResolvedValue([tag("v2.0.0")]);
				vi.mocked(fetchRawFile).mockResolvedValue("title: Sub\nversion: 0.4.0-beta.1\n");

				const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

				expect(fetchRawFile).toHaveBeenCalled();
				expect(result.updates).toHaveLength(0);
			});

			it("offers a prerelease manifest version to a prerelease install", async () => {
				setupExtension("quarto-ext", "sub", "0.4.0-alpha.1", SUB_SOURCE, "github");

				vi.mocked(fetchTags).mockResolvedValue([tag("v2.0.0")]);
				vi.mocked(fetchRawFile).mockResolvedValue("title: Sub\nversion: 0.4.0-beta.1\n");

				const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

				expect(result.updates).toHaveLength(1);
				expect(result.updates[0]?.latestVersion).toBe("0.4.0-beta.1");
				expect(result.updates[0]?.latestRef).toBe("v2.0.0");
			});

			it("falls back to the recorded ref when the raw manifest has no version", async () => {
				setupExtension("quarto-ext", "sub", "0.3.0", SUB_SOURCE, "github");
				setupExtension("quarto-ext", "other", "0.3.0", "quarto-ext/current/other@v2.0.0", "github");

				vi.mocked(fetchTags).mockResolvedValue([tag("v2.0.0")]);
				vi.mocked(fetchRawFile).mockResolvedValue("title: Sub\n");

				const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

				expect(result.updates).toHaveLength(1);
				const [found] = result.updates;
				expect(found?.extension.id.name).toBe("sub");
				expect(found?.currentVersion).toBe("0.3.0");
				expect(found?.latestVersion).toBe("2.0.0");
				expect(found?.latestRef).toBe("v2.0.0");
			});

			it("falls back when the raw file answers 404", async () => {
				setupExtension("quarto-ext", "sub", "0.3.0", SUB_SOURCE, "github");

				vi.mocked(fetchTags).mockResolvedValue([tag("v2.0.0")]);
				vi.mocked(fetchRawFile).mockResolvedValue(null);

				const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

				expect(fetchRawFile).toHaveBeenCalledWith(
					"quarto-ext",
					"monorepo",
					"v2.0.0",
					"sub/dir/_extension.yaml",
					expect.anything(),
				);
				expect(result.updates).toHaveLength(1);
				expect(result.updates[0]?.latestVersion).toBe("2.0.0");
				expect(result.updates[0]?.latestRef).toBe("v2.0.0");
			});

			it("falls back to the recorded ref when the raw file read fails", async () => {
				setupExtension("quarto-ext", "sub", "0.3.0", SUB_SOURCE, "github");

				vi.mocked(fetchTags).mockResolvedValue([tag("v2.0.0")]);
				vi.mocked(fetchRawFile).mockRejectedValue(
					new NetworkError("HTTP 503: Service Unavailable", { statusCode: 503 }),
				);

				const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

				expect(result.checkFailure).toBeUndefined();
				expect(result.repositoryFailures).toHaveLength(0);
				expect(result.updates).toHaveLength(1);
				expect(result.updates[0]?.latestVersion).toBe("2.0.0");
				expect(result.updates[0]?.latestRef).toBe("v2.0.0");
			});

			it("a cancelled raw file read rejects the check", async () => {
				setupExtension("quarto-ext", "sub", "0.3.0", SUB_SOURCE, "github");

				vi.mocked(fetchTags).mockResolvedValue([tag("v2.0.0")]);
				vi.mocked(fetchRawFile).mockRejectedValue(new CancellationError());

				await expect(checkForUpdates({ projectDirs: [tempDir], source: "github" })).rejects.toBeInstanceOf(
					CancellationError,
				);
			});

			it("falls back when the raw manifest cannot be parsed", async () => {
				setupExtension("quarto-ext", "sub", "0.3.0", "quarto-ext/monorepo/sub/dir@v2.0.0", "github");

				vi.mocked(fetchTags).mockResolvedValue([tag("v2.0.0")]);
				vi.mocked(fetchRawFile).mockResolvedValue("title: [unclosed\n");

				const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

				expect(result.updates).toHaveLength(0);
				expect(result.repositoryFailures).toHaveLength(0);
			});

			it("reads the default branch manifest when the repository has no version tag", async () => {
				setupExtension("quarto-ext", "sub", "0.3.0", "quarto-ext/monorepo/sub/dir@main", "github");

				vi.mocked(fetchTags).mockResolvedValue([tag("nightly")]);
				vi.mocked(fetchRawFile).mockResolvedValue("title: Sub\nversion: 0.4.0\n");
				vi.mocked(fetchLatestCommit).mockResolvedValue("def5678901234567890abcdef1234567890abcd");

				const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

				expect(fetchRawFile).toHaveBeenCalledWith(
					"quarto-ext",
					"monorepo",
					"HEAD",
					"sub/dir/_extension.yml",
					expect.anything(),
				);
				expect(fetchLatestCommit).toHaveBeenCalledWith(
					"quarto-ext",
					"monorepo",
					expect.objectContaining({ path: "sub/dir" }),
				);
				expect(result.updates).toHaveLength(1);
				const [found] = result.updates;
				expect(found?.latestVersion).toBe("0.4.0");
				expect(found?.latestRef).toBe("def5678");
				expect(found?.refKind).toBe("commit");
				expect(targetText(found)).toBe("quarto-ext/monorepo/sub/dir@def5678901234567890abcdef1234567890abcd");
				expect(found?.target.track).toBe("tag");
				expect(found?.target.recordSource).toBe("quarto-ext/monorepo/sub/dir");
			});

			describe("in branch mode", () => {
				const LATEST_PATH_COMMIT = "def5678901234567890abcdef1234567890abcd";

				beforeEach(() => {
					setupRecordedExtension(
						"quarto-ext",
						"sub",
						"0.3.0",
						githubRecord("quarto-ext/monorepo/sub/dir", "branch", "abc1234567890abcdef1234567890abcdef12345"),
					);
					vi.mocked(fetchLatestCommit).mockResolvedValue(LATEST_PATH_COMMIT);
				});

				it("checks a branch-mode subdirectory source on its path only", async () => {
					vi.mocked(compareCommits).mockResolvedValue("behind");

					await checkForUpdates({ projectDirs: [tempDir], source: "github" });

					expect(fetchLatestCommit).toHaveBeenCalledWith(
						"quarto-ext",
						"monorepo",
						expect.objectContaining({ path: "sub/dir" }),
					);
				});

				it("offers the path commit when the installed commit is behind", async () => {
					vi.mocked(compareCommits).mockResolvedValue("behind");

					const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

					expect(compareCommits).toHaveBeenCalledWith(
						"quarto-ext",
						"monorepo",
						LATEST_PATH_COMMIT,
						"abc1234",
						expect.anything(),
					);
					expect(result.updates).toHaveLength(1);
					const [found] = result.updates;
					expect(found?.refKind).toBe("commit");
					expect(found?.latestRef).toBe("def5678");
					expect(targetText(found)).toBe(`quarto-ext/monorepo/sub/dir@${LATEST_PATH_COMMIT}`);
					expect(found?.target.track).toBe("branch");
					expect(found?.target.recordSource).toBe("quarto-ext/monorepo/sub/dir");
				});

				it("offers the path commit when the installed commit has diverged", async () => {
					vi.mocked(compareCommits).mockResolvedValue("diverged");

					const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

					expect(result.updates.map((u) => u.latestRef)).toEqual(["def5678"]);
				});

				it("no update when the installed commit equals the latest path commit", async () => {
					vi.mocked(fetchLatestCommit).mockResolvedValue("abc1234567890abcdef1234567890abcdef12345");

					const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

					expect(compareCommits).not.toHaveBeenCalled();
					expect(result.updates).toHaveLength(0);
				});

				it("no update when the installed commit is ahead of the latest path commit", async () => {
					vi.mocked(compareCommits).mockResolvedValue("ahead");

					const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

					expect(compareCommits).toHaveBeenCalledTimes(1);
					expect(result.updates).toHaveLength(0);
				});

				it("a compare that cannot find a commit offers no update and does not fail the check", async () => {
					vi.mocked(compareCommits).mockRejectedValue(new NetworkError("HTTP 404: Not Found", { statusCode: 404 }));

					const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

					expect(result.updates).toHaveLength(0);
					expect(result.checkFailure).toBeUndefined();
					expect(result.repositoryFailures).toHaveLength(0);
				});

				it("a rate-limited compare fails the check", async () => {
					vi.mocked(compareCommits).mockRejectedValue(
						new RateLimitError("HTTP 403: rate limit exceeded for quarto-ext/monorepo", { statusCode: 403 }),
					);

					const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

					expect(result.updates).toHaveLength(0);
					expect(result.checkFailure?.kind).toBe("rate-limited");
				});

				it("a compare that loses the server fails the check as a network failure", async () => {
					vi.mocked(compareCommits).mockRejectedValue(new NetworkError("HTTP 502: Bad Gateway", { statusCode: 502 }));

					const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

					expect(result.checkFailure?.kind).toBe("network");
				});

				it("a cancelled compare rejects the check", async () => {
					vi.mocked(compareCommits).mockRejectedValue(new CancellationError());

					await expect(checkForUpdates({ projectDirs: [tempDir], source: "github" })).rejects.toBeInstanceOf(
						CancellationError,
					);
				});

				it("offers the head of a hex-named branch when the record has no commit", async () => {
					setupRecordedExtension(
						"quarto-ext",
						"hexsub",
						"0.3.0",
						githubRecord("quarto-ext/monorepo/sub/dir@cafe123", "branch"),
					);
					vi.mocked(fetchLatestCommit).mockResolvedValue("cafe123901234567890abcdef1234567890abcd");

					const result = await checkForUpdates({
						projectDirs: [tempDir],
						extension: { owner: "quarto-ext", name: "hexsub" },
						source: "github",
					});

					expect(compareCommits).not.toHaveBeenCalled();
					expect(result.updates).toHaveLength(1);
					const [found] = result.updates;
					expect(found?.currentVersion).toBe("0.3.0");
					expect(found?.latestRef).toBe("cafe123");
					expect(found?.target.recordSource).toBe("quarto-ext/monorepo/sub/dir@cafe123");
				});
			});

			it("never looks a subdirectory source up in the registry", async () => {
				setupExtension("quarto-ext", "sub", "0.3.0", SUB_SOURCE, "github");

				vi.mocked(fetchRegistry).mockResolvedValue({
					"quarto-ext/monorepo": registryEntry("quarto-ext/monorepo", {
						latestVersion: "9.0.0",
						latestTag: "v9.0.0",
					}),
				} as never);
				vi.mocked(fetchTags).mockResolvedValue([tag("v2.0.0")]);
				vi.mocked(fetchRawFile).mockResolvedValue("title: Sub\nversion: 0.4.0\n");

				const result = await checkForUpdates({ projectDirs: [tempDir] });

				expect(fetchRegistry).not.toHaveBeenCalled();
				expect(fetchTags).toHaveBeenCalledWith("quarto-ext", "monorepo", expect.anything());
				expect(result.updates).toHaveLength(1);
				const [found] = result.updates;
				expect(found?.checkedOn).toBe("github");
				expect(found?.latestVersion).toBe("0.4.0");
				expect(found?.latestRef).toBe("v2.0.0");
			});

			it("checks a subdirectory source on GitHub when a root source of the same repository uses the registry", async () => {
				setupExtension("quarto-ext", "root", "1.0.0", "quarto-ext/monorepo@v1.0.0", "github");
				setupExtension("quarto-ext", "sub", "0.3.0", SUB_SOURCE, "github");

				vi.mocked(fetchRegistry).mockResolvedValue({
					"quarto-ext/monorepo": registryEntry("quarto-ext/monorepo", {
						latestVersion: "9.0.0",
						latestTag: "v9.0.0",
					}),
				} as never);
				vi.mocked(fetchTags).mockResolvedValue([tag("v2.0.0")]);
				vi.mocked(fetchRawFile).mockResolvedValue("title: Sub\nversion: 0.4.0\n");

				const result = await checkForUpdates({ projectDirs: [tempDir] });

				expect(fetchRegistry).toHaveBeenCalledTimes(1);
				const byName = Object.fromEntries(result.updates.map((u) => [u.extension.id.name, u]));
				expect(Object.keys(byName).sort()).toEqual(["root", "sub"]);
				expect(byName.root).toMatchObject({ checkedOn: "registry", latestVersion: "9.0.0", latestRef: "v9.0.0" });
				expect(byName.sub).toMatchObject({ checkedOn: "github", latestVersion: "0.4.0", latestRef: "v2.0.0" });
				expect(fetchRawFile).toHaveBeenCalledWith(
					"quarto-ext",
					"monorepo",
					"v2.0.0",
					"sub/dir/_extension.yml",
					expect.anything(),
				);
			});

			it("reads the manifest under the _extensions folder of the subdirectory", async () => {
				setupExtension("quarto-ext", "y", "1.0.0", "quarto-ext/monorepo/b@v1.0.0", "github");

				vi.mocked(fetchTags).mockResolvedValue([tag("v3.0.0")]);
				vi.mocked(fetchRawFile).mockImplementation(async (_owner, _repo, _ref, filePath) =>
					filePath === "b/_extensions/y/_extension.yml" ? "title: Y\nversion: 1.1.0\n" : null,
				);

				const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

				expect(result.updates).toHaveLength(1);
				expect(result.updates[0]?.latestVersion).toBe("1.1.0");
				expect(result.updates[0]?.latestRef).toBe("v3.0.0");
				const paths = vi.mocked(fetchRawFile).mock.calls.map((call) => call[3]);
				expect(paths).toEqual([
					"b/_extension.yml",
					"b/_extension.yaml",
					"b/_extensions/y/_extension.yml",
					"b/_extensions/y/_extension.yaml",
					"b/_extensions/quarto-ext/y/_extension.yml",
					"b/_extensions/quarto-ext/y/_extension.yaml",
				]);
			});

			it("asks for every manifest path at once and keeps the first one found in order", async () => {
				setupExtension("quarto-ext", "y", "1.0.0", "quarto-ext/monorepo/b@v1.0.0", "github");

				vi.mocked(fetchTags).mockResolvedValue([tag("v3.0.0")]);
				const contents: Record<string, string> = {
					"b/_extensions/y/_extension.yml": "title: Y\nversion: 1.1.0\n",
					"b/_extensions/quarto-ext/y/_extension.yml": "title: Y\nversion: 1.2.0\n",
				};
				let requestsWhenFirstAnswered = 0;
				vi.mocked(fetchRawFile).mockImplementation(async (_owner, _repo, _ref, filePath) => {
					if (filePath === "b/_extension.yml" || filePath === "b/_extensions/y/_extension.yml") {
						await new Promise((resolve) => setTimeout(resolve, 20));
					}
					if (filePath === "b/_extension.yml") {
						requestsWhenFirstAnswered = vi.mocked(fetchRawFile).mock.calls.length;
					}
					return contents[filePath] ?? null;
				});

				const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

				expect(requestsWhenFirstAnswered).toBe(6);
				expect(result.updates).toHaveLength(1);
				expect(result.updates[0]?.latestVersion).toBe("1.1.0");
			});

			it("reads the manifest under the owner folder of the subdirectory _extensions folder", async () => {
				setupExtension("quarto-ext", "y", "1.0.0", "quarto-ext/monorepo/b@v1.0.0", "github");

				vi.mocked(fetchTags).mockResolvedValue([tag("v3.0.0")]);
				vi.mocked(fetchRawFile).mockImplementation(async (_owner, _repo, _ref, filePath) =>
					filePath === "b/_extensions/quarto-ext/y/_extension.yaml" ? "title: Y\nversion: 1.1.0\n" : null,
				);

				const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

				expect(result.updates).toHaveLength(1);
				expect(result.updates[0]?.latestVersion).toBe("1.1.0");
			});

			it("reads each extension manifest when two extensions come from the same subdirectory", async () => {
				setupExtension("quarto-ext", "y", "1.0.0", "quarto-ext/monorepo/b@v1.0.0", "github");
				setupExtension("quarto-ext", "z", "1.0.0", "quarto-ext/monorepo/b@v1.0.0", "github");

				vi.mocked(fetchTags).mockResolvedValue([tag("v3.0.0")]);
				vi.mocked(fetchRawFile).mockImplementation(async (_owner, _repo, _ref, filePath) => {
					if (filePath === "b/_extensions/y/_extension.yml") {
						return "title: Y\nversion: 1.1.0\n";
					}
					if (filePath === "b/_extensions/z/_extension.yml") {
						return "title: Z\nversion: 1.2.0\n";
					}
					return null;
				});

				const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

				const byName = Object.fromEntries(result.updates.map((u) => [u.extension.id.name, u.latestVersion]));
				expect(byName).toEqual({ y: "1.1.0", z: "1.2.0" });
			});

			it("requests each manifest path once when two extensions come from the same subdirectory", async () => {
				setupExtension("quarto-ext", "y", "1.0.0", "quarto-ext/monorepo/b@v1.0.0", "github");
				setupExtension("quarto-ext", "z", "1.0.0", "quarto-ext/monorepo/b@v1.0.0", "github");

				vi.mocked(fetchTags).mockResolvedValue([tag("v3.0.0")]);
				const contents: Record<string, string> = {
					"b/_extensions/y/_extension.yml": "title: Y\nversion: 1.1.0\n",
					"b/_extensions/z/_extension.yml": "title: Z\nversion: 1.2.0\n",
				};
				vi.mocked(fetchRawFile).mockImplementation(async (_owner, _repo, _ref, filePath) => contents[filePath] ?? null);

				const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

				const requests = vi.mocked(fetchRawFile).mock.calls.map((call) => `${call[2]}:${call[3]}`);
				expect(new Set(requests).size).toBe(requests.length);
				expect(requests.filter((request) => request === "v3.0.0:b/_extension.yml")).toHaveLength(1);
				expect(requests.filter((request) => request === "v3.0.0:b/_extension.yaml")).toHaveLength(1);
				expect(requests).toContain("v3.0.0:b/_extensions/z/_extension.yml");
				const byName = Object.fromEntries(result.updates.map((u) => [u.extension.id.name, u.latestVersion]));
				expect(byName).toEqual({ y: "1.1.0", z: "1.2.0" });
			});

			it("reports the subdirectory manifest version when the installed version is not a version", async () => {
				setupExtension("quarto-ext", "sub", "1.0.0.9000", SUB_SOURCE, "github");

				vi.mocked(fetchTags).mockResolvedValue([tag("v3.0.0")]);
				vi.mocked(fetchRawFile).mockResolvedValue("title: Sub\nversion: 2.0.0\n");

				const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

				expect(result.updates).toHaveLength(1);
				expect(result.updates[0]?.latestVersion).toBe("2.0.0");
				expect(result.updates[0]?.latestRef).toBe("v3.0.0");
			});

			it("offers no update below a development install when the manifest version is its first three parts", async () => {
				setupExtension("quarto-ext", "sub", "1.0.0.9000", SUB_SOURCE, "github");

				vi.mocked(fetchTags).mockResolvedValue([tag("v3.0.0")]);
				vi.mocked(fetchRawFile).mockResolvedValue("title: Sub\nversion: 1.0.0\n");

				const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

				expect(fetchRawFile).toHaveBeenCalled();
				expect(result.updates).toHaveLength(0);
			});

			it("offers no update below the recorded tag when the installed version is not a version", async () => {
				setupExtension("quarto-ext", "sub", "dev", SUB_SOURCE, "github");

				vi.mocked(fetchTags).mockResolvedValue([tag("v3.0.0")]);
				vi.mocked(fetchRawFile).mockResolvedValue("title: Sub\nversion: 0.9.0\n");

				const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

				expect(fetchRawFile).toHaveBeenCalled();
				expect(result.updates).toHaveLength(0);
			});

			it("checks a subdirectory source on GitHub when the registry is unavailable", async () => {
				setupExtension("quarto-ext", "root", "1.0.0", "quarto-ext/monorepo@v1.0.0", "github");
				setupExtension("quarto-ext", "sub", "0.3.0", SUB_SOURCE, "github");

				vi.mocked(fetchRegistry).mockRejectedValue(
					new NetworkError("HTTP 503: Service Unavailable", { statusCode: 503 }),
				);
				vi.mocked(fetchTags).mockResolvedValue([tag("v2.0.0")]);
				vi.mocked(fetchRawFile).mockResolvedValue("title: Sub\nversion: 0.4.0\n");

				const result = await checkForUpdates({ projectDirs: [tempDir] });

				expect(result.checkFailure?.kind).toBe("registry-unavailable");
				expect(result.checkFailure?.message).toContain("HTTP 503");
				expect(result.updates.map((u) => u.extension.id.name)).toEqual(["sub"]);
				expect(result.updates[0]).toMatchObject({ checkedOn: "github", latestVersion: "0.4.0", latestRef: "v2.0.0" });
			});

			for (const [kind, error] of [
				["rate-limited", new RateLimitError("HTTP 403: rate limit exceeded", { statusCode: 403 })],
				[
					"unauthorised",
					new AuthenticationError("Bad credentials.", {
						cause: new NetworkError("HTTP 401: Unauthorized", { statusCode: 401 }),
					}),
				],
			] as const) {
				it(`reports the ${kind} failure met on GitHub over an unavailable registry`, async () => {
					setupExtension("quarto-ext", "root", "1.0.0", "quarto-ext/monorepo@v1.0.0", "github");
					setupExtension("quarto-ext", "sub", "0.3.0", SUB_SOURCE, "github");

					vi.mocked(fetchRegistry).mockRejectedValue(
						new NetworkError("HTTP 503: Service Unavailable", { statusCode: 503 }),
					);
					vi.mocked(fetchTags).mockRejectedValue(error);

					const result = await checkForUpdates({ projectDirs: [tempDir] });

					expect(result.checkFailure?.kind).toBe(kind);
					expect(result.updates).toHaveLength(0);
				});
			}

			it("reports GitHub as the check source when every candidate is a subdirectory source", async () => {
				setupExtension("quarto-ext", "sub", "0.3.0", SUB_SOURCE, "github");

				vi.mocked(fetchTags).mockResolvedValue([tag("v2.0.0")]);
				vi.mocked(fetchRawFile).mockResolvedValue("title: Sub\nversion: 0.4.0\n");

				const result = await checkForUpdates({ projectDirs: [tempDir] });

				expect(fetchRegistry).not.toHaveBeenCalled();
				expect(result.checkedOn).toBe("github");
			});

			it("keeps the subdirectory in UpdateInfo.source", async () => {
				setupExtension("quarto-ext", "sub", "0.3.0", SUB_SOURCE, "github");

				vi.mocked(fetchTags).mockResolvedValue([tag("v2.0.0")]);
				vi.mocked(fetchRawFile).mockResolvedValue("title: Sub\nversion: 0.4.0\n");

				const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

				expect(targetText(result.updates[0])).toBe("quarto-ext/monorepo/sub/dir@v2.0.0");
			});

			it("reports a failure against owner/repo", async () => {
				setupExtension("quarto-ext", "sub", "0.3.0", SUB_SOURCE, "github");

				vi.mocked(fetchTags).mockRejectedValue(
					new RepositoryNotFoundError("Repository not found: quarto-ext/monorepo"),
				);

				const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

				expect(result.repositoryFailures.map((f) => f.repository)).toEqual(["quarto-ext/monorepo"]);
			});
		});

		it("never checks updates for url-sourced or local-sourced extensions", async () => {
			setupExtension("vendor", "zipped", "1.0.0", "https://example.com/ext.zip", "url");
			setupExtension("vendor", "local", "1.0.0", "/tmp/my-ext", "local");

			const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

			expect(result.updates).toHaveLength(0);
			expect(fetchReleases).not.toHaveBeenCalled();
			expect(fetchTags).not.toHaveBeenCalled();
		});
	});

	describe("in branch mode", () => {
		const INSTALLED_COMMIT = "ABC1234567890abcdef1234567890abcdef12345";
		const LATEST_COMMIT = "def5678901234567890abcdef1234567890abcd";

		it("compares the recorded commit with the default branch head on GitHub", async () => {
			setupRecordedExtension(
				"quarto-ext",
				"fontawesome",
				"1.0.0",
				githubRecord("quarto-ext/fontawesome", "branch", INSTALLED_COMMIT),
			);
			vi.mocked(fetchTags).mockResolvedValue([tag("v2.0.0")]);
			vi.mocked(fetchLatestCommit).mockResolvedValue(LATEST_COMMIT);

			const result = await checkForUpdates({ projectDirs: [tempDir], auth: TOKEN });

			expect(fetchReleases).not.toHaveBeenCalled();
			expect(fetchTags).not.toHaveBeenCalled();
			expect(fetchLatestCommit).toHaveBeenCalledWith(
				"quarto-ext",
				"fontawesome",
				expect.objectContaining({ ref: undefined, path: undefined }),
			);
			expect(result.updates).toHaveLength(1);
			const [found] = result.updates;
			expect(found?.refKind).toBe("commit");
			expect(found?.currentVersion).toBe("abc1234");
			expect(found?.latestVersion).toBe("def5678");
			expect(found?.latestRef).toBe("def5678");
			expect(found?.checkedOn).toBe("github");
			expect(targetText(found)).toBe(`quarto-ext/fontawesome@${LATEST_COMMIT}`);
			expect(found?.target.track).toBe("branch");
			expect(found?.target.recordSource).toBe("quarto-ext/fontawesome");
		});

		it("compares the default branch with the registry latestCommit", async () => {
			setupRecordedExtension(
				"quarto-ext",
				"fontawesome",
				"1.0.0",
				githubRecord("quarto-ext/fontawesome", "branch", INSTALLED_COMMIT),
			);
			vi.mocked(fetchRegistry).mockResolvedValue({
				"quarto-ext/fontawesome": registryEntry("quarto-ext/fontawesome", {
					latestVersion: "2.0.0",
					latestTag: "v2.0.0",
					latestCommit: LATEST_COMMIT,
				}),
			} as never);

			const result = await checkForUpdates({ projectDirs: [tempDir] });

			expect(fetchLatestCommit).not.toHaveBeenCalled();
			expect(result.updates).toHaveLength(1);
			const [found] = result.updates;
			expect(found?.refKind).toBe("commit");
			expect(found?.latestRef).toBe("def5678");
			expect(found?.checkedOn).toBe("registry");
			expect(found?.releaseUrl).toBe("https://github.com/quarto-ext/fontawesome");
			expect(targetText(found)).toBe(`quarto-ext/fontawesome@${LATEST_COMMIT}`);
			expect(found?.target.track).toBe("branch");
			expect(found?.target.recordSource).toBe("quarto-ext/fontawesome");
		});

		it("checks an explicit branch on GitHub, never in the registry", async () => {
			setupRecordedExtension(
				"quarto-ext",
				"fontawesome",
				"1.0.0",
				githubRecord("quarto-ext/fontawesome@dev", "branch", INSTALLED_COMMIT),
			);
			vi.mocked(fetchLatestCommit).mockResolvedValue(LATEST_COMMIT);

			const result = await checkForUpdates({ projectDirs: [tempDir] });

			expect(fetchRegistry).not.toHaveBeenCalled();
			expect(fetchLatestCommit).toHaveBeenCalledWith(
				"quarto-ext",
				"fontawesome",
				expect.objectContaining({ ref: "dev" }),
			);
			expect(result.checkedOn).toBe("github");
			expect(result.updates).toHaveLength(1);
			const [found] = result.updates;
			expect(found?.checkedOn).toBe("github");
			expect(found?.latestRef).toBe("def5678");
			expect(targetText(found)).toBe(`quarto-ext/fontawesome@${LATEST_COMMIT}`);
			expect(found?.target.track).toBe("branch");
			expect(found?.target.recordSource).toBe("quarto-ext/fontawesome@dev");
		});

		it("offers the branch head when the record has no commit", async () => {
			setupRecordedExtension(
				"quarto-ext",
				"fontawesome",
				"1.0.0",
				githubRecord("quarto-ext/fontawesome@dev", "branch"),
			);
			vi.mocked(fetchLatestCommit).mockResolvedValue(LATEST_COMMIT);

			const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

			expect(result.updates).toHaveLength(1);
			const [found] = result.updates;
			expect(found?.refKind).toBe("commit");
			expect(found?.currentVersion).toBe("1.0.0");
			expect(found?.latestRef).toBe("def5678");
			expect(targetText(found)).toBe(`quarto-ext/fontawesome@${LATEST_COMMIT}`);
			expect(found?.target.recordSource).toBe("quarto-ext/fontawesome@dev");
		});

		it("offers the head of a hex-named branch when the record has no commit", async () => {
			const branchHead = "cafe123901234567890abcdef1234567890abcd";
			setupRecordedExtension(
				"quarto-ext",
				"fontawesome",
				"1.0.0",
				githubRecord("quarto-ext/fontawesome@cafe123", "branch"),
			);
			vi.mocked(fetchLatestCommit).mockResolvedValue(branchHead);

			const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

			expect(fetchLatestCommit).toHaveBeenCalledWith(
				"quarto-ext",
				"fontawesome",
				expect.objectContaining({ ref: "cafe123" }),
			);
			expect(result.updates).toHaveLength(1);
			const [found] = result.updates;
			expect(found?.currentVersion).toBe("1.0.0");
			expect(found?.latestRef).toBe("cafe123");
			expect(targetText(found)).toBe(`quarto-ext/fontawesome@${branchHead}`);
			expect(found?.target.recordSource).toBe("quarto-ext/fontawesome@cafe123");
		});

		it("reports a deleted branch as a repository failure and checks the other extensions", async () => {
			setupRecordedExtension(
				"quarto-ext",
				"fontawesome",
				"1.0.0",
				githubRecord("quarto-ext/fontawesome@dev", "branch", INSTALLED_COMMIT),
			);
			setupExtension("quarto-ext", "lightbox", "1.0.0", "quarto-ext/lightbox@v1.0.0", "github");
			vi.mocked(fetchLatestCommit).mockRejectedValue(
				new RepositoryNotFoundError("Repository not found: quarto-ext/fontawesome"),
			);
			vi.mocked(fetchReleases).mockResolvedValue([release("v2.0.0")]);

			const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

			expect(result.checkFailure).toBeUndefined();
			expect(result.repositoryFailures).toEqual([
				{
					repository: "quarto-ext/fontawesome",
					message: 'Branch "dev" or its repository not found: quarto-ext/fontawesome',
				},
			]);
			expect(result.updates.map((u) => u.extension.id.name)).toEqual(["lightbox"]);
		});

		it("reports no update when the commits match, without regard to case", async () => {
			setupRecordedExtension(
				"quarto-ext",
				"fontawesome",
				"1.0.0",
				githubRecord("quarto-ext/fontawesome", "branch", INSTALLED_COMMIT),
			);
			vi.mocked(fetchRegistry).mockResolvedValue({
				"quarto-ext/fontawesome": registryEntry("quarto-ext/fontawesome", { latestCommit: "abc1234567890abcdef" }),
			} as never);

			const result = await checkForUpdates({ projectDirs: [tempDir] });

			expect(result.updates).toHaveLength(0);
		});

		it("reports no update when the registry has no latestCommit", async () => {
			setupRecordedExtension(
				"quarto-ext",
				"fontawesome",
				"1.0.0",
				githubRecord("quarto-ext/fontawesome", "branch", INSTALLED_COMMIT),
			);
			vi.mocked(fetchRegistry).mockResolvedValue({
				"quarto-ext/fontawesome": registryEntry("quarto-ext/fontawesome", {}),
			} as never);

			const result = await checkForUpdates({ projectDirs: [tempDir] });

			expect(result.updates).toHaveLength(0);
		});

		it("reports no update when the GitHub commit matches", async () => {
			setupRecordedExtension(
				"quarto-ext",
				"fontawesome",
				"1.0.0",
				githubRecord("quarto-ext/fontawesome@dev", "branch", INSTALLED_COMMIT),
			);
			vi.mocked(fetchLatestCommit).mockResolvedValue("abc1234ffff");

			const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

			expect(result.updates).toHaveLength(0);
			expect(fetchLatestCommit).toHaveBeenCalledTimes(1);
		});
	});

	describe("in tag mode", () => {
		const INSTALLED_COMMIT = "ABC1234567890abcdef1234567890abcdef12345";
		const LATEST_COMMIT = "def5678901234567890abcdef1234567890abcd";

		it("follows the default branch while the repository has no version tag", async () => {
			setupRecordedExtension(
				"quarto-ext",
				"fontawesome",
				"1.0.0",
				githubRecord("quarto-ext/fontawesome", "tag", INSTALLED_COMMIT),
			);
			vi.mocked(fetchTags).mockResolvedValue([tag("nightly")]);
			vi.mocked(fetchLatestCommit).mockResolvedValue(LATEST_COMMIT);

			const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

			expect(fetchLatestCommit).toHaveBeenCalledWith(
				"quarto-ext",
				"fontawesome",
				expect.objectContaining({ ref: undefined }),
			);
			expect(result.updates).toHaveLength(1);
			const [found] = result.updates;
			expect(found?.refKind).toBe("commit");
			expect(found?.currentVersion).toBe("abc1234");
			expect(found?.latestRef).toBe("def5678");
			expect(targetText(found)).toBe(`quarto-ext/fontawesome@${LATEST_COMMIT}`);
			expect(found?.target.track).toBe("tag");
			expect(found?.target.recordSource).toBe("quarto-ext/fontawesome");
		});

		it("follows the registry latestCommit while the registry has no tag", async () => {
			setupRecordedExtension(
				"quarto-ext",
				"fontawesome",
				"1.0.0",
				githubRecord("quarto-ext/fontawesome", "tag", INSTALLED_COMMIT),
			);
			vi.mocked(fetchRegistry).mockResolvedValue({
				"quarto-ext/fontawesome": registryEntry("quarto-ext/fontawesome", { latestCommit: LATEST_COMMIT }),
			} as never);

			const result = await checkForUpdates({ projectDirs: [tempDir] });

			expect(fetchLatestCommit).not.toHaveBeenCalled();
			expect(result.updates).toHaveLength(1);
			const [found] = result.updates;
			expect(found?.refKind).toBe("commit");
			expect(found?.checkedOn).toBe("registry");
			expect(targetText(found)).toBe(`quarto-ext/fontawesome@${LATEST_COMMIT}`);
			expect(found?.target.track).toBe("tag");
			expect(found?.target.recordSource).toBe("quarto-ext/fontawesome");
		});

		it("follows the default branch on GitHub when a stable install sees only prerelease tags", async () => {
			setupRecordedExtension(
				"quarto-ext",
				"fontawesome",
				"1.0.0",
				githubRecord("quarto-ext/fontawesome", "tag", INSTALLED_COMMIT),
			);
			vi.mocked(fetchTags).mockResolvedValue([tag("v2.0.0-beta.1")]);
			vi.mocked(fetchLatestCommit).mockResolvedValue(LATEST_COMMIT);

			const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

			expect(result.updates).toHaveLength(1);
			const [found] = result.updates;
			expect(found?.refKind).toBe("commit");
			expect(targetText(found)).toBe(`quarto-ext/fontawesome@${LATEST_COMMIT}`);
			expect(found?.target.track).toBe("tag");
			expect(found?.target.recordSource).toBe("quarto-ext/fontawesome");
		});

		it("follows the registry latestCommit when a stable install sees only a prerelease tag", async () => {
			setupRecordedExtension(
				"quarto-ext",
				"fontawesome",
				"1.0.0",
				githubRecord("quarto-ext/fontawesome", "tag", INSTALLED_COMMIT),
			);
			vi.mocked(fetchRegistry).mockResolvedValue({
				"quarto-ext/fontawesome": registryEntry("quarto-ext/fontawesome", {
					latestVersion: "2.0.0-beta.1",
					latestTag: "v2.0.0-beta.1",
					latestCommit: LATEST_COMMIT,
				}),
			} as never);

			const result = await checkForUpdates({ projectDirs: [tempDir] });

			expect(result.updates).toHaveLength(1);
			const [found] = result.updates;
			expect(found?.refKind).toBe("commit");
			expect(found?.checkedOn).toBe("registry");
			expect(targetText(found)).toBe(`quarto-ext/fontawesome@${LATEST_COMMIT}`);
			expect(found?.target.track).toBe("tag");
			expect(found?.target.recordSource).toBe("quarto-ext/fontawesome");
		});

		it("offers the first version tag above the installed version", async () => {
			setupRecordedExtension(
				"quarto-ext",
				"fontawesome",
				"1.0.0",
				githubRecord("quarto-ext/fontawesome", "tag", INSTALLED_COMMIT),
			);
			vi.mocked(fetchTags).mockResolvedValue([tag("v2.0.0")]);
			vi.mocked(fetchLatestCommit).mockResolvedValue(LATEST_COMMIT);

			const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

			expect(fetchLatestCommit).not.toHaveBeenCalled();
			expect(result.updates).toHaveLength(1);
			const [found] = result.updates;
			expect(found?.refKind).toBe("tag");
			expect(found?.currentVersion).toBe("1.0.0");
			expect(found?.latestRef).toBe("v2.0.0");
			expect(targetText(found)).toBe("quarto-ext/fontawesome@v2.0.0");
			expect(found?.target.track).toBe("tag");
			expect(found?.target.recordSource).toBeUndefined();
		});

		it("does not offer a first version tag below the installed version", async () => {
			setupRecordedExtension(
				"quarto-ext",
				"fontawesome",
				"3.0.0",
				githubRecord("quarto-ext/fontawesome", "tag", INSTALLED_COMMIT),
			);
			vi.mocked(fetchTags).mockResolvedValue([tag("v2.0.0")]);
			vi.mocked(fetchLatestCommit).mockResolvedValue(LATEST_COMMIT);

			const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

			expect(fetchLatestCommit).not.toHaveBeenCalled();
			expect(result.updates).toHaveLength(0);
		});

		it("offers the latest tag to an extension installed at an explicit commit", async () => {
			setupExtension(
				"quarto-ext",
				"fontawesome",
				"1.0.0",
				"quarto-ext/fontawesome@ABC1234567890abcdef1234567890abcdef12345",
				"github",
			);
			vi.mocked(fetchTags).mockResolvedValue([tag("v2.0.0")]);
			vi.mocked(fetchLatestCommit).mockResolvedValue(LATEST_COMMIT);

			const result = await checkForUpdates({ projectDirs: [tempDir], auth: TOKEN });

			expect(fetchLatestCommit).not.toHaveBeenCalled();
			expect(result.updates).toHaveLength(1);
			const [found] = result.updates;
			expect(found?.refKind).toBe("tag");
			expect(targetText(found)).toBe("quarto-ext/fontawesome@v2.0.0");
			expect(found?.target.recordSource).toBeUndefined();
		});

		it("reports no update when an explicit commit is the default branch head and no tag exists", async () => {
			setupExtension(
				"quarto-ext",
				"fontawesome",
				"1.0.0",
				"quarto-ext/fontawesome@def5678901234567890abcdef1234567890abcd",
				"github",
			);
			vi.mocked(fetchLatestCommit).mockResolvedValue(LATEST_COMMIT);

			const result = await checkForUpdates({ projectDirs: [tempDir], auth: TOKEN });

			expect(fetchLatestCommit).toHaveBeenCalledTimes(1);
			expect(result.updates).toHaveLength(0);
		});

		it("reports no update for an unpinned install with no qualifying tag", async () => {
			setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome@v1.0.0-beta", "github");

			vi.mocked(fetchTags).mockResolvedValue([tag("nightly")]);
			vi.mocked(fetchLatestCommit).mockResolvedValue("def5678ffff");

			const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

			expect(fetchReleases).toHaveBeenCalledTimes(1);
			expect(fetchLatestCommit).not.toHaveBeenCalled();
			expect(result.updates).toHaveLength(0);
		});
	});

	describe("install record", () => {
		it("a q2 record without a ref compares the manifest version with the latest tag", async () => {
			const record = "version: 1\nsource: quarto-ext/fontawesome\nkind: github\nfiles: {}\n";
			setupRecordedExtension("quarto-ext", "fontawesome", "1.0.0", record);
			const otherProject = fs.mkdtempSync(path.join(os.tmpdir(), "qw-update-test-"));
			try {
				setupRecordedExtension("quarto-ext", "fontawesome", "3.0.0", record, otherProject);
				vi.mocked(fetchTags).mockResolvedValue([tag("v2.0.0")]);

				const result = await checkForUpdates({ projectDirs: [tempDir, otherProject], source: "github" });

				expect(fetchLatestCommit).not.toHaveBeenCalled();
				expect(result.updates).toHaveLength(1);
				const [found] = result.updates;
				expect(found?.projectDir).toBe(tempDir);
				expect(found?.refKind).toBe("tag");
				expect(found?.currentVersion).toBe("1.0.0");
				expect(found?.latestRef).toBe("v2.0.0");
			} finally {
				fs.rmSync(otherProject, { recursive: true, force: true });
			}
		});

		describe("embedded extensions", () => {
			function setupParent(manifest: string, record?: string): string {
				const parentDir = path.join(tempDir, "_extensions", "acme", "parent");
				fs.mkdirSync(parentDir, { recursive: true });
				fs.writeFileSync(path.join(parentDir, "_extension.yml"), manifest);
				if (record) {
					fs.writeFileSync(path.join(parentDir, ".quarto-source.yml"), record);
				}
				setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome@v1.0.0", "github", parentDir);
				vi.mocked(fetchTags).mockResolvedValue([tag("v2.0.0")]);
				return parentDir;
			}

			it.each([
				["a Quarto Wizard 3 source", "title: Parent\nsource: acme/parent@v1.0.0\n", undefined],
				[
					"an install record",
					"title: Parent\n",
					"version: 1\nsource: acme/parent@v1.0.0\nkind: github\nref: v1.0.0\nfiles: {}\n",
				],
			])("checkForUpdates skips an extension embedded in an installed parent with %s", async (_, manifest, record) => {
				const parentDir = setupParent(manifest, record);

				const result = await checkForUpdates({ projectDirs: [parentDir], source: "github" });

				expect(fetchTags).not.toHaveBeenCalled();
				expect(result.updates).toHaveLength(0);
			});

			it("checkForUpdates checks an extension embedded in a locally developed parent", async () => {
				const parentDir = setupParent("title: Parent\n");

				const result = await checkForUpdates({ projectDirs: [parentDir], source: "github" });

				expect(result.updates).toHaveLength(1);
				expect(result.updates[0]?.latestRef).toBe("v2.0.0");
			});
		});
	});

	describe("failures", () => {
		it("reports a rate limit as a check failure", async () => {
			setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome@v1.0.0", "github");
			setupExtension("quarto-ext", "lightbox", "1.0.0", "quarto-ext/lightbox@v1.0.0", "github");

			vi.mocked(fetchReleases).mockImplementation(async (_owner, repo) => {
				if (repo === "fontawesome") {
					throw new RateLimitError("HTTP 403: rate limit exceeded for quarto-ext/fontawesome", { statusCode: 403 });
				}
				return [release("v2.0.0")];
			});

			const result = await checkForUpdates({ projectDirs: [tempDir], auth: TOKEN });

			expect(result.checkFailure?.kind).toBe("rate-limited");
			expect(result.checkFailure?.message).toContain("quarto-ext/fontawesome");
			expect(result.repositoryFailures).toHaveLength(0);
		});

		it("reports a bare target that two owners share as that extension's failure", async () => {
			setupExtension("acme", "demo", "1.0.0", "acme/demo@v1.0.0", "github");
			setupExtension("beta", "demo", "1.0.0", "beta/demo@v1.0.0", "github");

			const result = await checkForUpdates({
				projectDirs: [tempDir],
				extension: { owner: null, name: "demo" },
				auth: TOKEN,
			});

			expect(result.checkFailure).toBeUndefined();
			expect(result.updates).toEqual([]);
			expect(result.repositoryFailures).toEqual([
				{ repository: "demo", message: 'Extension name "demo" is ambiguous: acme/demo, beta/demo.' },
			]);
		});

		it("reports a denied 403 as a repository failure and keeps the other results", async () => {
			setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome@v1.0.0", "github");
			setupExtension("quarto-ext", "lightbox", "1.0.0", "quarto-ext/lightbox@v1.0.0", "github");

			const forbidden = new NetworkError("HTTP 403: Forbidden", { statusCode: 403 });
			vi.mocked(fetchReleases).mockImplementation(async (_owner, repo) => {
				if (repo === "fontawesome") {
					throw new AuthenticationError("Access denied to quarto-ext/fontawesome.", { cause: forbidden });
				}
				return [release("v2.0.0")];
			});

			const result = await checkForUpdates({ projectDirs: [tempDir], auth: TOKEN });

			expect(result.checkFailure).toBeUndefined();
			expect(result.repositoryFailures).toEqual([
				{ repository: "quarto-ext/fontawesome", message: "Access denied to quarto-ext/fontawesome." },
			]);
			expect(result.updates.map((u) => u.extension.id.name)).toEqual(["lightbox"]);
		});

		it("reports a 401 as an unauthorised check failure", async () => {
			setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome@v1.0.0", "github");
			setupExtension("quarto-ext", "lightbox", "1.0.0", "quarto-ext/lightbox@v1.0.0", "github");

			const unauthorised = new NetworkError("HTTP 401: Unauthorized", { statusCode: 401 });
			vi.mocked(fetchReleases).mockRejectedValue(
				new AuthenticationError("Authentication failed for quarto-ext/fontawesome.", { cause: unauthorised }),
			);

			const result = await checkForUpdates({ projectDirs: [tempDir], auth: TOKEN });

			expect(result.checkFailure?.kind).toBe("unauthorised");
			expect(result.repositoryFailures).toHaveLength(0);
		});

		it("reports an HTTP 429 as a rate limit", async () => {
			setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome@v1.0.0", "github");

			vi.mocked(fetchReleases).mockRejectedValue(new NetworkError("HTTP 429: Too Many Requests", { statusCode: 429 }));

			const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

			expect(result.checkFailure?.kind).toBe("rate-limited");
		});

		it("reports a lost connection as a network check failure", async () => {
			setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome@v1.0.0", "github");

			vi.mocked(fetchReleases).mockRejectedValue(new NetworkError("fetch failed"));

			const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

			expect(result.checkFailure?.kind).toBe("network");
			expect(result.repositoryFailures).toHaveLength(0);
		});

		it("reports a 404 as a repository failure", async () => {
			const roots = ["a", "b"].map((name) => path.join(tempDir, name));
			for (const root of roots) {
				setupExtension("gone", "away", "1.0.0", "gone/away@v1.0.0", "github", root);
			}
			setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome@v1.0.0", "github", roots[0]);

			vi.mocked(fetchReleases).mockImplementation(async (owner) => {
				if (owner === "gone") {
					throw new RepositoryNotFoundError("Repository not found: gone/away");
				}
				return [release("v2.0.0")];
			});

			const result = await checkForUpdates({ projectDirs: roots, source: "github" });

			expect(result.checkFailure).toBeUndefined();
			expect(result.repositoryFailures).toEqual([
				{ repository: "gone/away", message: "Repository not found: gone/away" },
			]);
			expect(result.updates.map((u) => u.extension.id.name)).toEqual(["fontawesome"]);
		});
	});

	describe("cancellation", () => {
		it("rejects an aborted signal when no extension can be checked", async () => {
			const controller = new AbortController();
			controller.abort();

			await expect(checkForUpdates({ projectDirs: [tempDir], signal: controller.signal })).rejects.toBeInstanceOf(
				CancellationError,
			);
		});

		it("sends no request when the signal is already aborted", async () => {
			setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome@v1.0.0", "github");
			const controller = new AbortController();
			controller.abort();

			await expect(
				checkForUpdates({ projectDirs: [tempDir], source: "github", signal: controller.signal }),
			).rejects.toBeInstanceOf(CancellationError);

			expect(fetchReleases).not.toHaveBeenCalled();
			expect(fetchTags).not.toHaveBeenCalled();
			expect(fetchRegistry).not.toHaveBeenCalled();
		});

		it("rejects with a cancellation when the signal aborts during a lookup", async () => {
			setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome@v1.0.0", "github");
			const controller = new AbortController();
			vi.mocked(fetchTags).mockImplementation(
				(_owner, _repo, options) =>
					new Promise((_resolve, reject) => {
						options?.signal?.addEventListener("abort", () => reject(new CancellationError()), { once: true });
						controller.abort();
					}),
			);

			await expect(
				checkForUpdates({ projectDirs: [tempDir], source: "github", signal: controller.signal }),
			).rejects.toBeInstanceOf(CancellationError);
		});

		it("passes the signal to every GitHub lookup", async () => {
			setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome@v1.0.0", "github");
			setupExtension("quarto-ext", "lightbox", "1.0.0", "quarto-ext/lightbox@abc1234", "github");
			const { signal } = new AbortController();

			await checkForUpdates({ projectDirs: [tempDir], source: "github", signal });

			const withSignal = expect.objectContaining({ signal });
			expect(fetchReleases).toHaveBeenCalledWith("quarto-ext", "fontawesome", withSignal);
			expect(fetchTags).toHaveBeenCalledWith("quarto-ext", "fontawesome", withSignal);
			expect(fetchLatestCommit).toHaveBeenCalledWith("quarto-ext", "lightbox", withSignal);
		});

		it("passes the signal to the registry", async () => {
			setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome@v1.0.0", "github");
			vi.mocked(fetchRegistry).mockResolvedValue({});
			const { signal } = new AbortController();

			await checkForUpdates({ projectDirs: [tempDir], signal });

			expect(fetchRegistry).toHaveBeenCalledWith(expect.objectContaining({ signal }));
		});
	});
});

describe("update", () => {
	it("throws when the check fails as a whole", async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qw-update-test-"));
		try {
			const extDir = path.join(tempDir, "_extensions", "quarto-ext", "fontawesome");
			fs.mkdirSync(extDir, { recursive: true });
			fs.writeFileSync(
				path.join(extDir, "_extension.yml"),
				"title: fontawesome\nversion: 1.0.0\nsource: quarto-ext/fontawesome\n",
			);
			vi.mocked(fetchRegistry).mockRejectedValue(new NetworkError("offline"));

			await expect(update({ projectDirs: [tempDir] })).rejects.toThrow("offline");
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});
});

describe("applyUpdates", () => {
	function pendingUpdate(name: string): UpdateInfo {
		return {
			extension: {
				id: { owner: "quarto-ext", name },
				manifest: { title: name, version: "1.0.0", source: `quarto-ext/${name}@v1.0.0` },
			} as InstalledExtension,
			projectDir: "/project",
			currentVersion: "1.0.0",
			latestVersion: "2.0.0",
			latestRef: "v2.0.0",
			refKind: "tag",
			checkedOn: "github",
			releaseUrl: null,
			target: { source: installSource(`quarto-ext/${name}@v2.0.0`), track: "tag" },
		};
	}

	function updateOf(name: string, source: string): UpdateInfo {
		return { ...pendingUpdate(name), target: { source: installSource(source), track: "tag" } };
	}

	it("installs a tag update without a dot as a tag", async () => {
		vi.mocked(install).mockReset();
		vi.mocked(install).mockResolvedValue({ extension: pendingUpdate("x").extension } as Awaited<
			ReturnType<typeof install>
		>);

		const target: InstallTarget = {
			source: { type: "github", owner: "quarto-ext", repo: "x", version: { type: "tag", tag: "3" } },
			track: "tag",
		};
		await applyUpdates([{ ...pendingUpdate("x"), target, latestRef: "3" }], { projectDirs: [] });

		expect(vi.mocked(install).mock.calls[0][0]).toMatchObject({ version: { type: "tag", tag: "3" } });
		expect(vi.mocked(install).mock.calls[0][1]).toMatchObject({ track: "tag" });
	});

	it("does not install a commit update as a tag", async () => {
		vi.mocked(install).mockReset();
		vi.mocked(install).mockResolvedValue({ extension: pendingUpdate("x").extension } as Awaited<
			ReturnType<typeof install>
		>);
		const commit = "fed9876543210fedcba9876543210fedcba98765";

		await applyUpdates([{ ...updateOf("x", `quarto-ext/x@${commit}`), refKind: "commit" }], { projectDirs: [] });

		expect(vi.mocked(install).mock.calls[0][0]).toMatchObject({ version: { type: "commit", commit } });
	});

	it("passes the signal to install and skips the remaining updates at a cancellation", async () => {
		vi.mocked(install).mockReset();
		const controller = new AbortController();
		vi.mocked(install).mockImplementation(async (source, options) => {
			if (!options.signal) {
				throw new Error("install ran without the signal");
			}
			if (source.type === "github" && source.repo === "fontawesome") {
				return { extension: pendingUpdate("fontawesome").extension } as Awaited<ReturnType<typeof install>>;
			}
			controller.abort();
			throw new CancellationError();
		});
		const updates = ["fontawesome", "lightbox", "iconify"].map(pendingUpdate);

		const result = await applyUpdates(updates, { projectDirs: [], signal: controller.signal });

		expect(install).toHaveBeenCalledTimes(2);
		expect(result.updated.map((u) => u.extension.id.name)).toEqual(["fontawesome"]);
		expect(result.failed).toEqual([]);
		expect(result.skipped).toEqual([
			{ extension: updates[1].extension, reason: "Operation cancelled by the user." },
			{ extension: updates[2].extension, reason: "Operation cancelled by the user." },
		]);
	});

	it("passes a subdirectory source on to install", async () => {
		vi.mocked(install).mockReset();
		vi.mocked(install).mockResolvedValue({ extension: pendingUpdate("x").extension } as Awaited<
			ReturnType<typeof install>
		>);

		await applyUpdates([updateOf("x", "quarto-ext/repo/sub/dir@v2.0.0")], { projectDirs: [] });

		const source = vi.mocked(install).mock.calls[0][0];
		expect(source).toMatchObject({
			type: "github",
			owner: "quarto-ext",
			repo: "repo",
			subdirectory: "sub/dir",
			version: { type: "tag", tag: "v2.0.0" },
		});
	});

	it("asks install for the extension the update names", async () => {
		vi.mocked(install).mockReset();
		vi.mocked(install).mockResolvedValue({ extension: pendingUpdate("x").extension } as Awaited<
			ReturnType<typeof install>
		>);

		await applyUpdates([updateOf("x", "quarto-ext/repo@v2.0.0")], { projectDirs: [] });

		expect(vi.mocked(install).mock.calls[0][1].expectedExtensionId).toEqual({ owner: "quarto-ext", name: "x" });
	});

	describe("against a source on disk", () => {
		let tempDir: string;

		beforeEach(async () => {
			tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qw-apply-updates-"));
			const actual = await vi.importActual<typeof import("../../src/operations/install.js")>(
				"../../src/operations/install.js",
			);
			vi.mocked(install).mockReset();
			vi.mocked(install).mockImplementation(actual.install);
		});

		afterEach(() => {
			fs.rmSync(tempDir, { recursive: true, force: true });
		});

		function localSource(names: string[]): { source: string; projectDir: string } {
			const source = path.join(tempDir, "source");
			for (const name of names) {
				const dir = path.join(source, "_extensions", "quarto-ext", name);
				fs.mkdirSync(dir, { recursive: true });
				fs.writeFileSync(path.join(dir, "_extension.yml"), `title: ${name}\nversion: 2.0.0\n`);
			}
			const projectDir = path.join(tempDir, "project");
			fs.mkdirSync(projectDir, { recursive: true });
			return { source, projectDir };
		}

		function installedNames(projectDir: string): string[] {
			const dir = path.join(projectDir, "_extensions", "quarto-ext");
			return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
		}

		it("updates the extension the update names, not the first one in the source", async () => {
			const { source, projectDir } = localSource(["x", "y"]);

			const result = await applyUpdates([{ ...updateOf("y", source), projectDir }], { projectDirs: [] });

			expect(installedNames(projectDir)).toEqual(["y"]);
			expect(result.updated).toHaveLength(1);
			expect(result.failed).toEqual([]);
		});

		it("fails one update when its extension left the source and continues the others", async () => {
			const { source, projectDir } = localSource(["x", "y"]);
			const updates = [
				{ ...updateOf("gone", source), projectDir },
				{ ...updateOf("y", source), projectDir },
			];

			const result = await applyUpdates(updates, { projectDirs: [] });

			expect(result.failed).toEqual([
				{ extension: updates[0].extension, error: `quarto-ext/gone is no longer in ${source}` },
			]);
			expect(result.updated).toHaveLength(1);
			expect(installedNames(projectDir)).toEqual(["y"]);
		});

		it("fails one update when the only extension in its source has another id, and continues the others", async () => {
			const { source, projectDir } = localSource(["renamed"]);
			const updates = [
				{ ...updateOf("old", source), projectDir },
				{ ...updateOf("renamed", source), projectDir },
			];

			const result = await applyUpdates(updates, { projectDirs: [] });

			expect(result.failed).toEqual([
				{ extension: updates[0].extension, error: `quarto-ext/old is no longer in ${source}` },
			]);
			expect(result.updated).toHaveLength(1);
			expect(installedNames(projectDir)).toEqual(["renamed"]);
		});

		it("applyUpdates skips a locally edited extension and updates the rest", async () => {
			const { source, projectDir } = localSource(["x", "y"]);
			for (const name of ["x", "y"]) {
				const dir = path.join(projectDir, "_extensions", "quarto-ext", name);
				fs.mkdirSync(dir, { recursive: true });
				fs.writeFileSync(path.join(dir, "_extension.yml"), `title: ${name}\nversion: 1.0.0\n`);
				writeSourceRecord(dir, { source: `quarto-ext/${name}@v1.0.0`, kind: "github", ref: "v1.0.0" });
			}
			const editedDir = path.join(projectDir, "_extensions", "quarto-ext", "x");
			fs.writeFileSync(path.join(editedDir, "_extension.yml"), "title: x edited\nversion: 1.0.0\n");
			const updates = [
				{ ...updateOf("x", source), projectDir },
				{ ...updateOf("y", source), projectDir },
			];

			const result = await applyUpdates(updates, { projectDirs: [] });

			expect(vi.mocked(install).mock.calls.every(([, options]) => !options.force)).toBe(true);
			expect(result.skipped).toEqual([
				{
					extension: updates[0].extension,
					reason: "local-edits",
					edits: [{ path: "_extension.yml", change: "modified" }],
				},
			]);
			expect(result.failed).toEqual([]);
			expect(result.updated.map((u) => u.extension.id.name)).toEqual(["y"]);
			expect(fs.readFileSync(path.join(editedDir, "_extension.yml"), "utf-8")).toBe(
				"title: x edited\nversion: 1.0.0\n",
			);
		});

		it("updates an extension installed without an owner from a GitHub source", async () => {
			const projectDir = path.join(tempDir, "project");
			const installedDir = path.join(projectDir, "_extensions", "x");
			fs.mkdirSync(installedDir, { recursive: true });
			fs.writeFileSync(path.join(installedDir, "_extension.yml"), "title: X\nversion: 0.9.0\n");
			vi.mocked(downloadGitHubArchive).mockImplementationOnce(async () => ({
				archivePath: await createSubdirectoryRepositoryArchive(tempDir),
				tagName: SUBDIRECTORY_REPOSITORY_TAG,
				format: "tarball",
			}));
			const pending = pendingUpdate("x");
			const ownerless: UpdateInfo = {
				...pending,
				extension: { ...pending.extension, id: { owner: null, name: "x" } },
				projectDir,
				target: { source: installSource(`acme/repo@${SUBDIRECTORY_REPOSITORY_TAG}`), track: "tag" },
			};

			const result = await applyUpdates([ownerless], { projectDirs: [] });

			expect(result.failed).toEqual([]);
			expect(result.updated).toHaveLength(1);
			expect(fs.existsSync(path.join(projectDir, "_extensions", "acme", "x", "_extension.yml"))).toBe(true);
		});

		function githubUpdate(
			installedSource: string,
			resolution: { tagName: string; commitSha?: string },
			sourceType: "github" | "registry" = "github",
			follow: Omit<InstallTarget, "source"> = { track: "tag" },
		): { update: UpdateInfo; installedDir: string } {
			const projectDir = path.join(tempDir, "project");
			const installedDir = path.join(projectDir, "_extensions", "acme", "x");
			fs.mkdirSync(installedDir, { recursive: true });
			fs.writeFileSync(path.join(installedDir, "_extension.yml"), "title: X\nversion: 0.9.0\n");
			vi.mocked(downloadGitHubArchive).mockImplementationOnce(async () => ({
				archivePath: await createSubdirectoryRepositoryArchive(tempDir),
				format: "tarball",
				...resolution,
			}));
			const pending = pendingUpdate("x");
			const latestRef = resolution.commitSha ?? resolution.tagName;
			return {
				installedDir,
				update: {
					...pending,
					extension: {
						...pending.extension,
						id: { owner: "acme", name: "x" },
						manifest: { title: "X", version: "0.9.0", source: installedSource, sourceType },
					},
					projectDir,
					latestRef,
					refKind: resolution.commitSha ? "commit" : "tag",
					target: { source: installSource(`acme/repo@${latestRef}`), ...follow },
				},
			};
		}

		const FULL_COMMIT = "fed9876543210fedcba9876543210fedcba98765";
		const TAG_MODE_COMMIT: Omit<InstallTarget, "source"> = { track: "tag", recordSource: "acme/repo" };

		function recordIn(dir: string): SourceRecord {
			const result = readSourceRecord(dir);
			if (result.status !== "ok") {
				throw new Error(`No readable install record in ${dir}: ${result.status}`);
			}
			return result.record;
		}

		it("a tag update of an extension installed without a ref records the tag", async () => {
			const { update, installedDir } = githubUpdate("acme/repo", { tagName: SUBDIRECTORY_REPOSITORY_TAG });

			const result = await applyUpdates([update], { projectDirs: [] });

			expect(result.failed).toEqual([]);
			const record = recordIn(installedDir);
			expect(record.source).toBe(`acme/repo@${SUBDIRECTORY_REPOSITORY_TAG}`);
			expect(record.ref).toBe(SUBDIRECTORY_REPOSITORY_TAG);
			expect(record.quartoWizard).toEqual({ track: "tag" });
			expect(fs.readFileSync(path.join(installedDir, "_extension.yml"), "utf-8")).not.toMatch(/^source/m);
		});

		it("follows an explicit branch from the check to the new record", async () => {
			const oldCommit = "abc1234567890abcdef1234567890abcdef12345";
			const projectDir = path.join(tempDir, "project");
			const installedDir = path.join(projectDir, "_extensions", "acme", "x");
			fs.mkdirSync(installedDir, { recursive: true });
			fs.writeFileSync(path.join(installedDir, "_extension.yml"), "title: X\nversion: 0.9.0\n");
			writeSourceRecord(installedDir, {
				source: "acme/repo@dev",
				kind: "github",
				ref: "dev",
				quartoWizard: { track: "branch", commit: oldCommit },
			});
			vi.mocked(fetchLatestCommit).mockResolvedValue(FULL_COMMIT);
			vi.mocked(downloadGitHubArchive).mockImplementationOnce(async () => ({
				archivePath: await createSubdirectoryRepositoryArchive(tempDir),
				tagName: "dev",
				commitSha: FULL_COMMIT,
				format: "tarball",
			}));

			const check = await checkForUpdates({ projectDirs: [projectDir] });
			const result = await applyUpdates(check.updates, { projectDirs: [projectDir] });

			expect(check.updates).toHaveLength(1);
			expect(result.failed).toEqual([]);
			const record = recordIn(installedDir);
			expect(record.source).toBe("acme/repo@dev");
			expect(record.ref).toBe("dev");
			expect(record.quartoWizard).toEqual({ track: "branch", commit: FULL_COMMIT });
		});

		it("passes the record source and the mode of the update to install", async () => {
			const { update, installedDir } = githubUpdate(
				"acme/repo@dev",
				{ tagName: "dev", commitSha: FULL_COMMIT },
				"github",
				{
					track: "branch",
					recordSource: "acme/repo@dev",
				},
			);

			const result = await applyUpdates([update], { projectDirs: [] });

			expect(result.failed).toEqual([]);
			expect(vi.mocked(install).mock.calls[0][1]).toMatchObject({
				recordSource: "acme/repo@dev",
				track: "branch",
				replaceSameVersion: true,
			});
			const record = recordIn(installedDir);
			expect(record.source).toBe("acme/repo@dev");
			expect(record.ref).toBe("dev");
			expect(record.quartoWizard).toEqual({ track: "branch", commit: FULL_COMMIT });
		});

		it("an update of an unpinned extension to a commit records quarto-wizard.commit", async () => {
			const { update, installedDir } = githubUpdate(
				"acme/repo",
				{ tagName: "fed9876", commitSha: "fed9876" },
				"github",
				TAG_MODE_COMMIT,
			);

			await applyUpdates([update], { projectDirs: [] });

			const record = recordIn(installedDir);
			expect(record.source).toBe("acme/repo");
			expect(record).not.toHaveProperty("ref");
			expect(record.quartoWizard).toEqual({ track: "tag", commit: "fed9876" });
		});

		it("a commit update with an equal manifest version writes the new copy and its commit", async () => {
			const { update, installedDir } = githubUpdate(
				"acme/repo",
				{ tagName: "fed9876", commitSha: "fed9876" },
				"github",
				TAG_MODE_COMMIT,
			);
			fs.writeFileSync(path.join(installedDir, "_extension.yml"), "title: X\nversion: 1.0.0\n");
			writeSourceRecord(installedDir, { source: "acme/repo", kind: "github", quartoWizard: { commit: "aaaaaaa" } });

			const result = await applyUpdates([update], { projectDirs: [] });

			expect(result.failed).toEqual([]);
			expect(result.skipped).toEqual([]);
			expect(result.updated).toHaveLength(1);
			expect(fs.readFileSync(path.join(installedDir, "x.lua"), "utf-8")).toBe("-- x\n");
			expect(recordIn(installedDir).quartoWizard).toEqual({ track: "tag", commit: "fed9876" });
		});

		it("a commit update of an extension pinned to a commit at an equal version writes the new copy", async () => {
			const { update, installedDir } = githubUpdate(
				"acme/repo@aaaaaaa",
				{ tagName: "fed9876", commitSha: "fed9876" },
				"github",
				TAG_MODE_COMMIT,
			);
			fs.writeFileSync(
				path.join(installedDir, "_extension.yml"),
				"title: X\nversion: 1.0.0\nsource: acme/repo@aaaaaaa\nsource-type: github\n",
			);

			const result = await applyUpdates([update], { projectDirs: [] });

			expect(result.skipped).toEqual([]);
			expect(result.updated).toHaveLength(1);
			const record = recordIn(installedDir);
			expect(record.source).toBe("acme/repo");
			expect(record.quartoWizard).toEqual({ track: "tag", commit: "fed9876" });
		});

		it("moves a tag-mode record with a commit to the first version tag and drops the commit", async () => {
			const projectDir = path.join(tempDir, "project");
			const installedDir = path.join(projectDir, "_extensions", "acme", "x");
			fs.mkdirSync(installedDir, { recursive: true });
			fs.writeFileSync(path.join(installedDir, "_extension.yml"), "title: X\nversion: 0.9.0\n");
			writeSourceRecord(installedDir, {
				source: "acme/repo",
				kind: "github",
				quartoWizard: { track: "tag", commit: FULL_COMMIT },
			});
			vi.mocked(fetchReleases).mockResolvedValue([]);
			vi.mocked(fetchTags).mockResolvedValue([tag(SUBDIRECTORY_REPOSITORY_TAG)]);
			vi.mocked(fetchLatestCommit).mockResolvedValue(null);
			vi.mocked(downloadGitHubArchive).mockImplementationOnce(async () => ({
				archivePath: await createSubdirectoryRepositoryArchive(tempDir),
				tagName: SUBDIRECTORY_REPOSITORY_TAG,
				format: "tarball",
				fromTag: true,
			}));

			const { updates } = await checkForUpdates({ projectDirs: [projectDir], source: "github" });
			expect(updates.map((u) => [u.refKind, targetText(u), u.target.track, u.target.recordSource])).toEqual([
				["tag", `acme/repo@${SUBDIRECTORY_REPOSITORY_TAG}`, "tag", undefined],
			]);
			const result = await applyUpdates(updates, { projectDirs: [] });

			expect(result.failed).toEqual([]);
			expect(result.updated).toHaveLength(1);
			const record = recordIn(installedDir);
			expect(record.source).toBe(`acme/repo@${SUBDIRECTORY_REPOSITORY_TAG}`);
			expect(record.ref).toBe(SUBDIRECTORY_REPOSITORY_TAG);
			expect(record.quartoWizard).toEqual({ track: "tag" });
		});

		it("an update of a pinned extension records the new ref", async () => {
			const { update, installedDir } = githubUpdate("acme/repo@v0.9.0", { tagName: SUBDIRECTORY_REPOSITORY_TAG });

			await applyUpdates([update], { projectDirs: [] });

			const record = recordIn(installedDir);
			expect(record.source).toBe(`acme/repo@${SUBDIRECTORY_REPOSITORY_TAG}`);
			expect(record.ref).toBe(SUBDIRECTORY_REPOSITORY_TAG);
		});

		function sameVersionTagUpdate(): { update: UpdateInfo; installedDir: string } {
			const pinned = githubUpdate("acme/repo@v0.9.0", { tagName: SUBDIRECTORY_REPOSITORY_TAG });
			fs.writeFileSync(path.join(pinned.installedDir, "_extension.yml"), "title: X\nversion: 1.0.0\n");
			writeSourceRecord(pinned.installedDir, { source: "acme/repo@v0.9.0", kind: "github", ref: "v0.9.0" });
			return pinned;
		}

		it("a tag update with an equal manifest version writes the new copy and records the new ref", async () => {
			const { update, installedDir } = sameVersionTagUpdate();

			const result = await applyUpdates([update], { projectDirs: [] });

			expect(vi.mocked(install).mock.calls[0][1].force).toBeFalsy();
			expect(result.failed).toEqual([]);
			expect(result.skipped).toEqual([]);
			expect(result.updated).toHaveLength(1);
			expect(fs.readFileSync(path.join(installedDir, "x.lua"), "utf-8")).toBe("-- x\n");
			const record = recordIn(installedDir);
			expect(record.source).toBe(`acme/repo@${SUBDIRECTORY_REPOSITORY_TAG}`);
			expect(record.ref).toBe(SUBDIRECTORY_REPOSITORY_TAG);
		});

		it("a tag update with an equal manifest version skips a locally edited copy", async () => {
			const { update, installedDir } = sameVersionTagUpdate();
			fs.writeFileSync(path.join(installedDir, "_extension.yml"), "title: X edited\nversion: 1.0.0\n");

			const result = await applyUpdates([update], { projectDirs: [] });

			expect(result.updated).toEqual([]);
			expect(result.skipped).toEqual([
				{
					extension: update.extension,
					reason: "local-edits",
					edits: [{ path: "_extension.yml", change: "modified" }],
				},
			]);
			expect(fs.existsSync(path.join(installedDir, "x.lua"))).toBe(false);
			expect(recordIn(installedDir).ref).toBe("v0.9.0");
		});

		it("an update of a registry install keeps source-type registry", async () => {
			const { update, installedDir } = githubUpdate("acme/repo", { tagName: SUBDIRECTORY_REPOSITORY_TAG }, "registry");

			await applyUpdates([update], { projectDirs: [] });

			const record = recordIn(installedDir);
			expect(record.kind).toBe("github");
			expect(record.quartoWizard).toEqual({ track: "tag", sourceType: "registry" });
		});
	});
});

describe("resolveVersion latest", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(fetchLatestCommit).mockResolvedValue(null);
	});

	it("resolveVersion latest uses resolveLatestTag", async () => {
		vi.mocked(fetchReleases).mockResolvedValue([release("v1.2.0")]);
		vi.mocked(fetchTags).mockResolvedValue([tag("v1.3.0")]);

		const resolved = await resolveVersion("owner", "repo", { type: "latest" });

		expect(resolved.tagName).toBe("v1.3.0");
	});

	it("records the latest default branch commit when no tag qualifies", async () => {
		vi.mocked(fetchReleases).mockResolvedValue([]);
		vi.mocked(fetchTags).mockResolvedValue([]);
		vi.mocked(fetchLatestCommit).mockResolvedValue("abcdef1234567890abcdef1234567890abcdef12");

		const resolved = await resolveVersion("owner", "repo", { type: "latest" }, { defaultBranch: "main" });

		expect(resolved.commitSha).toBe("abcdef1234567890abcdef1234567890abcdef12");
		expect(resolved.tagName).toBe("abcdef1");
	});

	it("prefers the registry commit hint over a GitHub lookup", async () => {
		vi.mocked(fetchReleases).mockResolvedValue([]);
		vi.mocked(fetchTags).mockResolvedValue([]);

		const resolved = await resolveVersion(
			"owner",
			"repo",
			{ type: "latest" },
			{ defaultBranch: "main", latestCommit: "1234567890" },
		);

		expect(fetchLatestCommit).not.toHaveBeenCalled();
		expect(resolved.commitSha).toBe("1234567890");
	});

	it("records no commit when the latest commit lookup fails", async () => {
		vi.mocked(fetchReleases).mockResolvedValue([]);
		vi.mocked(fetchTags).mockResolvedValue([]);
		vi.mocked(fetchLatestCommit).mockRejectedValue(new NetworkError("HTTP 409: Conflict", { statusCode: 409 }));

		const resolved = await resolveVersion("owner", "repo", { type: "latest" }, { defaultBranch: "main" });

		expect(resolved.commitSha).toBeUndefined();
		expect(resolved.tagName).toBe("HEAD");
	});
});
