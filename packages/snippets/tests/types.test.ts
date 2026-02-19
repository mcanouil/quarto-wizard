import { describe, it, expect } from "vitest";
import { snippetNamespace, qualifySnippetPrefix } from "../src/types.js";

describe("snippetNamespace", () => {
	it("returns owner-name when owner exists", () => {
		expect(snippetNamespace({ owner: "mcanouil", name: "iconify" })).toBe("mcanouil-iconify");
	});

	it("returns name only when owner is null", () => {
		expect(snippetNamespace({ owner: null, name: "highlight-text" })).toBe("highlight-text");
	});
});

describe("qualifySnippetPrefix", () => {
	it("combines namespace and prefix with colon", () => {
		expect(qualifySnippetPrefix("mcanouil-iconify", "iconify")).toBe("mcanouil-iconify:iconify");
	});

	it("works with simple namespace", () => {
		expect(qualifySnippetPrefix("modal", "modal-toggle")).toBe("modal:modal-toggle");
	});
});
