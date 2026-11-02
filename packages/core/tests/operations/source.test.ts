/**
 * Tests for the Reinstall and Change Update Source targets.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { planSourceChange, reinstallTarget } from "../../src/operations/source.js";
import type { InstalledExtension } from "../../src/filesystem/discovery.js";
import type { SourceRecord } from "../../src/filesystem/sourceRecord.js";
import { ExtensionError } from "../../src/errors.js";

vi.mock("../../src/github/raw.js", () => ({
	fetchRawFile: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../src/github/releases.js", async () => {
	const actual = await vi.importActual<typeof import("../../src/github/releases.js")>("../../src/github/releases.js");
	return {
		...actual,
		fetchReleases: vi.fn().mockResolvedValue([]),
		fetchTags: vi.fn().mockResolvedValue([]),
		fetchLatestCommit: vi.fn().mockResolvedValue(null),
		fetchDefaultBranch: vi.fn().mockResolvedValue(undefined),
	};
});

import { fetchRawFile } from "../../src/github/raw.js";
import { fetchDefaultBranch, fetchLatestCommit, fetchReleases, fetchTags } from "../../src/github/releases.js";

const FULL_SHA = "abcdef0123456789abcdef0123456789abcdef01";

function tag(name: string) {
	return {
		name,
		sha: "1".repeat(40),
		zipballUrl: `https://example.test/${name}.zip`,
		tarballUrl: `https://example.test/${name}.tgz`,
	};
}

function installed(
	source: string | undefined,
	options: {
		version?: string;
		quartoWizard?: SourceRecord["quartoWizard"];
		kind?: SourceRecord["kind"];
		noRecord?: boolean;
	} = {},
): InstalledExtension {
	const { version = "1.4.0", quartoWizard, kind = "github", noRecord = false } = options;
	return {
		id: { owner: "o", name: "ext" },
		manifest: { title: "ext", version, source, sourceType: kind === "github" ? undefined : kind },
		manifestPath: "/p/_extensions/o/ext/_extension.yml",
		directory: "/p/_extensions/o/ext",
		record: noRecord || !source ? null : { version: 1, source, kind, files: {}, ...(quartoWizard && { quartoWizard }) },
		recordStatus: noRecord ? "absent" : "ok",
	} as unknown as InstalledExtension;
}

describe("reinstallTarget", () => {
	it("installs the recorded tag in tag mode", () => {
		expect(reinstallTarget(installed("o/ext@v1.4.0", { quartoWizard: { track: "tag" } }))).toEqual({
			source: "o/ext@v1.4.0",
			track: "tag",
		});
	});

	it.each(["2", "20240101"])("installs the dotless tag %s as a tag", (ref) => {
		expect(reinstallTarget(installed(`o/ext@${ref}`, { quartoWizard: { track: "tag" } }))).toEqual({
			source: `o/ext@${ref}`,
			track: "tag",
			refIsTag: true,
		});
	});

	it("installs a ref that is not a version as written in tag mode", () => {
		expect(reinstallTarget(installed("o/ext@abc1234", { quartoWizard: { track: "tag" } }))).toEqual({
			source: "o/ext@abc1234",
			track: "tag",
		});
	});

	it("leaves a branch ref of a record without a mode to the install, which records branch mode", () => {
		expect(reinstallTarget(installed("o/ext@dev"))).toEqual({ source: "o/ext@dev", track: "tag" });
	});

	it("installs the recorded commit of a tag-mode install without a version tag", () => {
		expect(reinstallTarget(installed("o/ext", { quartoWizard: { track: "tag", commit: FULL_SHA } }))).toEqual({
			source: `o/ext@${FULL_SHA}`,
			recordSource: "o/ext",
			track: "tag",
		});
	});

	it("installs the base, which is the latest tag, when the record names no ref and no commit", () => {
		expect(reinstallTarget(installed("o/ext", { quartoWizard: { track: "tag" } }))).toEqual({
			source: "o/ext",
			track: "tag",
		});
	});

	it("installs the latest tag for a record written by Quarto 2", () => {
		expect(reinstallTarget(installed("o/ext"))).toEqual({ source: "o/ext", track: "tag" });
		expect(reinstallTarget(installed("o/ext", { noRecord: true }))).toEqual({ source: "o/ext", track: "tag" });
	});

	it("installs the recorded commit in branch mode and keeps the recorded source", () => {
		expect(reinstallTarget(installed("o/ext", { quartoWizard: { track: "branch", commit: FULL_SHA } }))).toEqual({
			source: `o/ext@${FULL_SHA}`,
			recordSource: "o/ext",
			track: "branch",
		});
	});

	it("keeps an explicit branch in the record", () => {
		expect(reinstallTarget(installed("o/ext@dev", { quartoWizard: { track: "branch", commit: FULL_SHA } }))).toEqual({
			source: `o/ext@${FULL_SHA}`,
			recordSource: "o/ext@dev",
			track: "branch",
		});
	});

	it("installs the recorded source in branch mode when no commit was recorded", () => {
		expect(reinstallTarget(installed("o/ext@dev", { quartoWizard: { track: "branch" } }))).toEqual({
			source: "o/ext@dev",
			track: "branch",
		});
	});

	it("keeps a subdirectory in the base", () => {
		expect(
			reinstallTarget(installed("o/ext/sub", { quartoWizard: { track: "branch", commit: FULL_SHA } }))?.source,
		).toBe(`o/ext/sub@${FULL_SHA}`);
	});

	it("returns null for a source that is not on GitHub", () => {
		expect(reinstallTarget(installed("https://example.test/ext.zip", { kind: "url" }))).toBeNull();
		expect(reinstallTarget(installed(undefined))).toBeNull();
	});
});

describe("planSourceChange", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(fetchReleases).mockResolvedValue([]);
		vi.mocked(fetchTags).mockResolvedValue([]);
		vi.mocked(fetchLatestCommit).mockResolvedValue(FULL_SHA);
		vi.mocked(fetchDefaultBranch).mockResolvedValue("main");
		vi.mocked(fetchRawFile).mockResolvedValue(null);
	});

	it("targets the default branch head from tag mode and drops the tag", async () => {
		const change = await planSourceChange(installed("o/ext@v1.4.0", { quartoWizard: { track: "tag" } }), {});
		expect(change).toEqual({
			source: `o/ext@${FULL_SHA}`,
			recordSource: "o/ext",
			track: "branch",
			targetLabel: "main @ abcdef0",
			currentVersion: "1.4.0",
			isDowngrade: false,
		});
	});

	it("treats a q2-written record as tag mode", async () => {
		const change = await planSourceChange(installed("o/ext"), {});
		expect(change?.track).toBe("branch");
	});

	it("scopes the head lookup to a subdirectory", async () => {
		await planSourceChange(installed("o/ext/sub"), {});
		expect(fetchLatestCommit).toHaveBeenCalledWith("o", "ext", expect.objectContaining({ path: "sub" }));
	});

	it("falls back to a generic branch label when the default branch is unknown", async () => {
		vi.mocked(fetchDefaultBranch).mockResolvedValue(undefined);
		const change = await planSourceChange(installed("o/ext"), {});
		expect(change?.targetLabel).toBe("default branch @ abcdef0");
	});

	it("fails clearly when the default branch has no commit", async () => {
		vi.mocked(fetchLatestCommit).mockResolvedValue(null);
		await expect(planSourceChange(installed("o/ext"), {})).rejects.toThrow(ExtensionError);
	});

	it("targets the latest tag from branch mode and drops an explicit branch", async () => {
		vi.mocked(fetchTags).mockResolvedValue([tag("v1.5.0"), tag("v1.2.0")]);
		const change = await planSourceChange(
			installed("o/ext@dev", { version: "1.4.0", quartoWizard: { track: "branch", commit: FULL_SHA } }),
			{},
		);
		expect(change).toEqual({
			source: "o/ext@v1.5.0",
			track: "tag",
			targetLabel: "v1.5.0",
			currentVersion: "1.4.0",
			isDowngrade: false,
		});
	});

	it("flags a downgrade when the latest tag is below the installed version", async () => {
		vi.mocked(fetchTags).mockResolvedValue([tag("v1.2.0")]);
		const change = await planSourceChange(
			installed("o/ext", { version: "1.4.0", quartoWizard: { track: "branch", commit: FULL_SHA } }),
			{},
		);
		expect(change?.isDowngrade).toBe(true);
		expect(change?.source).toBe("o/ext@v1.2.0");
	});

	it("ignores prereleases for a stable install", async () => {
		vi.mocked(fetchTags).mockResolvedValue([tag("v2.0.0-beta.1"), tag("v1.5.0")]);
		const change = await planSourceChange(
			installed("o/ext", { quartoWizard: { track: "branch", commit: FULL_SHA } }),
			{},
		);
		expect(change?.targetLabel).toBe("v1.5.0");
	});

	it("installs the head in tag mode when the repository has no version tag", async () => {
		const change = await planSourceChange(
			installed("o/ext", { quartoWizard: { track: "branch", commit: FULL_SHA } }),
			{},
		);
		expect(change).toEqual({
			source: `o/ext@${FULL_SHA}`,
			recordSource: "o/ext",
			track: "tag",
			targetLabel: "main @ abcdef0",
			currentVersion: "1.4.0",
			isDowngrade: false,
		});
	});

	it("lets a prerelease install follow a prerelease tag", async () => {
		vi.mocked(fetchTags).mockResolvedValue([tag("v2.0.0-beta.1"), tag("v1.5.0")]);
		const change = await planSourceChange(
			installed("o/ext", { version: "2.0.0-alpha.1", quartoWizard: { track: "branch", commit: FULL_SHA } }),
			{},
		);
		expect(change?.targetLabel).toBe("v2.0.0-beta.1");
	});

	it("compares a subdirectory source on its manifest at the target tag, not on the repository tag", async () => {
		vi.mocked(fetchTags).mockResolvedValue([tag("v1.0.0")]);
		vi.mocked(fetchRawFile).mockImplementation(async (_o, _r, ref, filePath) =>
			ref === "v1.0.0" && filePath === "sub/_extension.yml" ? "title: ext\nversion: 2.0.0\n" : null,
		);
		const change = await planSourceChange(
			installed("o/ext/sub", { version: "1.4.0", quartoWizard: { track: "branch", commit: FULL_SHA } }),
			{},
		);
		expect(change?.isDowngrade).toBe(false);
	});

	it("flags a subdirectory downgrade when its manifest at the tag is lower", async () => {
		vi.mocked(fetchTags).mockResolvedValue([tag("v3.0.0")]);
		vi.mocked(fetchRawFile).mockImplementation(async (_o, _r, ref, filePath) =>
			ref === "v3.0.0" && filePath === "sub/_extension.yml" ? "title: ext\nversion: 1.0.0\n" : null,
		);
		const change = await planSourceChange(
			installed("o/ext/sub", { version: "1.4.0", quartoWizard: { track: "branch", commit: FULL_SHA } }),
			{},
		);
		expect(change?.isDowngrade).toBe(true);
	});

	it("does not flag a downgrade when the subdirectory manifest cannot be read", async () => {
		vi.mocked(fetchTags).mockResolvedValue([tag("v0.1.0")]);
		const change = await planSourceChange(
			installed("o/ext/sub", { version: "1.4.0", quartoWizard: { track: "branch", commit: FULL_SHA } }),
			{},
		);
		expect(change?.isDowngrade).toBe(false);
	});

	it("flags a downgrade to the tag equal to the first parts of an extended installed version", async () => {
		vi.mocked(fetchTags).mockResolvedValue([tag("v1.0.0")]);
		const change = await planSourceChange(
			installed("o/ext", { version: "1.0.0.9000", quartoWizard: { track: "branch", commit: FULL_SHA } }),
			{},
		);
		expect(change?.isDowngrade).toBe(true);
	});

	it("lower-cases the head commit in the source", async () => {
		vi.mocked(fetchLatestCommit).mockResolvedValue(FULL_SHA.toUpperCase());
		const change = await planSourceChange(installed("o/ext"), {});
		expect(change?.source).toBe(`o/ext@${FULL_SHA}`);
		expect(change?.targetLabel).toBe("main @ abcdef0");
	});

	it("returns null for a source that is not on GitHub", async () => {
		expect(await planSourceChange(installed("https://example.test/ext.zip", { kind: "url" }), {})).toBeNull();
		expect(fetchLatestCommit).not.toHaveBeenCalled();
	});
});
