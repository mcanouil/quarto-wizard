import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { normaliseManifest, getExtensionTypes, inferSourceType } from "../src/types/manifest.js";
import {
	parseManifestContent,
	parseManifestFile,
	findManifestFile,
	readManifest,
	hasManifest,
	updateManifestSource,
} from "../src/filesystem/manifest.js";
import { ManifestError } from "../src/errors.js";

describe("normaliseManifest", () => {
	it("normalises a complete manifest", () => {
		const raw = {
			title: "Lightbox",
			author: "Quarto",
			version: "1.0.0",
			"quarto-required": ">=1.3.0",
			contributes: {
				filters: ["lightbox.lua"],
				shortcodes: ["lb.lua"],
			},
			source: "quarto-ext/lightbox",
		};

		const manifest = normaliseManifest(raw);

		expect(manifest.title).toBe("Lightbox");
		expect(manifest.author).toBe("Quarto");
		expect(manifest.version).toBe("1.0.0");
		expect(manifest.quartoRequired).toBe(">=1.3.0");
		expect(manifest.contributes.filter).toEqual(["lightbox.lua"]);
		expect(manifest.contributes.shortcode).toEqual(["lb.lua"]);
		expect(manifest.source).toBe("quarto-ext/lightbox");
	});

	it("handles missing optional fields", () => {
		const raw = {
			title: "Minimal",
		};

		const manifest = normaliseManifest(raw);

		expect(manifest.title).toBe("Minimal");
		expect(manifest.author).toBe("");
		expect(manifest.version).toBe("");
		expect(manifest.quartoRequired).toBeUndefined();
		expect(manifest.contributes).toEqual({});
	});

	it("converts numeric version to string", () => {
		const raw = {
			title: "Test",
			version: 1.5,
		};

		const manifest = normaliseManifest(raw);

		expect(manifest.version).toBe("1.5");
	});

	it("produces empty string for object version", () => {
		const raw = {
			title: "Test",
			version: { major: 1, minor: 0 } as unknown as string,
		};

		const manifest = normaliseManifest(raw);

		expect(manifest.version).toBe("");
	});

	it("produces empty string for array version", () => {
		const raw = {
			title: "Test",
			version: [1, 0, 0] as unknown as string,
		};

		const manifest = normaliseManifest(raw);

		expect(manifest.version).toBe("");
	});

	it("produces empty string for boolean version", () => {
		const raw = {
			title: "Test",
			version: true as unknown as string,
		};

		const manifest = normaliseManifest(raw);

		expect(manifest.version).toBe("");
	});

	it("handles revealjs plugins", () => {
		const raw = {
			title: "Reveal Plugin",
			contributes: {
				"revealjs-plugins": ["plugin.js"],
			},
		};

		const manifest = normaliseManifest(raw);

		expect(manifest.contributes.revealjsPlugin).toEqual(["plugin.js"]);
	});

	it("maps source-type to sourceType", () => {
		const raw = {
			title: "Test",
			source: "owner/repo",
			"source-type": "github",
		};

		const manifest = normaliseManifest(raw);

		expect(manifest.sourceType).toBe("github");
	});

	it("maps all valid source-type values", () => {
		for (const type of ["github", "url", "local", "registry"]) {
			const raw = {
				title: "Test",
				"source-type": type,
			};

			const manifest = normaliseManifest(raw);

			expect(manifest.sourceType).toBe(type);
		}
	});

	it("ignores invalid source-type values", () => {
		const raw = {
			title: "Test",
			"source-type": "invalid",
		};

		const manifest = normaliseManifest(raw);

		expect(manifest.sourceType).toBeUndefined();
	});

	it("handles missing source-type", () => {
		const raw = {
			title: "Test",
		};

		const manifest = normaliseManifest(raw);

		expect(manifest.sourceType).toBeUndefined();
	});
});

describe("getExtensionTypes", () => {
	it("returns filter type", () => {
		const manifest = normaliseManifest({
			title: "Test",
			contributes: { filters: ["filter.lua"] },
		});

		const types = getExtensionTypes(manifest);

		expect(types).toContain("filter");
		expect(types).toHaveLength(1);
	});

	it("returns shortcode type", () => {
		const manifest = normaliseManifest({
			title: "Test",
			contributes: { shortcodes: ["shortcode.lua"] },
		});

		const types = getExtensionTypes(manifest);

		expect(types).toContain("shortcode");
	});

	it("returns format type", () => {
		const manifest = normaliseManifest({
			title: "Test",
			contributes: { formats: { html: {} } },
		});

		const types = getExtensionTypes(manifest);

		expect(types).toContain("format");
	});

	it("returns multiple types", () => {
		const manifest = normaliseManifest({
			title: "Test",
			contributes: {
				filters: ["filter.lua"],
				shortcodes: ["shortcode.lua"],
			},
		});

		const types = getExtensionTypes(manifest);

		expect(types).toContain("filter");
		expect(types).toContain("shortcode");
		expect(types).toHaveLength(2);
	});

	it("returns empty array for no contributions", () => {
		const manifest = normaliseManifest({
			title: "Test",
		});

		const types = getExtensionTypes(manifest);

		expect(types).toHaveLength(0);
	});

	it("returns project type", () => {
		const manifest = normaliseManifest({
			title: "Test",
			contributes: { project: { type: "book" } },
		});

		const types = getExtensionTypes(manifest);

		expect(types).toContain("project");
	});

	it("returns revealjs-plugin type", () => {
		const manifest = normaliseManifest({
			title: "Test",
			contributes: { "revealjs-plugins": ["plugin.js"] },
		});

		const types = getExtensionTypes(manifest);

		expect(types).toContain("revealjs-plugin");
	});

	it("returns metadata type", () => {
		const manifest = normaliseManifest({
			title: "Test",
			contributes: { metadata: { key: "value" } },
		});

		const types = getExtensionTypes(manifest);

		expect(types).toContain("metadata");
	});
});

describe("parseManifestContent", () => {
	it("parses valid YAML", () => {
		const yaml = `
title: Test Extension
author: Test Author
version: 1.0.0
contributes:
  filters:
    - filter.lua
`;

		const manifest = parseManifestContent(yaml);

		expect(manifest.title).toBe("Test Extension");
		expect(manifest.author).toBe("Test Author");
		expect(manifest.version).toBe("1.0.0");
		expect(manifest.contributes.filter).toEqual(["filter.lua"]);
	});

	it("throws on invalid YAML", () => {
		const yaml = `
title: [invalid
`;

		expect(() => parseManifestContent(yaml)).toThrow();
	});

	it("throws on empty content", () => {
		expect(() => parseManifestContent("")).toThrow();
	});

	it("handles YAML with source field", () => {
		const yaml = `
title: Test
source: owner/repo
`;

		const manifest = parseManifestContent(yaml);

		expect(manifest.source).toBe("owner/repo");
	});

	it("includes source path in error message", () => {
		expect(() => parseManifestContent("", "/path/to/manifest.yml")).toThrow(/manifest/i);
	});
});

describe("filesystem manifest functions", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "manifest-test-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	describe("findManifestFile", () => {
		it("finds _extension.yml", () => {
			const manifestPath = path.join(tempDir, "_extension.yml");
			fs.writeFileSync(manifestPath, "title: Test\n");

			const result = findManifestFile(tempDir);

			expect(result).toBe(manifestPath);
		});

		it("finds _extension.yaml", () => {
			const manifestPath = path.join(tempDir, "_extension.yaml");
			fs.writeFileSync(manifestPath, "title: Test\n");

			const result = findManifestFile(tempDir);

			expect(result).toBe(manifestPath);
		});

		it("prefers .yml over .yaml", () => {
			fs.writeFileSync(path.join(tempDir, "_extension.yml"), "title: YML\n");
			fs.writeFileSync(path.join(tempDir, "_extension.yaml"), "title: YAML\n");

			const result = findManifestFile(tempDir);

			expect(result).toBe(path.join(tempDir, "_extension.yml"));
		});

		it("returns null when no manifest exists", () => {
			const result = findManifestFile(tempDir);

			expect(result).toBeNull();
		});
	});

	describe("parseManifestFile", () => {
		it("parses a manifest file", () => {
			const manifestPath = path.join(tempDir, "_extension.yml");
			fs.writeFileSync(manifestPath, "title: Test Extension\nversion: 1.0.0\n");

			const manifest = parseManifestFile(manifestPath);

			expect(manifest.title).toBe("Test Extension");
			expect(manifest.version).toBe("1.0.0");
		});

		it("throws ManifestError for non-existent file", () => {
			const manifestPath = path.join(tempDir, "nonexistent.yml");

			expect(() => parseManifestFile(manifestPath)).toThrow(ManifestError);
		});

		it("re-throws ManifestError from parsing", () => {
			const manifestPath = path.join(tempDir, "_extension.yml");
			fs.writeFileSync(manifestPath, "");

			expect(() => parseManifestFile(manifestPath)).toThrow(ManifestError);
		});
	});

	describe("readManifest", () => {
		it("reads manifest from directory", () => {
			fs.writeFileSync(path.join(tempDir, "_extension.yml"), "title: Test\nversion: 2.0.0\n");

			const result = readManifest(tempDir);

			expect(result).not.toBeNull();
			expect(result!.manifest.title).toBe("Test");
			expect(result!.manifest.version).toBe("2.0.0");
			expect(result!.filename).toBe("_extension.yml");
		});

		it("returns null when no manifest in directory", () => {
			const result = readManifest(tempDir);

			expect(result).toBeNull();
		});
	});

	describe("hasManifest", () => {
		it("returns true when manifest exists", () => {
			fs.writeFileSync(path.join(tempDir, "_extension.yml"), "title: Test\n");

			expect(hasManifest(tempDir)).toBe(true);
		});

		it("returns false when no manifest exists", () => {
			expect(hasManifest(tempDir)).toBe(false);
		});
	});

	describe("updateManifestSource", () => {
		const writeFixture = (content: string): string => {
			const manifestPath = path.join(tempDir, "_extension.yml");
			fs.writeFileSync(manifestPath, content);
			return manifestPath;
		};

		it("preserves comments, key order, formatting, and unknown keys", () => {
			const original = [
				"# My extension",
				"title: Fancy Extension  # inline comment",
				"version: 1.0",
				'quarto-required: ">=1.4.0"',
				"contributes:",
				"  formats:",
				"    html:",
				"      theme: custom.scss",
				"  shortcodes:",
				"    - fancy.lua",
				"custom-key: keep me",
				"",
			].join("\n");
			const manifestPath = writeFixture(original);

			updateManifestSource(manifestPath, "owner/repo@v1.2.3", "github");

			expect(fs.readFileSync(manifestPath, "utf-8")).toBe(
				`${original}source: owner/repo@v1.2.3\nsource-type: github\n`,
			);
		});

		it("replaces an existing source in place", () => {
			const manifestPath = writeFixture("title: Test\nsource: old/source\nversion: 1.0.0\n");

			updateManifestSource(manifestPath, "new/source@v1.0.0");

			expect(fs.readFileSync(manifestPath, "utf-8")).toBe("title: Test\nsource: new/source@v1.0.0\nversion: 1.0.0\n");
		});

		it("replaces an existing source-type in place", () => {
			const manifestPath = writeFixture("title: Test\nsource: owner/repo\nsource-type: local\n");

			updateManifestSource(manifestPath, "owner/repo", "github");

			expect(fs.readFileSync(manifestPath, "utf-8")).toBe("title: Test\nsource: owner/repo\nsource-type: github\n");
		});

		it("appends source-type when provided", () => {
			const manifestPath = writeFixture("title: Test\nversion: 1.0.0\n");

			updateManifestSource(manifestPath, "owner/repo", "github");

			expect(fs.readFileSync(manifestPath, "utf-8")).toBe(
				"title: Test\nversion: 1.0.0\nsource: owner/repo\nsource-type: github\n",
			);
		});

		it("omits source-type when not provided", () => {
			const manifestPath = writeFixture("title: Test\nversion: 1.0.0\n");

			updateManifestSource(manifestPath, "owner/repo");

			expect(fs.readFileSync(manifestPath, "utf-8")).toBe("title: Test\nversion: 1.0.0\nsource: owner/repo\n");
		});

		it("leaves a nested source key untouched", () => {
			const manifestPath = writeFixture("title: Test\ncontributes:\n  metadata:\n    source: nested\n");

			updateManifestSource(manifestPath, "owner/repo");

			expect(fs.readFileSync(manifestPath, "utf-8")).toBe(
				"title: Test\ncontributes:\n  metadata:\n    source: nested\nsource: owner/repo\n",
			);
		});

		it("terminates the appended key when the file lacks a trailing newline", () => {
			const manifestPath = writeFixture("title: Test");

			updateManifestSource(manifestPath, "owner/repo");

			expect(fs.readFileSync(manifestPath, "utf-8")).toBe("title: Test\nsource: owner/repo\n");
		});

		it("preserves CRLF line endings", () => {
			const manifestPath = writeFixture("title: Test\r\nversion: 1.0.0\r\n");

			updateManifestSource(manifestPath, "owner/repo", "github");

			expect(fs.readFileSync(manifestPath, "utf-8")).toBe(
				"title: Test\r\nversion: 1.0.0\r\nsource: owner/repo\r\nsource-type: github\r\n",
			);
		});

		it("removes the continuation lines of a replaced block scalar", () => {
			const manifestPath = writeFixture("title: Test\nsource: |\n  old\n\n  value\nversion: 1.0.0\n");

			updateManifestSource(manifestPath, "owner/repo");

			expect(fs.readFileSync(manifestPath, "utf-8")).toBe("title: Test\nsource: owner/repo\nversion: 1.0.0\n");
		});

		it("quotes values that require quoting", () => {
			const manifestPath = writeFixture("title: Test\n");

			updateManifestSource(manifestPath, "*needs: quoting");

			const content = fs.readFileSync(manifestPath, "utf-8");
			expect(parseManifestContent(content).source).toBe("*needs: quoting");
		});

		it("patches only the first document of a multi-document file", () => {
			const manifestPath = writeFixture("title: Test\n---\ntitle: Other\nsource: untouched\n");

			updateManifestSource(manifestPath, "owner/repo");

			expect(fs.readFileSync(manifestPath, "utf-8")).toBe(
				"title: Test\nsource: owner/repo\n---\ntitle: Other\nsource: untouched\n",
			);
		});

		it("keeps both keys inside the first document", () => {
			const manifestPath = writeFixture("title: Test\n---\ntitle: Other\n");

			updateManifestSource(manifestPath, "owner/repo", "github");

			expect(fs.readFileSync(manifestPath, "utf-8")).toBe(
				"title: Test\nsource: owner/repo\nsource-type: github\n---\ntitle: Other\n",
			);
		});

		it("stops at an explicit document end marker", () => {
			const manifestPath = writeFixture("title: Test\n...\n");

			updateManifestSource(manifestPath, "owner/repo");

			expect(fs.readFileSync(manifestPath, "utf-8")).toBe("title: Test\nsource: owner/repo\n...\n");
		});

		it("skips a leading document separator when locating the root", () => {
			const manifestPath = writeFixture("---\ntitle: Test\n");

			updateManifestSource(manifestPath, "owner/repo");

			expect(fs.readFileSync(manifestPath, "utf-8")).toBe("---\ntitle: Test\nsource: owner/repo\n");
		});

		it("throws when the manifest root is a flow mapping", () => {
			const manifestPath = writeFixture("{title: Test, version: 1.0.0}\n");

			expect(() => updateManifestSource(manifestPath, "owner/repo")).toThrow(ManifestError);
		});
	});
});

describe("inferSourceType", () => {
	it("recognises owner/repo as a registry source", () => {
		expect(inferSourceType("owner/repo")).toBe("registry");
	});

	it("recognises owner/repo/subdir as a registry source", () => {
		expect(inferSourceType("owner/repo/subdir")).toBe("registry");
	});

	it("recognises a pinned registry source and ignores the ref", () => {
		expect(inferSourceType("owner/repo@v1.2.3")).toBe("registry");
	});

	it("recognises https URLs as url sources", () => {
		expect(inferSourceType("https://example.com/ext.zip")).toBe("url");
	});

	it("recognises absolute and relative paths as local sources", () => {
		expect(inferSourceType("/tmp/my-ext")).toBe("local");
		expect(inferSourceType("./vendor/local-ext")).toBe("local");
	});

	it("returns undefined for an empty or unrecognised source", () => {
		expect(inferSourceType(undefined)).toBeUndefined();
		expect(inferSourceType("")).toBeUndefined();
		expect(inferSourceType("single-segment")).toBeUndefined();
	});

	it("completes quickly on inputs crafted to trigger polynomial backtracking", () => {
		// Guards against a previous ReDoS shape in the GitHub repository pattern
		// (see CodeQL rule js/polynomial-redos). Confirm that pathological-looking
		// input with many `@` characters is rejected in well under a second.
		const pathological = "!/!" + "@!".repeat(10_000) + "#";
		const start = Date.now();
		const result = inferSourceType(pathological);
		const elapsed = Date.now() - start;
		expect(result).toBeUndefined();
		expect(elapsed).toBeLessThan(500);
	});
});
