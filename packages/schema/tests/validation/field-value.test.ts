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

	it("still applies a pattern of exactly 1024 characters", () => {
		const pattern = `^${"a".repeat(1022)}$`;
		expect(pattern).toHaveLength(1024);
		expect(codes(validateFieldValue("name", "b", { type: "string", pattern }))).toEqual(["schema-pattern"]);
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

	it("deprecated: checks nothing else when the value is forwarded to a replacement", () => {
		const descriptor: FieldDescriptor = { type: "number", max: 10, deprecated: { replaceWith: "size" } };
		expect(codes(validateFieldValue("old-size", 99, descriptor))).toEqual(["schema-deprecated"]);
	});

	it("deprecated: still checks the value when no replacement is named", () => {
		const descriptor: FieldDescriptor = { type: "number", max: 10, deprecated: { since: "1.0" } };
		expect(codes(validateFieldValue("old-size", 99, descriptor))).toEqual(["schema-deprecated", "schema-max"]);
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

	it("reads text as a number the way Lua tonumber does", () => {
		expect(coerceFieldValue(" 42\t", "number")).toBe(42);
		expect(coerceFieldValue("\v42\f", "number")).toBe(42);
		expect(coerceFieldValue(".5", "number")).toBe(0.5);
		expect(coerceFieldValue("5.", "number")).toBe(5);
		expect(coerceFieldValue("007", "number")).toBe(7);
		expect(coerceFieldValue("1E3", "number")).toBe(1000);
		expect(coerceFieldValue("-0x10", "number")).toBe(-16);
		expect(coerceFieldValue("+0X10", "integer")).toBe(16);
		expect(coerceFieldValue("0x1p4", "number")).toBe(16);
		expect(coerceFieldValue("0x1P-1", "number")).toBe(0.5);
		expect(coerceFieldValue("0x.8", "number")).toBe(0.5);
		expect(coerceFieldValue("0x1.8", "number")).toBe(1.5);
		expect(coerceFieldValue("0x.8p1", "number")).toBe(1);
	});

	it("rounds a long or tiny hexadecimal float once, as Lua does", () => {
		expect(coerceFieldValue("0x123456789abcdef01p-4", "number")).toBe(0x123456789abcdf * 2 ** 8);
		expect(coerceFieldValue("0x1000p-1080", "number")).toBe(2 ** -1068);
		expect(coerceFieldValue("0x.0000000000001p-1022", "number")).toBe(2 ** -1074);
	});

	it("reads a hexadecimal float with an overflowing exponent as Lua does", () => {
		const huge = "9".repeat(309);
		expect(coerceFieldValue(`0x1p${huge}`, "number")).toBe(Infinity);
		expect(coerceFieldValue(`-0x1p${huge}`, "number")).toBe(-Infinity);
		expect(coerceFieldValue(`0x1p-${huge}`, "number")).toBe(0);
		expect(coerceFieldValue(`0x0p${huge}`, "number")).toBe(0);
		expect(coerceFieldValue("0x0p5000", "number")).toBe(0);
	});

	it("reads a hexadecimal float with a very long significand as Lua does", () => {
		expect(coerceFieldValue(`0x.${"f".repeat(300)}`, "number")).toBe(1);
		expect(coerceFieldValue(`0x.${"f".repeat(600)}`, "number")).toBe(1);
		expect(coerceFieldValue(`0x${"0".repeat(600)}1p0`, "number")).toBe(1);
	});

	it("reads a long run of digits that is not a number in linear time", () => {
		const text = "9".repeat(50_000) + "x";
		const started = performance.now();
		expect(coerceFieldValue(text, "number")).toBe(text);
		expect(performance.now() - started).toBeLessThan(1000);
	});

	it("wraps a hexadecimal integer at 64 bits, as Lua does", () => {
		expect(coerceFieldValue("0xffffffffffffffff", "integer")).toBe(-1);
		expect(coerceFieldValue("0x10000000000000000", "integer")).toBe(0);
		expect(coerceFieldValue("-0xffffffffffffffff", "integer")).toBe(1);
	});

	it("reads an overflowing decimal as an infinite number, but not as an integer", () => {
		expect(coerceFieldValue("1e999", "number")).toBe(Infinity);
		expect(coerceFieldValue("-1e999", "number")).toBe(-Infinity);
		expect(coerceFieldValue("1e999", "integer")).toBe("1e999");
	});

	it("leaves text that Lua tonumber rejects as text", () => {
		for (const text of [
			"0b101",
			"0B101",
			"0o7",
			"0O7",
			"0x",
			"0x1p",
			"1e",
			"1e+",
			".",
			"- 42",
			"--42",
			"1_000",
			"1,5",
			"Infinity",
			"-Infinity",
			"inf",
			"nan",
			"NaN",
			"\u00a042",
			"\ufeff42",
			"\u200342",
			"42\u00a0",
		]) {
			expect(coerceFieldValue(text, "number"), JSON.stringify(text)).toBe(text);
		}
	});
});
