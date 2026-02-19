import { describe, it, expect } from "vitest";
import { SnippetError } from "../src/errors.js";

describe("SnippetError", () => {
	it("sets name and code", () => {
		const error = new SnippetError("test message");
		expect(error.name).toBe("SnippetError");
		expect(error.code).toBe("SNIPPET_ERROR");
		expect(error.message).toBe("test message");
	});

	it("stores snippetPath when provided", () => {
		const error = new SnippetError("bad file", { snippetPath: "/path/to/_snippets.json" });
		expect(error.snippetPath).toBe("/path/to/_snippets.json");
	});

	it("sets suggestion when snippetPath is provided", () => {
		const error = new SnippetError("bad file", { snippetPath: "/path/to/_snippets.json" });
		expect(error.suggestion).toBe("Check the snippet file at: /path/to/_snippets.json");
	});

	it("leaves suggestion undefined when no snippetPath", () => {
		const error = new SnippetError("generic error");
		expect(error.suggestion).toBeUndefined();
	});

	it("preserves cause", () => {
		const cause = new SyntaxError("unexpected token");
		const error = new SnippetError("parse failed", { cause });
		expect(error.cause).toBe(cause);
	});

	it("format() includes name and message", () => {
		const error = new SnippetError("something went wrong");
		expect(error.format()).toBe("SnippetError: something went wrong");
	});

	it("format() includes suggestion when snippetPath is set", () => {
		const error = new SnippetError("bad file", { snippetPath: "/a/b/_snippets.json" });
		const formatted = error.format();
		expect(formatted).toContain("SnippetError: bad file");
		expect(formatted).toContain("Suggestion: Check the snippet file at: /a/b/_snippets.json");
	});
});
