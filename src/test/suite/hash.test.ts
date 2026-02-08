import * as assert from "assert";
import { generateHashKey } from "../../utils/hash";

suite("Hash Utils Test Suite", () => {
	test("Should generate consistent SHA-256 hash", () => {
		const input = "test string";
		const hash1 = generateHashKey(input);
		const hash2 = generateHashKey(input);

		assert.strictEqual(hash1, hash2, "Hash should be consistent");
		assert.strictEqual(typeof hash1, "string", "Hash should be a string");
		assert.strictEqual(hash1.length, 64, "SHA-256 hash should be 64 characters long");
	});

	test("Should generate different hashes for different inputs", () => {
		const hash1 = generateHashKey("input1");
		const hash2 = generateHashKey("input2");

		assert.notStrictEqual(hash1, hash2, "Different inputs should produce different hashes");
	});

	test("Should handle empty string", () => {
		const hash = generateHashKey("");

		assert.strictEqual(typeof hash, "string", "Hash should be a string");
		assert.strictEqual(hash.length, 64, "SHA-256 hash should be 64 characters long");
	});
});
