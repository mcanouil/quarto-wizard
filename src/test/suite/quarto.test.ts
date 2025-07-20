import * as assert from "assert";
import { getQuartoPath, checkQuartoPath, checkQuartoVersion } from "../../utils/quarto";

suite("Quarto Utils Test Suite", () => {
	test("getQuartoPath should return a string", () => {
		const path = getQuartoPath();
		assert.strictEqual(typeof path, "string", "Should return a string");
		assert.ok(path.length > 0, "Path should not be empty");
	});

	test("checkQuartoPath should return a boolean for valid path", async () => {
		const path = getQuartoPath();
		const result = await checkQuartoPath(path);
		assert.strictEqual(typeof result, "boolean", "Should return a boolean value");
	});

	test("checkQuartoVersion should return a boolean", async () => {
		const path = getQuartoPath();
		const result = await checkQuartoVersion(path);
		assert.strictEqual(typeof result, "boolean", "Should return a boolean value");
	});
});
