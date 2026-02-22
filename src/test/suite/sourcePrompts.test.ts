import * as assert from "assert";
import { isAbsolutePathForAnyPlatform, isValidGitHubReference, resolveSourcePath } from "../../utils/sourcePrompts";

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

	suite("isAbsolutePathForAnyPlatform", () => {
		const absoluteCases = [
			{ path: "/usr/local/ext", description: "Unix absolute" },
			{ path: "C:\\Users\\ext", description: "Windows backslash" },
			{ path: "C:/Users/ext", description: "Windows forward slash" },
			{ path: "d:\\projects", description: "lowercase drive letter" },
			{ path: "\\\\server\\share", description: "UNC path" },
		];
		for (const { path, description } of absoluteCases) {
			test(`returns true for ${description}: "${path}"`, () => {
				assert.strictEqual(isAbsolutePathForAnyPlatform(path), true);
			});
		}

		const relativeCases = [
			{ path: "relative/path", description: "relative path" },
			{ path: "./local", description: "dot-relative" },
			{ path: "C:", description: "bare drive letter without separator" },
			{ path: "", description: "empty string" },
		];
		for (const { path, description } of relativeCases) {
			test(`returns false for ${description}: "${path}"`, () => {
				assert.strictEqual(isAbsolutePathForAnyPlatform(path), false);
			});
		}
	});

	suite("resolveSourcePath", () => {
		const workspaceFolder = "/workspace/project";

		test("does not rewrite Windows absolute drive path", () => {
			const source = "C:\\Users\\name\\extension";
			const result = resolveSourcePath(source, workspaceFolder);
			assert.strictEqual(result.resolved, source);
			assert.strictEqual(result.display, undefined);
		});

		test("does not rewrite UNC path", () => {
			const source = "\\\\server\\share\\extension";
			const result = resolveSourcePath(source, workspaceFolder);
			assert.strictEqual(result.resolved, source);
			assert.strictEqual(result.display, undefined);
		});
	});
});
