/**
 * Tests for extension update operations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { checkForUpdates, update } from "../../src/operations/update.js";
import { AuthenticationError, NetworkError, RepositoryNotFoundError } from "../../src/errors.js";

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
	};
});

import { fetchRegistry } from "../../src/registry/fetcher.js";
import { fetchLatestCommit, fetchReleases, fetchTags } from "../../src/github/releases.js";
import { resolveVersion } from "../../src/github/resolve.js";
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

describe("checkForUpdates", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qw-update-test-"));
		vi.clearAllMocks();
		vi.mocked(fetchReleases).mockResolvedValue([]);
		vi.mocked(fetchTags).mockResolvedValue([]);
		vi.mocked(fetchLatestCommit).mockResolvedValue(null);
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
			expect(found?.source).toBe("quarto-ext/fontawesome@v2.0.0");
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
			expect(result.updates[0]?.source).toBe("mcanouil/quarto-remember@1.1.0");
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
			expect(found?.source).toBe("quarto-ext/fontawesome@v1.2.0");
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
			expect(result.updates[0]?.source).toBe("unknown/extension@v1.1.0");
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
			expect(found?.source).toBe("quarto-ext/fontawesome@v1.2.0");
		});

		it("does not offer the installed tag again when the installed version is not a version", async () => {
			setupExtension("quarto-ext", "fontawesome", "dev", "quarto-ext/fontawesome@V1.2.0", "github");
			setupExtension("quarto-ext", "lightbox", "dev", "quarto-ext/lightbox@1.2.0", "github");

			vi.mocked(fetchTags).mockResolvedValue([tag("v1.2.0"), tag("v1.1.0")]);

			const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

			expect(result.updates).toHaveLength(0);
		});

		it("offers the latest tag when an unparsable install records an older tag", async () => {
			setupExtension("quarto-ext", "fontawesome", "dev", "quarto-ext/fontawesome@v1.1.0", "github");

			vi.mocked(fetchTags).mockResolvedValue([tag("v1.2.0"), tag("v1.1.0")]);

			const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

			expect(result.updates).toHaveLength(1);
			expect(result.updates[0]?.latestRef).toBe("v1.2.0");
			expect(result.updates[0]?.source).toBe("quarto-ext/fontawesome@v1.2.0");
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
			setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome/sub@v1.0.0", "github");

			vi.mocked(fetchTags).mockResolvedValue([tag("2.0.0")]);

			const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

			expect(fetchReleases).toHaveBeenCalledWith("quarto-ext", "fontawesome", expect.anything());
			expect(result.updates[0]?.latestRef).toBe("2.0.0");
			expect(result.updates[0]?.source).toBe("quarto-ext/fontawesome@2.0.0");
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

	describe("compares commits for a commit-pinned source", () => {
		it("against the default branch on GitHub", async () => {
			setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome@ABC1234", "github");

			vi.mocked(fetchLatestCommit).mockResolvedValue("def5678901234567890abcdef1234567890abcd");

			const result = await checkForUpdates({ projectDirs: [tempDir], auth: TOKEN });

			expect(fetchReleases).not.toHaveBeenCalled();
			expect(fetchLatestCommit).toHaveBeenCalledWith("quarto-ext", "fontawesome", expect.anything());
			expect(result.updates).toHaveLength(1);
			const [found] = result.updates;
			expect(found?.refKind).toBe("commit");
			expect(found?.currentVersion).toBe("abc1234");
			expect(found?.latestVersion).toBe("def5678");
			expect(found?.latestRef).toBe("def5678");
			expect(found?.checkedOn).toBe("github");
			expect(found?.source).toBe("quarto-ext/fontawesome@def5678");
		});

		it("against the registry latestCommit", async () => {
			setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome@abc1234");

			vi.mocked(fetchRegistry).mockResolvedValue({
				"quarto-ext/fontawesome": registryEntry("quarto-ext/fontawesome", {
					latestVersion: "2.0.0",
					latestTag: "v2.0.0",
					latestCommit: "def5678901234567890abcdef1234567890abcdef",
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
			expect(found?.source).toBe("quarto-ext/fontawesome@def5678");
		});

		it("reports no update when the commits match, without regard to case", async () => {
			setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome@ABC1234");

			vi.mocked(fetchRegistry).mockResolvedValue({
				"quarto-ext/fontawesome": registryEntry("quarto-ext/fontawesome", {
					latestCommit: "abc1234567890abcdef",
				}),
			} as never);

			const result = await checkForUpdates({ projectDirs: [tempDir] });

			expect(result.updates).toHaveLength(0);
		});

		it("reports no update when the registry has no latestCommit", async () => {
			setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome@abc1234");

			vi.mocked(fetchRegistry).mockResolvedValue({
				"quarto-ext/fontawesome": registryEntry("quarto-ext/fontawesome", {}),
			} as never);

			const result = await checkForUpdates({ projectDirs: [tempDir] });

			expect(result.updates).toHaveLength(0);
		});

		it("reports no update when the GitHub commit matches", async () => {
			setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome@abc1234", "github");

			vi.mocked(fetchTags).mockResolvedValue([tag("nightly")]);
			vi.mocked(fetchLatestCommit).mockResolvedValue("abc1234ffff");

			const result = await checkForUpdates({ projectDirs: [tempDir], source: "github" });

			expect(result.updates).toHaveLength(0);
			expect(fetchLatestCommit).toHaveBeenCalledTimes(1);
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

	describe("failures", () => {
		it("reports a rate limit as a check failure", async () => {
			setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome@v1.0.0", "github");
			setupExtension("quarto-ext", "lightbox", "1.0.0", "quarto-ext/lightbox@v1.0.0", "github");

			const forbidden = new NetworkError("HTTP 403: Forbidden", { statusCode: 403 });
			vi.mocked(fetchReleases).mockImplementation(async (_owner, repo) => {
				if (repo === "fontawesome") {
					throw new AuthenticationError("Authentication required for quarto-ext/fontawesome.", { cause: forbidden });
				}
				return [release("v2.0.0")];
			});

			const result = await checkForUpdates({ projectDirs: [tempDir], auth: TOKEN });

			expect(result.checkFailure?.kind).toBe("rate-limited");
			expect(result.checkFailure?.message).toContain("quarto-ext/fontawesome");
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

		expect(resolved.commitSha).toBe("abcdef1");
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
		expect(resolved.commitSha).toBe("1234567");
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
