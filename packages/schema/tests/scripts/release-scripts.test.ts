import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, afterEach } from "vitest";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const scriptsDir = join(pkgRoot, "scripts");

// Both scripts are release tooling, and the release workflow runs on
// `ubuntu-latest` alone. The suite that holds them runs on the Windows cell of
// the build matrix too, where a shebang is not executable, so the cases are
// skipped there rather than spawned through whichever `bash` that runner has.
const onAShell = describe.runIf(process.platform !== "win32");

const workspaces: string[] = [];

afterEach(() => {
	for (const workspace of workspaces.splice(0)) {
		rmSync(workspace, { recursive: true, force: true });
	}
});

// `stamp-version.sh` reads the module and the changelog beside itself, so a
// test gives it a package of its own rather than the one it ships in.
function makeWorkspace(module: string, changelog: string): string {
	const workspace = mkdtempSync(join(tmpdir(), "schema-scripts-"));
	workspaces.push(workspace);
	mkdirSync(join(workspace, "scripts"));
	mkdirSync(join(workspace, "src", "validation"), { recursive: true });
	const script = join(workspace, "scripts", "stamp-version.sh");
	copyFileSync(join(scriptsDir, "stamp-version.sh"), script);
	// Stated rather than inherited from the copy, so a checkout that does not
	// keep the mode fails on the release workflow and not here, with a message
	// about the mode rather than an EACCES from every case.
	chmodSync(script, 0o755);
	writeFileSync(join(workspace, "src", "validation", "schema.lua"), module);
	writeFileSync(join(workspace, "CHANGELOG.md"), changelog);
	return workspace;
}

function stamp(workspace: string, version: string) {
	return spawnSync(join(workspace, "scripts", "stamp-version.sh"), [version], { encoding: "utf-8" });
}

function section(changelog: string, heading: string) {
	const workspace = mkdtempSync(join(tmpdir(), "schema-sections-"));
	workspaces.push(workspace);
	const path = join(workspace, "CHANGELOG.md");
	writeFileSync(path, changelog);
	return spawnSync(join(scriptsDir, "changelog-section.sh"), [path, heading], { encoding: "utf-8" });
}

function read(workspace: string, ...parts: string[]): string {
	return readFileSync(join(workspace, ...parts), "utf-8");
}

const moduleWithTwoTags = ["--- @version 2.1.0", "local M = {}", "--- @version 9.9.9", "return M", ""].join("\n");

// The preamble carries the word `Unreleased` ahead of the heading, as the
// real changelog carries prose ahead of its first section. A match on the word
// rather than on the whole line rewrites this line and never reaches the
// heading.
const changelogWithEntries = [
	"# Changelog",
	"",
	"An entry that is Unreleased has no version of its own yet.",
	"",
	"## Unreleased",
	"",
	"### Bug Fixes",
	"",
	"- fix: An entry whose prose says Unreleased. (#1)",
	"",
	"## 2.1.0",
	"",
	"- feat: Old. (#0)",
	"",
].join("\n");

onAShell("stamp-version.sh", () => {
	it("rewrites the first @version tag and leaves a later one alone", () => {
		const workspace = makeWorkspace(moduleWithTwoTags, changelogWithEntries);

		expect(stamp(workspace, "2.2.0").status).toBe(0);

		const lines = read(workspace, "src", "validation", "schema.lua").split("\n");
		expect(lines[0]).toBe("--- @version 2.2.0");
		expect(lines[2]).toBe("--- @version 9.9.9");
	});

	it("renames the Unreleased heading, opens an empty one, and keeps the entries", () => {
		const workspace = makeWorkspace(moduleWithTwoTags, changelogWithEntries);

		expect(stamp(workspace, "2.2.0").status).toBe(0);

		expect(read(workspace, "CHANGELOG.md")).toContain(
			["## Unreleased", "", "## 2.2.0", "", "### Bug Fixes"].join("\n"),
		);
	});

	// The heading is matched as a whole line, so an entry that carries the
	// word in its prose is left as it was written.
	it("leaves prose that carries the heading word, before the heading and after it", () => {
		const workspace = makeWorkspace(moduleWithTwoTags, changelogWithEntries);

		expect(stamp(workspace, "2.2.0").status).toBe(0);

		const changelog = read(workspace, "CHANGELOG.md");
		expect(changelog).toContain("An entry that is Unreleased has no version of its own yet.");
		expect(changelog).toContain("- fix: An entry whose prose says Unreleased. (#1)");
	});

	it("refuses a changelog with no Unreleased heading, and writes neither file", () => {
		const changelog = ["# Changelog", "", "## 2.1.0", "", "- feat: Old. (#0)", ""].join("\n");
		const workspace = makeWorkspace(moduleWithTwoTags, changelog);

		const result = stamp(workspace, "2.2.0");

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('No "## Unreleased" heading');
		expect(read(workspace, "src", "validation", "schema.lua")).toBe(moduleWithTwoTags);
		expect(read(workspace, "CHANGELOG.md")).toBe(changelog);
	});

	it("refuses a module with no @version tag", () => {
		const workspace = makeWorkspace("local M = {}\nreturn M\n", changelogWithEntries);

		const result = stamp(workspace, "2.2.0");

		expect(result.status).toBe(1);
		expect(result.stderr).toContain("No @version tag");
		expect(read(workspace, "CHANGELOG.md")).toBe(changelogWithEntries);
	});

	it.each(["2.2", "v2.2.0", "next", ""])("refuses the version %j", (version) => {
		const workspace = makeWorkspace(moduleWithTwoTags, changelogWithEntries);

		expect(stamp(workspace, version).status).toBe(2);
		expect(read(workspace, "src", "validation", "schema.lua")).toBe(moduleWithTwoTags);
	});
});

onAShell("changelog-section.sh", () => {
	it("prints the body of a section, subheadings included", () => {
		const result = section(changelogWithEntries, "Unreleased");

		expect(result.status).toBe(0);
		expect(result.stdout).toContain("### Bug Fixes");
		expect(result.stdout).toContain("- fix: An entry whose prose says Unreleased. (#1)");
	});

	it("stops at the next section", () => {
		const result = section(changelogWithEntries, "Unreleased");

		expect(result.stdout).not.toContain("- feat: Old. (#0)");
	});

	// The gate the release train needs: a heading renamed over a section with
	// no entry leaves the single blank line between two headings, which is one
	// byte, so a test on the size of the file reads it as a body.
	it.each([
		{ shape: "one blank line", body: [""] },
		{ shape: "lines of spaces and tabs", body: ["", "   ", "\t", ""] },
	])("refuses a section that holds only $shape", ({ body }) => {
		const changelog = ["# Changelog", "", "## Unreleased", ...body, "## 2.1.0", "", "- feat: Old. (#0)", ""].join("\n");

		const result = section(changelog, "Unreleased");

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('No entries under a "## Unreleased" heading');
		expect(result.stdout).toBe("");
	});

	it("refuses a heading that is absent", () => {
		const result = section(changelogWithEntries, "9.9.9");

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('No entries under a "## 9.9.9" heading');
	});

	it("refuses a changelog that is absent", () => {
		const result = spawnSync(
			join(scriptsDir, "changelog-section.sh"),
			[join(tmpdir(), "no-such-changelog.md"), "Unreleased"],
			{
				encoding: "utf-8",
			},
		);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain("No changelog at");
	});
});
