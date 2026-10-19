import * as assert from "assert";
import { validateQuartoRequirement } from "../../utils/versionValidation";

suite("Version Validation Test Suite", () => {
	test("Should pass when no requirement is given", () => {
		assert.deepStrictEqual(validateQuartoRequirement(undefined, "1.9.0"), {
			valid: true,
			required: undefined,
			current: "1.9.0",
			message: undefined,
		});
	});

	test("Should treat an empty requirement as none", () => {
		assert.strictEqual(validateQuartoRequirement("", "1.9.0").valid, true);
	});

	test("Should pass silently when the Quarto version is unknown", () => {
		assert.deepStrictEqual(validateQuartoRequirement(">=1.8.20", undefined), {
			valid: true,
			required: ">=1.8.20",
			current: undefined,
			message: undefined,
		});
	});

	test("Should pass when the version satisfies the requirement", () => {
		const result = validateQuartoRequirement(">=1.8.20", "1.9.0");
		assert.deepStrictEqual(result, { valid: true, required: ">=1.8.20", current: "1.9.0", message: undefined });
	});

	test("Should accept the boundary of a range", () => {
		assert.strictEqual(validateQuartoRequirement(">=1.8.20", "1.8.20").valid, true);
	});

	test("Should fail with a message when the version is too old", () => {
		const result = validateQuartoRequirement(">=1.8.20", "1.7.0");
		assert.strictEqual(result.valid, false);
		assert.strictEqual(result.required, ">=1.8.20");
		assert.strictEqual(result.current, "1.7.0");
		assert.strictEqual(result.message, "This extension requires Quarto >=1.8.20, but you have version 1.7.0.");
	});

	test("Should fail when the version is above an upper bound", () => {
		assert.strictEqual(validateQuartoRequirement("<1.9.0", "1.9.1").valid, false);
	});

	test("Should accept a leading v and surrounding whitespace in the version", () => {
		assert.strictEqual(validateQuartoRequirement(">=1.8.0", " v1.9.0 ").valid, true);
		assert.strictEqual(validateQuartoRequirement(">=1.8.0", "V1.7.0").valid, false);
	});

	test("Should coerce a two part version", () => {
		assert.strictEqual(validateQuartoRequirement(">=1.8.0", "1.8").valid, true);
	});

	test("Should trim the requirement", () => {
		assert.strictEqual(validateQuartoRequirement("  >=1.8.0  ", "1.9.0").valid, true);
	});

	test("Should pass without a message when the version cannot be read", () => {
		const result = validateQuartoRequirement(">=1.8.0", "not-a-version");
		assert.deepStrictEqual(result, {
			valid: true,
			required: ">=1.8.0",
			current: "not-a-version",
			message: undefined,
		});
	});

	test("Should pass without a message when the requirement cannot be read", () => {
		const result = validateQuartoRequirement("this is not a range", "1.9.0");
		assert.deepStrictEqual(result, {
			valid: true,
			required: "this is not a range",
			current: "1.9.0",
			message: undefined,
		});
	});
});
