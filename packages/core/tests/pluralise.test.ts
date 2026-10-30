import { describe, it, expect } from "vitest";
import { pluralise } from "../src/index.js";

describe("pluralise", () => {
	it("uses the singular for one", () => {
		expect(pluralise(1, "extension")).toBe("1 extension");
	});

	it("uses the plural for zero", () => {
		expect(pluralise(0, "extension")).toBe("0 extensions");
	});

	it("adds an s for more than one", () => {
		expect(pluralise(2, "file")).toBe("2 files");
	});

	it("uses the given plural", () => {
		expect(pluralise(3, "repository", "repositories")).toBe("3 repositories");
	});
});
