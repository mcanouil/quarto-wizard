import { describe, it, expect } from "vitest";
import {
	coerceFieldValue,
	deprecationMessage,
	validateFieldValue,
	type FieldFinding,
} from "../../src/validation/field-value.js";
import type { FieldDescriptor } from "../../src/types/schema.js";

function codes(findings: FieldFinding[]): string[] {
	return findings.map((finding) => finding.code);
}

describe("validateFieldValue", () => {
	it("enum: accepts a listed value and rejects another", () => {
		const descriptor: FieldDescriptor = { type: "string", enum: ["red", "blue"] };
		expect(validateFieldValue("color", "red", descriptor)).toEqual([]);
		expect(validateFieldValue("color", "green", descriptor)).toEqual([
			{
				code: "schema-enum",
				severity: "error",
				message: 'value "green" is not in the allowed values (red, blue).',
			},
		]);
	});

	it("enum: compares case-sensitively by default", () => {
		const descriptor: FieldDescriptor = { type: "string", enum: ["red", "blue"] };
		expect(codes(validateFieldValue("color", "RED", descriptor))).toEqual(["schema-enum"]);
	});

	it("enum: honours enumCaseInsensitive", () => {
		const descriptor: FieldDescriptor = { type: "string", enum: ["red", "blue"], enumCaseInsensitive: true };
		expect(validateFieldValue("color", "RED", descriptor)).toEqual([]);
		expect(codes(validateFieldValue("color", "green", descriptor))).toEqual(["schema-enum"]);
	});

	it("enum: coerces the listed values to the declared type", () => {
		const descriptor: FieldDescriptor = { type: "boolean", enum: ["true", "false"] };
		expect(validateFieldValue("flag", true, descriptor)).toEqual([]);
	});

	it("minimum: accepts the bound and rejects below it", () => {
		const descriptor: FieldDescriptor = { type: "number", min: 10 };
		expect(validateFieldValue("size", 10, descriptor)).toEqual([]);
		expect(validateFieldValue("size", 9, descriptor)).toEqual([
			{ code: "schema-min", severity: "error", message: "value 9 is below the minimum of 10." },
		]);
	});

	it("maximum: accepts the bound and rejects above it", () => {
		const descriptor: FieldDescriptor = { type: "number", max: 10 };
		expect(validateFieldValue("size", 10, descriptor)).toEqual([]);
		expect(validateFieldValue("size", 11, descriptor)).toEqual([
			{ code: "schema-max", severity: "error", message: "value 11 exceeds the maximum of 10." },
		]);
	});

	it("exclusiveMinimum: accepts above the bound and rejects the bound", () => {
		const descriptor: FieldDescriptor = { type: "number", exclusiveMinimum: 0 };
		expect(validateFieldValue("size", 1, descriptor)).toEqual([]);
		expect(validateFieldValue("size", 0, descriptor)).toEqual([
			{ code: "schema-min", severity: "error", message: "value 0 must be greater than 0." },
		]);
	});

	it("exclusiveMaximum: accepts below the bound and rejects the bound", () => {
		const descriptor: FieldDescriptor = { type: "number", exclusiveMaximum: 1 };
		expect(validateFieldValue("ratio", 0.5, descriptor)).toEqual([]);
		expect(validateFieldValue("ratio", 1, descriptor)).toEqual([
			{ code: "schema-max", severity: "error", message: "value 1 must be less than 1." },
		]);
	});

	it("pattern: accepts a match and rejects a mismatch", () => {
		const descriptor: FieldDescriptor = { type: "string", pattern: "^[a-z]+$" };
		expect(validateFieldValue("name", "hello", descriptor)).toEqual([]);
		expect(validateFieldValue("name", "Hello1", descriptor)).toEqual([
			{
				code: "schema-pattern",
				severity: "error",
				message: 'value "Hello1" does not match the required pattern "^[a-z]+$".',
			},
		]);
	});

	it("pattern: matches anywhere unless patternExact is set", () => {
		expect(validateFieldValue("name", "abc123", { pattern: "[a-z]+" })).toEqual([]);
		expect(codes(validateFieldValue("name", "abc123", { pattern: "[a-z]+", patternExact: true }))).toEqual([
			"schema-pattern",
		]);
	});

	it("skips patterns longer than 1024 characters", () => {
		const descriptor: FieldDescriptor = { type: "string", pattern: `^${"a".repeat(1024)}$` };
		expect(validateFieldValue("name", "b", descriptor)).toEqual([]);
	});

	it("skips a pattern that does not compile", () => {
		expect(validateFieldValue("name", "b", { type: "string", pattern: "(" })).toEqual([]);
	});

	it("minLength: accepts the bound and rejects shorter", () => {
		const descriptor: FieldDescriptor = { type: "string", minLength: 3 };
		expect(validateFieldValue("code", "abc", descriptor)).toEqual([]);
		expect(validateFieldValue("code", "ab", descriptor)).toEqual([
			{ code: "schema-min-length", severity: "error", message: "value length 2 is below the minimum of 3." },
		]);
	});

	it("maxLength: accepts the bound and rejects longer", () => {
		const descriptor: FieldDescriptor = { type: "string", maxLength: 3 };
		expect(validateFieldValue("code", "abc", descriptor)).toEqual([]);
		expect(validateFieldValue("code", "abcd", descriptor)).toEqual([
			{ code: "schema-max-length", severity: "error", message: "value length 4 exceeds the maximum of 3." },
		]);
	});

	it("string length counts characters, not UTF-16 code units", () => {
		expect(validateFieldValue("icon", "😀", { type: "string", maxLength: 1 })).toEqual([]);
	});

	it("deprecated: warns whatever the value", () => {
		expect(validateFieldValue("old", "anything", { deprecated: true })).toEqual([
			{ code: "schema-deprecated", severity: "warning", message: '"old" is deprecated.' },
		]);
	});

	it("deprecated: warns for a missing value, and checks nothing else", () => {
		const descriptor: FieldDescriptor = { deprecated: true, enum: ["a"] };
		expect(codes(validateFieldValue("old", null, descriptor))).toEqual(["schema-deprecated"]);
	});

	it("checks no keyword of a value that does not match the declared type", () => {
		const descriptor: FieldDescriptor = { type: "number", min: 10, deprecated: true };
		expect(codes(validateFieldValue("size", "small", descriptor))).toEqual(["schema-deprecated"]);
	});

	it("checks no keyword of a content value", () => {
		expect(validateFieldValue("body", "x", { type: "content", enum: ["y"] })).toEqual([]);
	});

	it("applies numeric bounds to numbers and length to strings only", () => {
		expect(validateFieldValue("v", "5", { min: 10 })).toEqual([]);
		expect(validateFieldValue("v", 12345, { maxLength: 2 })).toEqual([]);
	});
});

describe("deprecationMessage", () => {
	it("words a boolean", () => {
		expect(deprecationMessage("old", true)).toBe('"old" is deprecated.');
	});

	it("words a string", () => {
		expect(deprecationMessage("old", "use new instead")).toBe('"old" is deprecated: use new instead.');
	});

	it("words a replacement", () => {
		expect(deprecationMessage("old", { replaceWith: "new" })).toBe('"old" is deprecated. Use "new" instead.');
	});

	it("words a version and a message", () => {
		expect(deprecationMessage("old", { since: "2.0", message: "Removed in 3.0." })).toBe(
			'"old" is deprecated since 2.0. Removed in 3.0.',
		);
	});
});

describe("coerceFieldValue", () => {
	it("keeps a value that already matches a declared type", () => {
		expect(coerceFieldValue("fenced", ["boolean", "string"])).toBe("fenced");
	});

	it("turns text into the declared scalar type", () => {
		expect(coerceFieldValue("42", "number")).toBe(42);
		expect(coerceFieldValue("3", "integer")).toBe(3);
		expect(coerceFieldValue("3.5", "integer")).toBe("3.5");
		expect(coerceFieldValue("False", "boolean")).toBe(false);
		expect(coerceFieldValue("yes", "boolean")).toBe("yes");
	});

	it("leaves a value with no declared type alone", () => {
		expect(coerceFieldValue("42", undefined)).toBe("42");
	});
});
