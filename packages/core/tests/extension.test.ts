import { describe, it, expect } from "vitest";
import {
	parseExtensionId,
	formatExtensionId,
	parseVersionSpec,
	parseExtensionRef,
	formatExtensionRef,
} from "../src/types/extension.js";

describe("parseExtensionId", () => {
	it("parses owner/name format", () => {
		const id = parseExtensionId("quarto-ext/lightbox");
		expect(id.owner).toBe("quarto-ext");
		expect(id.name).toBe("lightbox");
	});

	it("parses name-only format", () => {
		const id = parseExtensionId("lightbox");
		expect(id.owner).toBeNull();
		expect(id.name).toBe("lightbox");
	});

	it("trims whitespace", () => {
		const id = parseExtensionId("  quarto-ext/lightbox  ");
		expect(id.owner).toBe("quarto-ext");
		expect(id.name).toBe("lightbox");
	});

	it("rejects empty owner part", () => {
		expect(() => parseExtensionId("/lightbox")).toThrow(/Invalid extension name/);
	});

	it("rejects multiple slashes", () => {
		expect(() => parseExtensionId("owner/repo/extra")).toThrow(/Invalid extension name/);
	});
});

describe("formatExtensionId", () => {
	it("formats owner/name", () => {
		const result = formatExtensionId({ owner: "quarto-ext", name: "lightbox" });
		expect(result).toBe("quarto-ext/lightbox");
	});

	it("formats name-only", () => {
		const result = formatExtensionId({ owner: null, name: "lightbox" });
		expect(result).toBe("lightbox");
	});
});

describe("parseVersionSpec", () => {
	it("parses 'latest' as latest", () => {
		const spec = parseVersionSpec("latest");
		expect(spec.type).toBe("latest");
	});

	it("parses empty string as latest", () => {
		const spec = parseVersionSpec("");
		expect(spec.type).toBe("latest");
	});

	it("parses version with v prefix as tag", () => {
		const spec = parseVersionSpec("v1.0.0");
		expect(spec.type).toBe("tag");
		if (spec.type === "tag") {
			expect(spec.tag).toBe("v1.0.0");
		}
	});

	it("parses semver without v prefix as tag", () => {
		const spec = parseVersionSpec("1.0.0");
		expect(spec.type).toBe("tag");
		if (spec.type === "tag") {
			expect(spec.tag).toBe("1.0.0");
		}
	});

	it("parses branch name", () => {
		const spec = parseVersionSpec("main");
		expect(spec.type).toBe("branch");
		if (spec.type === "branch") {
			expect(spec.branch).toBe("main");
		}
	});

	it("parses feature branch", () => {
		const spec = parseVersionSpec("feature/new-stuff");
		expect(spec.type).toBe("branch");
		if (spec.type === "branch") {
			expect(spec.branch).toBe("feature/new-stuff");
		}
	});

	it("parses 7-character commit hash", () => {
		const spec = parseVersionSpec("abc1234");
		expect(spec.type).toBe("commit");
		if (spec.type === "commit") {
			expect(spec.commit).toBe("abc1234");
		}
	});

	it("parses full 40-character commit hash", () => {
		const spec = parseVersionSpec("abc1234567890abcdef1234567890abcdef1234");
		expect(spec.type).toBe("commit");
		if (spec.type === "commit") {
			expect(spec.commit).toBe("abc1234567890abcdef1234567890abcdef1234");
		}
	});

	it("parses uppercase commit hash", () => {
		const spec = parseVersionSpec("ABC1234");
		expect(spec.type).toBe("commit");
		if (spec.type === "commit") {
			expect(spec.commit).toBe("ABC1234");
		}
	});

	it("does not parse 6-character hex as commit (too short)", () => {
		const spec = parseVersionSpec("abc123");
		expect(spec.type).toBe("branch");
	});

	it("does not parse non-hex characters as commit", () => {
		const spec = parseVersionSpec("abc123g");
		expect(spec.type).toBe("branch");
	});

	it("resolution order: tag takes precedence over commit-like strings", () => {
		// Version starting with 'v' is always a tag
		const spec = parseVersionSpec("v1a2b3c");
		expect(spec.type).toBe("tag");
	});
});

describe("parseExtensionRef", () => {
	it("parses ref without version", () => {
		const ref = parseExtensionRef("quarto-ext/lightbox");
		expect(ref.id.owner).toBe("quarto-ext");
		expect(ref.id.name).toBe("lightbox");
		expect(ref.version.type).toBe("latest");
	});

	it("parses ref with version tag", () => {
		const ref = parseExtensionRef("quarto-ext/lightbox@v1.0.0");
		expect(ref.id.owner).toBe("quarto-ext");
		expect(ref.id.name).toBe("lightbox");
		expect(ref.version.type).toBe("tag");
		if (ref.version.type === "tag") {
			expect(ref.version.tag).toBe("v1.0.0");
		}
	});

	it("parses ref with branch", () => {
		const ref = parseExtensionRef("quarto-ext/lightbox@main");
		expect(ref.id.owner).toBe("quarto-ext");
		expect(ref.id.name).toBe("lightbox");
		expect(ref.version.type).toBe("branch");
		if (ref.version.type === "branch") {
			expect(ref.version.branch).toBe("main");
		}
	});

	it("handles @ at the start (npm scoped package style)", () => {
		const ref = parseExtensionRef("@scope/package");
		expect(ref.id.owner).toBe("@scope");
		expect(ref.id.name).toBe("package");
		expect(ref.version.type).toBe("latest");
	});

	it("uses last @ for version separation", () => {
		const ref = parseExtensionRef("owner/repo@v1.0.0");
		expect(ref.id.owner).toBe("owner");
		expect(ref.id.name).toBe("repo");
		expect(ref.version.type).toBe("tag");
	});

	it("parses ref with commit hash", () => {
		const ref = parseExtensionRef("quarto-ext/lightbox@abc1234");
		expect(ref.id.owner).toBe("quarto-ext");
		expect(ref.id.name).toBe("lightbox");
		expect(ref.version.type).toBe("commit");
		if (ref.version.type === "commit") {
			expect(ref.version.commit).toBe("abc1234");
		}
	});
});

describe("formatExtensionRef", () => {
	it("formats ref with latest version", () => {
		const result = formatExtensionRef({
			id: { owner: "quarto-ext", name: "lightbox" },
			version: { type: "latest" },
		});
		expect(result).toBe("quarto-ext/lightbox");
	});

	it("formats ref with tag version", () => {
		const result = formatExtensionRef({
			id: { owner: "quarto-ext", name: "lightbox" },
			version: { type: "tag", tag: "v1.0.0" },
		});
		expect(result).toBe("quarto-ext/lightbox@v1.0.0");
	});

	it("formats ref with branch version", () => {
		const result = formatExtensionRef({
			id: { owner: "quarto-ext", name: "lightbox" },
			version: { type: "branch", branch: "main" },
		});
		expect(result).toBe("quarto-ext/lightbox@main");
	});

	it("formats ref with exact version", () => {
		const result = formatExtensionRef({
			id: { owner: "quarto-ext", name: "lightbox" },
			version: { type: "exact", version: "1.0.0" },
		});
		expect(result).toBe("quarto-ext/lightbox@1.0.0");
	});

	it("formats ref with commit version (truncates to 7 chars)", () => {
		const result = formatExtensionRef({
			id: { owner: "quarto-ext", name: "lightbox" },
			version: { type: "commit", commit: "abc1234567890" },
		});
		expect(result).toBe("quarto-ext/lightbox@abc1234");
	});

	it("formats ref with short commit version", () => {
		const result = formatExtensionRef({
			id: { owner: "quarto-ext", name: "lightbox" },
			version: { type: "commit", commit: "abc1234" },
		});
		expect(result).toBe("quarto-ext/lightbox@abc1234");
	});
});
