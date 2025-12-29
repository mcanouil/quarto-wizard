import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Registry } from "../src/types/registry.js";

const createMockRegistry = (): Registry => ({
	"quarto-ext/lightbox": {
		id: "quarto-ext/lightbox",
		owner: "quarto-ext",
		name: "Lightbox",
		fullName: "quarto-ext/lightbox",
		description: "A lightbox extension for images",
		topics: ["quarto", "filter", "images"],
		latestVersion: "1.0.0",
		latestTag: "v1.0.0",
		latestReleaseUrl: "https://github.com/quarto-ext/lightbox/releases/tag/v1.0.0",
		stars: 100,
		licence: "MIT",
		htmlUrl: "https://github.com/quarto-ext/lightbox",
		template: false,
	},
	"quarto-ext/fontawesome": {
		id: "quarto-ext/fontawesome",
		owner: "quarto-ext",
		name: "Font Awesome",
		fullName: "quarto-ext/fontawesome",
		description: "Use Font Awesome icons in documents",
		topics: ["quarto", "shortcode", "icons"],
		latestVersion: "2.0.0",
		latestTag: "v2.0.0",
		latestReleaseUrl: null,
		stars: 50,
		licence: "MIT",
		htmlUrl: "https://github.com/quarto-ext/fontawesome",
		template: false,
	},
	"user/template-ext": {
		id: "user/template-ext",
		owner: "user",
		name: "My Template",
		fullName: "user/template-ext",
		description: "A template extension",
		topics: ["quarto", "format", "template"],
		latestVersion: "0.1.0",
		latestTag: "v0.1.0",
		latestReleaseUrl: null,
		stars: 10,
		licence: null,
		htmlUrl: "https://github.com/user/template-ext",
		template: true,
	},
	"another/revealjs-theme": {
		id: "another/revealjs-theme",
		owner: "another",
		name: "Reveal Theme",
		fullName: "another/revealjs-theme",
		description: "A revealjs theme",
		topics: ["quarto", "revealjs", "slides", "presentation"],
		latestVersion: "1.5.0",
		latestTag: "v1.5.0",
		latestReleaseUrl: null,
		stars: 75,
		licence: "MIT",
		htmlUrl: "https://github.com/another/revealjs-theme",
		template: false,
	},
});

vi.mock("../src/registry/fetcher.js", () => ({
	fetchRegistry: vi.fn().mockImplementation(() => Promise.resolve(createMockRegistry())),
	getDefaultRegistryUrl: vi.fn().mockReturnValue("https://example.com/registry.json"),
}));

import { listAvailable, search, getExtension, getExtensionsByOwner } from "../src/registry/search.js";

describe("listAvailable", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns all extensions sorted by stars", async () => {
		const results = await listAvailable();

		expect(results).toHaveLength(4);
		expect(results[0]?.id).toBe("quarto-ext/lightbox");
		expect(results[1]?.id).toBe("another/revealjs-theme");
	});

	it("filters by type", async () => {
		const results = await listAvailable({ type: "shortcode" });

		expect(results).toHaveLength(1);
		expect(results[0]?.id).toBe("quarto-ext/fontawesome");
	});

	it("filters templates only", async () => {
		const results = await listAvailable({ templatesOnly: true });

		expect(results).toHaveLength(1);
		expect(results[0]?.id).toBe("user/template-ext");
	});

	it("limits results", async () => {
		const results = await listAvailable({ limit: 2 });

		expect(results).toHaveLength(2);
	});

	it("filters by revealjs type", async () => {
		const results = await listAvailable({ type: "revealjs" });

		expect(results).toHaveLength(1);
		expect(results[0]?.id).toBe("another/revealjs-theme");
	});
});

describe("search", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("searches by name", async () => {
		const results = await search("lightbox");

		expect(results.length).toBeGreaterThan(0);
		expect(results[0]?.id).toBe("quarto-ext/lightbox");
	});

	it("searches by description", async () => {
		const results = await search("icons");

		expect(results.length).toBeGreaterThan(0);
		expect(results.some((r) => r.id === "quarto-ext/fontawesome")).toBe(true);
	});

	it("searches by topic", async () => {
		const results = await search("images");

		expect(results.length).toBeGreaterThan(0);
		expect(results[0]?.id).toBe("quarto-ext/lightbox");
	});

	it("returns empty array for no matches", async () => {
		const results = await search("nonexistent-extension-xyz");

		expect(results).toHaveLength(0);
	});

	it("limits results", async () => {
		const results = await search("quarto", { limit: 2 });

		expect(results).toHaveLength(2);
	});

	it("filters by minimum stars", async () => {
		const results = await search("", { minStars: 50 });

		expect(results.every((r) => r.stars >= 50)).toBe(true);
	});

	it("handles empty query", async () => {
		const results = await search("");

		expect(results).toHaveLength(4);
	});

	it("is case insensitive", async () => {
		const results = await search("LIGHTBOX");

		expect(results.length).toBeGreaterThan(0);
		expect(results[0]?.id).toBe("quarto-ext/lightbox");
	});

	it("ranks exact name matches higher", async () => {
		const results = await search("lightbox");

		expect(results[0]?.name).toBe("Lightbox");
	});
});

describe("getExtension", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns extension by ID", async () => {
		const ext = await getExtension("quarto-ext/lightbox");

		expect(ext).not.toBeNull();
		expect(ext?.name).toBe("Lightbox");
	});

	it("returns null for unknown ID", async () => {
		const ext = await getExtension("unknown/extension");

		expect(ext).toBeNull();
	});
});

describe("getExtensionsByOwner", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns all extensions by owner", async () => {
		const results = await getExtensionsByOwner("quarto-ext");

		expect(results).toHaveLength(2);
		expect(results.every((r) => r.owner === "quarto-ext")).toBe(true);
	});

	it("is case insensitive", async () => {
		const results = await getExtensionsByOwner("QUARTO-EXT");

		expect(results).toHaveLength(2);
	});

	it("returns empty array for unknown owner", async () => {
		const results = await getExtensionsByOwner("unknown-owner");

		expect(results).toHaveLength(0);
	});
});
