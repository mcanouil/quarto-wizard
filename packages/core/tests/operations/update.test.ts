/**
 * Tests for extension update operations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { checkForUpdates } from "../../src/operations/update.js";

vi.mock("../../src/registry/fetcher.js", () => ({
	fetchRegistry: vi.fn(),
}));

vi.mock("../../src/github/releases.js", async () => {
	const actual = await vi.importActual<typeof import("../../src/github/releases.js")>("../../src/github/releases.js");
	return {
		...actual,
		fetchReleases: vi.fn().mockResolvedValue([]),
		fetchTags: vi.fn().mockResolvedValue([]),
	};
});

import { fetchRegistry } from "../../src/registry/fetcher.js";
import { fetchReleases, fetchTags } from "../../src/github/releases.js";

describe("checkForUpdates", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qw-update-test-"));
		vi.clearAllMocks();
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	function setupExtension(owner: string, name: string, version: string, source?: string): void {
		const extDir = path.join(tempDir, "_extensions", owner, name);
		fs.mkdirSync(extDir, { recursive: true });

		let manifest = `title: ${name}\nversion: ${version}\n`;
		if (source) {
			manifest += `source: ${source}\n`;
		}

		fs.writeFileSync(path.join(extDir, "_extension.yml"), manifest);
	}

	it("should find updates when newer version available", async () => {
		setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome@v1.0.0");

		vi.mocked(fetchRegistry).mockResolvedValue({
			"quarto-ext/fontawesome": {
				fullName: "quarto-ext/fontawesome",
				latestVersion: "2.0.0",
				latestTag: "v2.0.0",
				latestReleaseUrl: "https://github.com/quarto-ext/fontawesome/releases/tag/v2.0.0",
			},
		});

		const updates = await checkForUpdates({ projectDir: tempDir });

		expect(updates).toHaveLength(1);
		expect(updates[0].currentVersion).toBe("1.0.0");
		expect(updates[0].latestVersion).toBe("2.0.0");
		expect(updates[0].source).toBe("quarto-ext/fontawesome@v2.0.0");
	});

	it("should not find updates when already at latest", async () => {
		setupExtension("quarto-ext", "fontawesome", "2.0.0", "quarto-ext/fontawesome@v2.0.0");

		vi.mocked(fetchRegistry).mockResolvedValue({
			"quarto-ext/fontawesome": {
				fullName: "quarto-ext/fontawesome",
				latestVersion: "2.0.0",
				latestTag: "v2.0.0",
				latestReleaseUrl: null,
			},
		});

		const updates = await checkForUpdates({ projectDir: tempDir });

		expect(updates).toHaveLength(0);
	});

	it("should skip extensions without source", async () => {
		setupExtension("quarto-ext", "fontawesome", "1.0.0");

		vi.mocked(fetchRegistry).mockResolvedValue({
			"quarto-ext/fontawesome": {
				fullName: "quarto-ext/fontawesome",
				latestVersion: "2.0.0",
				latestTag: "v2.0.0",
				latestReleaseUrl: null,
			},
		});

		const updates = await checkForUpdates({ projectDir: tempDir });

		expect(updates).toHaveLength(0);
	});

	it("should skip extensions not in registry", async () => {
		setupExtension("unknown", "extension", "1.0.0", "unknown/extension");

		vi.mocked(fetchRegistry).mockResolvedValue({
			"quarto-ext/fontawesome": {
				fullName: "quarto-ext/fontawesome",
				latestVersion: "2.0.0",
				latestTag: "v2.0.0",
				latestReleaseUrl: null,
			},
		});

		const updates = await checkForUpdates({ projectDir: tempDir });

		expect(updates).toHaveLength(0);
	});

	it("should check specific extension when provided", async () => {
		setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome");
		setupExtension("quarto-ext", "lightbox", "1.0.0", "quarto-ext/lightbox");

		vi.mocked(fetchRegistry).mockResolvedValue({
			"quarto-ext/fontawesome": {
				fullName: "quarto-ext/fontawesome",
				latestVersion: "2.0.0",
				latestTag: "v2.0.0",
				latestReleaseUrl: null,
			},
			"quarto-ext/lightbox": {
				fullName: "quarto-ext/lightbox",
				latestVersion: "2.0.0",
				latestTag: "v2.0.0",
				latestReleaseUrl: null,
			},
		});

		const updates = await checkForUpdates({
			projectDir: tempDir,
			extension: { owner: "quarto-ext", name: "fontawesome" },
		});

		expect(updates).toHaveLength(1);
		expect(updates[0].extension.id.name).toBe("fontawesome");
	});

	it("should handle version prefixed with v", async () => {
		setupExtension("quarto-ext", "fontawesome", "v1.0.0", "quarto-ext/fontawesome");

		vi.mocked(fetchRegistry).mockResolvedValue({
			"quarto-ext/fontawesome": {
				fullName: "quarto-ext/fontawesome",
				latestVersion: "v2.0.0",
				latestTag: "v2.0.0",
				latestReleaseUrl: null,
			},
		});

		const updates = await checkForUpdates({ projectDir: tempDir });

		expect(updates).toHaveLength(1);
		expect(updates[0].currentVersion).toBe("1.0.0");
		expect(updates[0].latestVersion).toBe("2.0.0");
	});

	it("should handle case-insensitive registry lookup", async () => {
		setupExtension("Quarto-Ext", "FontAwesome", "1.0.0", "Quarto-Ext/FontAwesome");

		vi.mocked(fetchRegistry).mockResolvedValue({
			"quarto-ext/fontawesome": {
				fullName: "quarto-ext/fontawesome",
				latestVersion: "2.0.0",
				latestTag: "v2.0.0",
				latestReleaseUrl: null,
			},
		});

		const updates = await checkForUpdates({ projectDir: tempDir });

		expect(updates).toHaveLength(1);
	});

	it("should return empty for no installed extensions", async () => {
		vi.mocked(fetchRegistry).mockResolvedValue({});

		const updates = await checkForUpdates({ projectDir: tempDir });

		expect(updates).toHaveLength(0);
	});

	it("should detect commit-based updates when latestCommit changes", async () => {
		setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome@abc1234");

		vi.mocked(fetchRegistry).mockResolvedValue({
			"quarto-ext/fontawesome": {
				fullName: "quarto-ext/fontawesome",
				latestVersion: null,
				latestTag: null,
				latestReleaseUrl: null,
				latestCommit: "def5678901234567890abcdef1234567890abcdef",
				htmlUrl: "https://github.com/quarto-ext/fontawesome",
			},
		});

		const updates = await checkForUpdates({ projectDir: tempDir });

		expect(updates).toHaveLength(1);
		expect(updates[0].currentVersion).toBe("abc1234");
		expect(updates[0].latestVersion).toBe("def5678");
		expect(updates[0].source).toBe("quarto-ext/fontawesome@def5678");
	});

	it("should not flag commit-based update when commits match", async () => {
		setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome@abc1234");

		vi.mocked(fetchRegistry).mockResolvedValue({
			"quarto-ext/fontawesome": {
				fullName: "quarto-ext/fontawesome",
				latestVersion: null,
				latestTag: null,
				latestReleaseUrl: null,
				latestCommit: "abc1234567890abcdef1234567890abcdef123456",
				htmlUrl: "https://github.com/quarto-ext/fontawesome",
			},
		});

		const updates = await checkForUpdates({ projectDir: tempDir });

		expect(updates).toHaveLength(0);
	});

	it("should skip commit-based extension if registry has no latestCommit", async () => {
		setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome@abc1234");

		vi.mocked(fetchRegistry).mockResolvedValue({
			"quarto-ext/fontawesome": {
				fullName: "quarto-ext/fontawesome",
				latestVersion: null,
				latestTag: null,
				latestReleaseUrl: null,
				latestCommit: null,
				htmlUrl: "https://github.com/quarto-ext/fontawesome",
			},
		});

		const updates = await checkForUpdates({ projectDir: tempDir });

		expect(updates).toHaveLength(0);
	});

	it("should use semver for non-commit sources even with latestCommit available", async () => {
		setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome@v1.0.0");

		vi.mocked(fetchRegistry).mockResolvedValue({
			"quarto-ext/fontawesome": {
				fullName: "quarto-ext/fontawesome",
				latestVersion: "2.0.0",
				latestTag: "v2.0.0",
				latestReleaseUrl: "https://github.com/quarto-ext/fontawesome/releases/tag/v2.0.0",
				latestCommit: "abc1234567890",
				htmlUrl: "https://github.com/quarto-ext/fontawesome",
			},
		});

		const updates = await checkForUpdates({ projectDir: tempDir });

		expect(updates).toHaveLength(1);
		expect(updates[0].currentVersion).toBe("1.0.0");
		expect(updates[0].latestVersion).toBe("2.0.0");
		expect(updates[0].source).toBe("quarto-ext/fontawesome@v2.0.0");
	});

	it("should find updates for registry-sourced extension with version ref", async () => {
		// Simulates: source-type: registry, source: mcanouil/quarto-remember@1.0.0
		const extDir = path.join(tempDir, "_extensions", "mcanouil", "remember");
		fs.mkdirSync(extDir, { recursive: true });
		fs.writeFileSync(
			path.join(extDir, "_extension.yml"),
			"title: remember\nversion: 1.0.0\nsource: mcanouil/quarto-remember@1.0.0\nsource-type: registry\n",
		);

		vi.mocked(fetchRegistry).mockResolvedValue({
			"mcanouil/quarto-remember": {
				fullName: "mcanouil/quarto-remember",
				latestVersion: "1.1.0",
				latestTag: "1.1.0",
				latestReleaseUrl: "https://github.com/mcanouil/quarto-remember/releases/tag/1.1.0",
				latestCommit: null,
				htmlUrl: "https://github.com/mcanouil/quarto-remember",
			},
		});

		const updates = await checkForUpdates({ projectDir: tempDir });

		expect(updates).toHaveLength(1);
		expect(updates[0].currentVersion).toBe("1.0.0");
		expect(updates[0].latestVersion).toBe("1.1.0");
		expect(updates[0].source).toBe("mcanouil/quarto-remember@1.1.0");
	});

	it("should handle case-insensitive commit comparison", async () => {
		setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome@ABC1234");

		vi.mocked(fetchRegistry).mockResolvedValue({
			"quarto-ext/fontawesome": {
				fullName: "quarto-ext/fontawesome",
				latestVersion: null,
				latestTag: null,
				latestReleaseUrl: null,
				latestCommit: "abc1234567890abcdef",
				htmlUrl: "https://github.com/quarto-ext/fontawesome",
			},
		});

		const updates = await checkForUpdates({ projectDir: tempDir });

		expect(updates).toHaveLength(0);
	});

	describe("source-type awareness", () => {
		function setupExtensionWithType(
			owner: string,
			name: string,
			version: string,
			source: string,
			sourceType: string,
		): void {
			const extDir = path.join(tempDir, "_extensions", owner, name);
			fs.mkdirSync(extDir, { recursive: true });
			fs.writeFileSync(
				path.join(extDir, "_extension.yml"),
				`title: ${name}\nversion: ${version}\nsource: ${source}\nsource-type: ${sourceType}\n`,
			);
		}

		it("resolves github-sourced extensions against GitHub releases, not the registry", async () => {
			setupExtensionWithType("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome", "github");

			vi.mocked(fetchReleases).mockResolvedValue([
				{
					tagName: "v2.5.0",
					name: "v2.5.0",
					zipballUrl: "",
					tarballUrl: "",
					htmlUrl: "https://github.com/quarto-ext/fontawesome/releases/tag/v2.5.0",
					publishedAt: "",
					prerelease: false,
					draft: false,
				},
			]);
			vi.mocked(fetchRegistry).mockResolvedValue({
				"quarto-ext/fontawesome": {
					fullName: "quarto-ext/fontawesome",
					latestVersion: "2.0.0",
					latestTag: "v2.0.0",
					latestReleaseUrl: null,
				},
			});

			const updates = await checkForUpdates({ projectDir: tempDir });

			expect(fetchRegistry).not.toHaveBeenCalled();
			expect(updates).toHaveLength(1);
			expect(updates[0].latestVersion).toBe("2.5.0");
			expect(updates[0].source).toBe("quarto-ext/fontawesome@v2.5.0");
			expect(updates[0].releaseUrl).toBe("https://github.com/quarto-ext/fontawesome/releases/tag/v2.5.0");
		});

		it("falls back to tags when a github-sourced repo has no releases", async () => {
			setupExtensionWithType("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome", "github");

			vi.mocked(fetchReleases).mockResolvedValue([]);
			vi.mocked(fetchTags).mockResolvedValue([
				{ name: "v3.0.0", sha: "abc", zipballUrl: "", tarballUrl: "" },
			]);

			const updates = await checkForUpdates({ projectDir: tempDir });

			expect(updates).toHaveLength(1);
			expect(updates[0].latestVersion).toBe("3.0.0");
			expect(updates[0].source).toBe("quarto-ext/fontawesome@v3.0.0");
		});

		it("does not emit an update for github sources with no releases or tags by default", async () => {
			setupExtensionWithType("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome", "github");

			vi.mocked(fetchReleases).mockResolvedValue([]);
			vi.mocked(fetchTags).mockResolvedValue([]);
			vi.mocked(fetchRegistry).mockResolvedValue({
				"quarto-ext/fontawesome": {
					fullName: "quarto-ext/fontawesome",
					latestVersion: "2.0.0",
					latestTag: "v2.0.0",
					latestReleaseUrl: null,
				},
			});

			const updates = await checkForUpdates({ projectDir: tempDir });

			expect(fetchRegistry).not.toHaveBeenCalled();
			expect(updates).toHaveLength(0);
		});

		it("falls back to the registry for github sources when crossSource is enabled", async () => {
			setupExtensionWithType("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome", "github");

			vi.mocked(fetchReleases).mockResolvedValue([]);
			vi.mocked(fetchTags).mockResolvedValue([]);
			vi.mocked(fetchRegistry).mockResolvedValue({
				"quarto-ext/fontawesome": {
					fullName: "quarto-ext/fontawesome",
					latestVersion: "2.0.0",
					latestTag: "v2.0.0",
					latestReleaseUrl: "https://github.com/quarto-ext/fontawesome/releases/tag/v2.0.0",
				},
			});

			const updates = await checkForUpdates({ projectDir: tempDir, crossSource: true });

			expect(fetchRegistry).toHaveBeenCalledTimes(1);
			expect(updates).toHaveLength(1);
			expect(updates[0].latestVersion).toBe("2.0.0");
		});

		it("never checks updates for url-sourced extensions", async () => {
			setupExtensionWithType("vendor", "zipped", "1.0.0", "https://example.com/ext.zip", "url");

			vi.mocked(fetchRegistry).mockResolvedValue({});

			const updates = await checkForUpdates({ projectDir: tempDir, crossSource: true });

			expect(updates).toHaveLength(0);
			expect(fetchReleases).not.toHaveBeenCalled();
			expect(fetchTags).not.toHaveBeenCalled();
		});

		it("never checks updates for local-sourced extensions", async () => {
			setupExtensionWithType("vendor", "local", "1.0.0", "/tmp/my-ext", "local");

			vi.mocked(fetchRegistry).mockResolvedValue({});

			const updates = await checkForUpdates({ projectDir: tempDir, crossSource: true });

			expect(updates).toHaveLength(0);
			expect(fetchReleases).not.toHaveBeenCalled();
			expect(fetchTags).not.toHaveBeenCalled();
		});

		it("skips prerelease tags when falling back to tags for a github-sourced repo", async () => {
			setupExtensionWithType("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome", "github");

			vi.mocked(fetchReleases).mockResolvedValue([]);
			vi.mocked(fetchTags).mockResolvedValue([
				{ name: "v3.0.0-beta.1", sha: "abc", zipballUrl: "", tarballUrl: "" },
				{ name: "v2.1.0", sha: "def", zipballUrl: "", tarballUrl: "" },
			]);

			const updates = await checkForUpdates({ projectDir: tempDir });

			expect(updates).toHaveLength(1);
			expect(updates[0].latestVersion).toBe("2.1.0");
			expect(updates[0].source).toBe("quarto-ext/fontawesome@v2.1.0");
		});

		it("continues with tags when fetching releases throws", async () => {
			setupExtensionWithType("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome", "github");

			vi.mocked(fetchReleases).mockRejectedValue(new Error("boom"));
			vi.mocked(fetchTags).mockResolvedValue([{ name: "v2.0.0", sha: "abc", zipballUrl: "", tarballUrl: "" }]);

			const updates = await checkForUpdates({ projectDir: tempDir });

			expect(updates).toHaveLength(1);
			expect(updates[0].latestVersion).toBe("2.0.0");
		});

		it("emits no update when both releases and tags throw", async () => {
			setupExtensionWithType("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome", "github");

			vi.mocked(fetchReleases).mockRejectedValue(new Error("releases boom"));
			vi.mocked(fetchTags).mockRejectedValue(new Error("tags boom"));

			const updates = await checkForUpdates({ projectDir: tempDir });

			expect(updates).toHaveLength(0);
		});

		it("falls back to the registry with crossSource when both GitHub calls throw", async () => {
			setupExtensionWithType("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome", "github");

			vi.mocked(fetchReleases).mockRejectedValue(new Error("releases boom"));
			vi.mocked(fetchTags).mockRejectedValue(new Error("tags boom"));
			vi.mocked(fetchRegistry).mockResolvedValue({
				"quarto-ext/fontawesome": {
					fullName: "quarto-ext/fontawesome",
					latestVersion: "2.0.0",
					latestTag: "v2.0.0",
					latestReleaseUrl: null,
				},
			});

			const updates = await checkForUpdates({ projectDir: tempDir, crossSource: true });

			expect(updates).toHaveLength(1);
			expect(updates[0].latestVersion).toBe("2.0.0");
		});

		it("skips GitHub network calls for commit-pinned github-sourced extensions", async () => {
			setupExtensionWithType(
				"quarto-ext",
				"fontawesome",
				"abc1234",
				"quarto-ext/fontawesome@abc1234",
				"github",
			);

			const updates = await checkForUpdates({ projectDir: tempDir });

			expect(fetchReleases).not.toHaveBeenCalled();
			expect(fetchTags).not.toHaveBeenCalled();
			expect(updates).toHaveLength(0);
		});
	});
});
