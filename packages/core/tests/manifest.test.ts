import { describe, it, expect } from "vitest";
import { normaliseManifest, getExtensionTypes } from "../src/types/manifest.js";
import { parseManifestContent } from "../src/filesystem/manifest.js";

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
});
