import * as assert from "assert";
import { isValidGitHubReference } from "../../utils/sourcePrompts";

suite("Source Prompts Test Suite", () => {
	suite("isValidGitHubReference", () => {
		const validCases = [
			"owner/repo",
			"quarto-ext/lightbox",
			"my.org/my.repo",
			"owner/repo@v1.0.0",
			"owner/repo@latest",
			"a/b",
			"owner-name/repo_name@1.2.3",
		];

		for (const value of validCases) {
			test(`accepts valid reference: ${value}`, () => {
				assert.strictEqual(isValidGitHubReference(value), true);
			});
		}

		const invalidCases = [
			{ value: "", description: "empty string" },
			{ value: "owner", description: "no slash" },
			{ value: "///", description: "only slashes" },
			{ value: "a/b/c", description: "multiple path segments" },
			{ value: "a/b/c/d", description: "four path segments" },
			{ value: "/repo", description: "missing owner" },
			{ value: "owner/", description: "missing repo" },
			{ value: "owner/repo@", description: "trailing @" },
			{ value: "owner/repo with spaces", description: "spaces in repo" },
			{ value: "owner name/repo", description: "spaces in owner" },
		];

		for (const { value, description } of invalidCases) {
			test(`rejects invalid reference (${description}): "${value}"`, () => {
				assert.strictEqual(isValidGitHubReference(value), false);
			});
		}
	});
});
