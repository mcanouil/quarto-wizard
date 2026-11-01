// Runs the real Quarto 2 binary against the install record that core writes
// and reads. It reports four checks and exits 1 if any fails.
//
// Usage: node scripts/q2-compat.mjs <path to q2>
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const { getInstalledState, install, parseInstallSource, readSourceRecord } = require("../dist/index.js");

const q2 = process.argv[2];
if (!q2) {
	console.error("Usage: node scripts/q2-compat.mjs <path to q2>");
	process.exit(2);
}

const fixtureSource = path.resolve(here, "../tests/fixtures/q2-record-source");
const extensionPath = path.join("_extensions", "recorded");
const scratchDirs = [];

function scratch(prefix) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	scratchDirs.push(dir);
	return dir;
}

function runQ2(source, projectDir, flags = []) {
	const result = spawnSync(q2, ["add", source, "--trust", "--no-prompt", "--dir", projectDir, ...flags], {
		encoding: "utf-8",
	});
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(`q2 add exited ${result.status}: ${result.stderr.trim() || result.stdout.trim()}`);
	}
	return result;
}

function q2Json(source, projectDir, flags = []) {
	return JSON.parse(runQ2(source, projectDir, ["--json", ...flags]).stdout);
}

async function coreInstall(source, projectDir) {
	await install(parseInstallSource(source), { projectDir });
}

// The same extension at a higher version, so that q2 reaches its local-edit
// check instead of answering "no-change".
function newerSource() {
	const dir = scratch("q2-compat-newer-");
	fs.cpSync(fixtureSource, dir, { recursive: true });
	const manifest = path.join(dir, extensionPath, "_extension.yml");
	const text = fs.readFileSync(manifest, "utf-8");
	if (!/^version:\s*1\.0\.0/m.test(text)) {
		throw new Error(`${manifest} does not declare version 1.0.0`);
	}
	fs.writeFileSync(manifest, text.replace(/^(version:\s*)1\.0\.0/m, "$11.1.0"));
	return dir;
}

const checks = [
	[
		"core reads the record that q2 wrote as unmodified",
		async () => {
			const project = scratch("q2-compat-q2-");
			runQ2(fixtureSource, project);
			const state = getInstalledState(path.join(project, extensionPath));
			if (state.kind !== "unmodified") {
				throw new Error(`state is ${state.kind}: ${JSON.stringify(state.edits ?? [])}`);
			}
		},
	],
	[
		"q2 reports no-change for an extension that core installed",
		async () => {
			const project = scratch("q2-compat-core-");
			await coreInstall(fixtureSource, project);
			const action = q2Json(fixtureSource, project).extensions?.[0]?.action;
			if (action !== "no-change") {
				throw new Error(`action is ${action}`);
			}
		},
	],
	[
		"core writes the same files map as q2",
		async () => {
			const q2Project = scratch("q2-compat-q2-");
			const coreProject = scratch("q2-compat-core-");
			runQ2(fixtureSource, q2Project);
			await coreInstall(fixtureSource, coreProject);
			const read = (project) => {
				const result = readSourceRecord(path.join(project, extensionPath));
				if (result.status !== "ok") {
					throw new Error(`record in ${project} is ${result.status}`);
				}
				return result.record.files;
			};
			const expected = JSON.stringify(Object.entries(read(q2Project)));
			const actual = JSON.stringify(Object.entries(read(coreProject)));
			if (expected !== actual) {
				throw new Error(`q2 wrote ${expected}, core wrote ${actual}`);
			}
		},
	],
	[
		"q2 finds no local edits in an extension that core installed",
		async () => {
			const project = scratch("q2-compat-core-");
			await coreInstall(fixtureSource, project);
			const action = q2Json(newerSource(), project, ["--dry-run"]).extensions?.[0]?.action;
			if (action !== "update") {
				throw new Error(`action is ${action}`);
			}
		},
	],
];

let failed = false;
let heading = "### Quarto 2 compatibility (q2 unknown)";
const lines = [];
try {
	let version;
	try {
		version = execFileSync(q2, ["--version"], { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
		heading = `### Quarto 2 compatibility (q2 ${version})`;
	} catch (error) {
		failed = true;
		lines.push(`FAIL 0 q2 --version: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (version !== undefined) {
		for (const [index, [description, run]] of checks.entries()) {
			const n = index + 1;
			try {
				await run();
				lines.push(`PASS ${n} ${description}`);
			} catch (error) {
				failed = true;
				lines.push(`FAIL ${n} ${description}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	}
} finally {
	for (const dir of scratchDirs) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

console.log(lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) {
	fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${heading}\n\n\`\`\`text\n${lines.join("\n")}\n\`\`\`\n`);
}
process.exit(failed ? 1 : 0);
