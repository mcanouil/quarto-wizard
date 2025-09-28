import * as assert from "assert";
import { checkQuartoVersion } from "../../utils/quarto";
import { checkInternetConnection } from "../../utils/network";

suite("Timeout Handling Test Suite", () => {
	test("checkQuartoVersion should return false for invalid path", async function () {
		this.timeout(5000); // Allow up to 5 seconds for the test

		const start = Date.now();
		const result = await checkQuartoVersion("non-existent-quarto-path", 2000);
		const elapsed = Date.now() - start;

		// Should return false quickly for invalid path
		assert.strictEqual(result, false);
		assert.ok(elapsed < 2000, `Expected quick failure for invalid path, got ${elapsed}ms`);
	});

	test("checkInternetConnection should timeout with unreachable URL", async function () {
		this.timeout(10000); // Allow up to 10 seconds for the test

		const start = Date.now();
		// Use a URL that should timeout (non-routable IP)
		const result = await checkInternetConnection("http://10.255.255.1", 1000);
		const elapsed = Date.now() - start;

		// Should return false and complete within reasonable time of the timeout
		assert.strictEqual(result, false);
		assert.ok(elapsed >= 1000 && elapsed < 2000, `Expected timeout around 1000ms, got ${elapsed}ms`);
	});

	test("checkInternetConnection should succeed with valid URL and sufficient timeout", async function () {
		this.timeout(10000);

		// Test with a reliable URL and reasonable timeout
		const result = await checkInternetConnection("https://httpbin.org/status/200", 5000);

		// Should return true for a valid, reachable URL
		assert.strictEqual(result, true);
	});

	test("timeout parameters should be properly passed", async function () {
		this.timeout(5000);

		// Test that timeout parameters are handled correctly
		const shortTimeout = 100; // Very short timeout
		const start = Date.now();

		// Use a URL that should timeout with a very short timeout
		const result = await checkInternetConnection("https://httpbin.org/delay/1", shortTimeout);
		const elapsed = Date.now() - start;

		// Should return false and respect the timeout
		assert.strictEqual(result, false);
		assert.ok(elapsed >= shortTimeout && elapsed < shortTimeout * 3,
			`Expected timeout around ${shortTimeout}ms, got ${elapsed}ms`);
	});
});