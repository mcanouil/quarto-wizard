import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { normaliseManifest, getExtensionTypes } from "../src/types/manifest.js";
import {
	parseManifestContent,
	parseManifestFile,
	findManifestFile,
	readManifest,
	hasManifest,
	writeManifest,
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

	describe("writeManifest", () => {
		it("writes a basic manifest", () => {
			const manifestPath = path.join(tempDir, "_extension.yml");
			const manifest = {
				title: "Test Extension",
				author: "Test Author",
				version: "1.0.0",
				contributes: {},
			};

			writeManifest(manifestPath, manifest);

			const content = fs.readFileSync(manifestPath, "utf-8");
			expect(content).toContain("title: Test Extension");
			expect(content).toContain("author: Test Author");
			expect(content).toContain("version: 1.0.0");
		});

		it("writes manifest with quarto-required", () => {
			const manifestPath = path.join(tempDir, "_extension.yml");
			const manifest = {
				title: "Test",
				author: "",
				version: "1.0.0",
				quartoRequired: ">=1.3.0",
				contributes: {},
			};

			writeManifest(manifestPath, manifest);

			const content = fs.readFileSync(manifestPath, "utf-8");
			expect(content).toContain("quarto-required");
		});

		it("writes manifest with source", () => {
			const manifestPath = path.join(tempDir, "_extension.yml");
			const manifest = {
				title: "Test",
				author: "",
				version: "1.0.0",
				source: "owner/repo@v1.0.0",
				contributes: {},
			};

			writeManifest(manifestPath, manifest);

			const content = fs.readFileSync(manifestPath, "utf-8");
			expect(content).toContain("source: owner/repo@v1.0.0");
		});

		it("writes manifest with filters", () => {
			const manifestPath = path.join(tempDir, "_extension.yml");
			const manifest = {
				title: "Test",
				author: "",
				version: "1.0.0",
				contributes: {
					filter: ["filter.lua"],
				},
			};

			writeManifest(manifestPath, manifest);

			const content = fs.readFileSync(manifestPath, "utf-8");
			expect(content).toContain("filters:");
			expect(content).toContain("filter.lua");
		});

		it("writes manifest with shortcodes", () => {
			const manifestPath = path.join(tempDir, "_extension.yml");
			const manifest = {
				title: "Test",
				author: "",
				version: "1.0.0",
				contributes: {
					shortcode: ["shortcode.lua"],
				},
			};

			writeManifest(manifestPath, manifest);

			const content = fs.readFileSync(manifestPath, "utf-8");
			expect(content).toContain("shortcodes:");
		});

		it("writes manifest with formats", () => {
			const manifestPath = path.join(tempDir, "_extension.yml");
			const manifest = {
				title: "Test",
				author: "",
				version: "1.0.0",
				contributes: {
					format: { html: { toc: true } },
				},
			};

			writeManifest(manifestPath, manifest);

			const content = fs.readFileSync(manifestPath, "utf-8");
			expect(content).toContain("formats:");
		});

		it("writes manifest with project", () => {
			const manifestPath = path.join(tempDir, "_extension.yml");
			const manifest = {
				title: "Test",
				author: "",
				version: "1.0.0",
				contributes: {
					project: { type: "book" },
				},
			};

			writeManifest(manifestPath, manifest);

			const content = fs.readFileSync(manifestPath, "utf-8");
			expect(content).toContain("project:");
		});

		it("writes manifest with revealjs-plugins", () => {
			const manifestPath = path.join(tempDir, "_extension.yml");
			const manifest = {
				title: "Test",
				author: "",
				version: "1.0.0",
				contributes: {
					revealjsPlugin: ["plugin.js"],
				},
			};

			writeManifest(manifestPath, manifest);

			const content = fs.readFileSync(manifestPath, "utf-8");
			expect(content).toContain("revealjs-plugins:");
		});

		it("writes manifest with metadata", () => {
			const manifestPath = path.join(tempDir, "_extension.yml");
			const manifest = {
				title: "Test",
				author: "",
				version: "1.0.0",
				contributes: {
					metadata: { key: "value" },
				},
			};

			writeManifest(manifestPath, manifest);

			const content = fs.readFileSync(manifestPath, "utf-8");
			expect(content).toContain("metadata:");
		});

		it("omits empty contributes", () => {
			const manifestPath = path.join(tempDir, "_extension.yml");
			const manifest = {
				title: "Test",
				author: "",
				version: "1.0.0",
				contributes: {},
			};

			writeManifest(manifestPath, manifest);

			const content = fs.readFileSync(manifestPath, "utf-8");
			expect(content).not.toContain("contributes:");
		});
	});

	describe("updateManifestSource", () => {
		it("updates the source field in an existing manifest", () => {
			const manifestPath = path.join(tempDir, "_extension.yml");
			fs.writeFileSync(manifestPath, "title: Test\nversion: 1.0.0\n");

			updateManifestSource(manifestPath, "owner/repo@v2.0.0");

			const content = fs.readFileSync(manifestPath, "utf-8");
			expect(content).toContain("source: owner/repo@v2.0.0");
		});

		it("overwrites existing source field", () => {
			const manifestPath = path.join(tempDir, "_extension.yml");
			fs.writeFileSync(manifestPath, "title: Test\nversion: 1.0.0\nsource: old/source\n");

			updateManifestSource(manifestPath, "new/source@v1.0.0");

			const content = fs.readFileSync(manifestPath, "utf-8");
			expect(content).toContain("source: new/source@v1.0.0");
			expect(content).not.toContain("old/source");
		});
	});
});
