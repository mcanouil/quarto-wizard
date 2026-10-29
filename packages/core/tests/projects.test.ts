import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { discoverProjectDirs } from "../src/filesystem/projects.js";

describe("projects.ts", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "projects-test-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	function write(relativePath: string, content = ""): void {
		const target = path.join(tempDir, relativePath);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, content);
	}

	function manifest(relativeDir: string, extra = ""): void {
		write(`${relativeDir}/_extension.yml`, `title: T\nauthor: A\nversion: 1.0.0\ncontributes: {}\n${extra}`);
	}

	const relativePaths = () => discoverProjectDirs(tempDir).map((project) => project.relativePath);

	it("finds root and sub-folder projects together", () => {
		manifest("_extensions/a/x");
		write("docs/_quarto.yml");
		manifest("docs/_extensions/b/y");

		expect(relativePaths()).toEqual([".", "docs"]);
	});

	it("stops at folder depth 2", () => {
		manifest("a/b/_extensions/o/n");
		manifest("a/b/c/_extensions/o/n");

		expect(relativePaths()).toEqual(["a/b"]);
	});

	it("ignores an empty _extensions folder", () => {
		fs.mkdirSync(path.join(tempDir, "_extensions"));
		expect(relativePaths()).toEqual([]);

		write("_quarto.yml");
		const projects = discoverProjectDirs(tempDir);
		expect(projects.map((project) => project.relativePath)).toEqual(["."]);
		expect(projects[0].hasQuartoConfig).toBe(true);
	});

	it("finds embedded parents with and without owner", () => {
		manifest("_extensions/astek");
		manifest("_extensions/astek/_extensions/mcanouil/cascade");
		manifest("_extensions/acme/fmt");
		manifest("_extensions/acme/fmt/_extensions/tabset");

		const embedded = discoverProjectDirs(tempDir).filter((project) => project.embeddedIn);

		expect(embedded.map((project) => project.relativePath)).toEqual(["_extensions/acme/fmt", "_extensions/astek"]);
		expect(embedded[0].embeddedIn?.id).toEqual({ owner: "acme", name: "fmt" });
		expect(embedded[1].embeddedIn?.id).toEqual({ owner: null, name: "astek" });
		expect(embedded[0].hasQuartoConfig).toBe(false);
	});

	it("does not follow embedding past depth 1", () => {
		manifest("_extensions/x");
		manifest("_extensions/x/_extensions/y");
		manifest("_extensions/x/_extensions/y/_extensions/z");

		expect(relativePaths()).toEqual([".", "_extensions/x"]);
	});

	it("copies the parent source", () => {
		manifest("_extensions/acme/fmt", "source: acme/fmt@1.0.0\n");
		manifest("_extensions/acme/fmt/_extensions/inner");
		manifest("_extensions/local");
		manifest("_extensions/local/_extensions/inner");

		const embedded = discoverProjectDirs(tempDir).filter((project) => project.embeddedIn);

		expect(embedded.find((p) => p.embeddedIn?.id.name === "fmt")?.embeddedIn?.source).toBe("acme/fmt@1.0.0");
		expect(embedded.find((p) => p.embeddedIn?.id.name === "local")?.embeddedIn?.source).toBeUndefined();
	});

	it("honours exclude patterns", () => {
		manifest("node_modules/pkg/_extensions/o/n");
		manifest("vendor/pkg/_extensions/o/n");

		const projects = discoverProjectDirs(tempDir, { excludePatterns: ["**/vendor"] });

		expect(projects).toEqual([]);
	});

	it("skips node_modules and .git without patterns", () => {
		manifest("node_modules/_extensions/o/n");
		manifest(".git/_extensions/o/n");

		expect(relativePaths()).toEqual([]);
	});

	it("skips symbolic links and unreadable folders", () => {
		write("_quarto.yml");
		fs.symlinkSync(tempDir, path.join(tempDir, "loop"), "junction");
		const locked = path.join(tempDir, "locked");
		fs.mkdirSync(locked);
		if (process.platform !== "win32") {
			fs.chmodSync(locked, 0o000);
		}

		try {
			expect(relativePaths()).toEqual(["."]);
		} finally {
			fs.chmodSync(locked, 0o755);
		}
	});

	it("returns early when aborted", () => {
		write("_quarto.yml");
		const controller = new AbortController();
		controller.abort();

		expect(discoverProjectDirs(tempDir, { signal: controller.signal })).toEqual([]);
	});
});
