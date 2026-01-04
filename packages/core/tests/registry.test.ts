import { describe, it, expect } from "vitest";
import { parseRegistryEntry, parseRegistry } from "../src/types/registry.js";

describe("parseRegistryEntry", () => {
	it("parses a complete registry entry", () => {
		const raw = {
			owner: "quarto-ext",
			title: "Lightbox",
			nameWithOwner: "quarto-ext/lightbox",
			description: "A lightbox extension",
			repositoryTopics: ["quarto", "extension"],
			latestRelease: "v1.0.0",
			latestReleaseUrl: "https://github.com/quarto-ext/lightbox/releases/tag/v1.0.0",
			stargazerCount: 100,
			licenseInfo: "MIT",
			url: "https://github.com/quarto-ext/lightbox",
			template: false,
		};

		const entry = parseRegistryEntry("quarto-ext/lightbox", raw);

		expect(entry.id).toBe("quarto-ext/lightbox");
		expect(entry.owner).toBe("quarto-ext");
		expect(entry.name).toBe("Lightbox");
		expect(entry.fullName).toBe("quarto-ext/lightbox");
		expect(entry.description).toBe("A lightbox extension");
		expect(entry.topics).toEqual(["quarto", "extension"]);
		expect(entry.latestVersion).toBe("1.0.0");
		expect(entry.latestTag).toBe("v1.0.0");
		expect(entry.latestReleaseUrl).toBe("https://github.com/quarto-ext/lightbox/releases/tag/v1.0.0");
		expect(entry.stars).toBe(100);
		expect(entry.licence).toBe("MIT");
		expect(entry.htmlUrl).toBe("https://github.com/quarto-ext/lightbox");
		expect(entry.template).toBe(false);
	});

	it("handles missing optional fields", () => {
		const raw = {
			owner: "test",
			title: "Test",
			nameWithOwner: "test/test",
			url: "https://github.com/test/test",
		};

		const entry = parseRegistryEntry("test/test", raw);

		expect(entry.description).toBeNull();
		expect(entry.topics).toEqual([]);
		expect(entry.latestVersion).toBeNull();
		expect(entry.latestTag).toBeNull();
		expect(entry.latestReleaseUrl).toBeNull();
		expect(entry.stars).toBe(0);
		expect(entry.licence).toBeNull();
		expect(entry.template).toBe(false);
	});

	it("strips v prefix from version", () => {
		const raw = {
			owner: "test",
			title: "Test",
			nameWithOwner: "test/test",
			url: "https://github.com/test/test",
			latestRelease: "v2.5.3",
		};

		const entry = parseRegistryEntry("test/test", raw);

		expect(entry.latestVersion).toBe("2.5.3");
		expect(entry.latestTag).toBe("v2.5.3");
	});

	it("handles version without v prefix", () => {
		const raw = {
			owner: "test",
			title: "Test",
			nameWithOwner: "test/test",
			url: "https://github.com/test/test",
			latestRelease: "1.0.0",
		};

		const entry = parseRegistryEntry("test/test", raw);

		expect(entry.latestVersion).toBe("1.0.0");
		expect(entry.latestTag).toBe("1.0.0");
	});

	it("handles template extensions", () => {
		const raw = {
			owner: "test",
			title: "Template",
			nameWithOwner: "test/template",
			url: "https://github.com/test/template",
			template: true,
		};

		const entry = parseRegistryEntry("test/template", raw);

		expect(entry.template).toBe(true);
	});

	it("parses defaultBranchRef and latestCommit fields", () => {
		const raw = {
			owner: "test",
			title: "Test",
			nameWithOwner: "test/test",
			url: "https://github.com/test/test",
			defaultBranchRef: "develop",
			latestCommit: "abc1234567890abcdef1234567890abcdef123456",
		};

		const entry = parseRegistryEntry("test/test", raw);

		expect(entry.defaultBranchRef).toBe("develop");
		expect(entry.latestCommit).toBe("abc1234567890abcdef1234567890abcdef123456");
	});

	it("handles missing defaultBranchRef and latestCommit", () => {
		const raw = {
			owner: "test",
			title: "Test",
			nameWithOwner: "test/test",
			url: "https://github.com/test/test",
		};

		const entry = parseRegistryEntry("test/test", raw);

		expect(entry.defaultBranchRef).toBeNull();
		expect(entry.latestCommit).toBeNull();
	});

	it("handles null defaultBranchRef and latestCommit", () => {
		const raw = {
			owner: "test",
			title: "Test",
			nameWithOwner: "test/test",
			url: "https://github.com/test/test",
			defaultBranchRef: null,
			latestCommit: null,
		};

		const entry = parseRegistryEntry("test/test", raw);

		expect(entry.defaultBranchRef).toBeNull();
		expect(entry.latestCommit).toBeNull();
	});
});

describe("parseRegistry", () => {
	it("parses multiple entries", () => {
		const raw = {
			"quarto-ext/lightbox": {
				owner: "quarto-ext",
				title: "Lightbox",
				nameWithOwner: "quarto-ext/lightbox",
				url: "https://github.com/quarto-ext/lightbox",
			},
			"test/test": {
				owner: "test",
				title: "Test",
				nameWithOwner: "test/test",
				url: "https://github.com/test/test",
			},
		};

		const registry = parseRegistry(raw);

		expect(Object.keys(registry)).toHaveLength(2);
		expect(registry["quarto-ext/lightbox"]).toBeDefined();
		expect(registry["quarto-ext/lightbox"]?.name).toBe("Lightbox");
		expect(registry["test/test"]).toBeDefined();
		expect(registry["test/test"]?.name).toBe("Test");
	});

	it("handles empty registry", () => {
		const registry = parseRegistry({});

		expect(Object.keys(registry)).toHaveLength(0);
	});
});
