/**
 * @title Field Value Validation
 * @description Validation of one value against a field descriptor.
 *
 * Shared by the YAML and the inline attribute diagnostics. The checks follow
 * the Lua reference validator (`schema.lua`), and a conformance test holds the
 * two to the same findings for the extension schemas in this repository.
 * Type and `const` checks stay with each caller, because an inline attribute
 * is text and a YAML value is not.
 *
 * @module validation
 */

import type { DeprecatedSpec, FieldDescriptor } from "../types/schema.js";

/**
 * Machine-readable code of a field value finding.
 */
export type FieldFindingCode =
	| "schema-enum"
	| "schema-min"
	| "schema-max"
	| "schema-pattern"
	| "schema-min-length"
	| "schema-max-length"
	| "schema-deprecated";

/**
 * One finding about a field value.
 *
 * The message of a value finding names no key, so each caller adds its own
 * prefix. The message of a deprecation names the key, quoted, and reads as a
 * sentence once the caller puts a noun such as `Option` in front.
 */
export interface FieldFinding {
	code: FieldFindingCode;
	severity: "error" | "warning" | "information";
	message: string;
}

/** Longest pattern that is compiled, as a guard against ReDoS. */
const MAX_PATTERN_LENGTH = 1024;

const KNOWN_TYPES = new Set(["string", "number", "integer", "boolean", "array", "object", "null", "content"]);

function typeNames(type: string | string[] | undefined): string[] {
	if (type === undefined) {
		return [];
	}
	return Array.isArray(type) ? type : [type];
}

function matchesTypeName(value: unknown, name: string): boolean {
	switch (name) {
		case "string":
			return typeof value === "string";
		case "number":
			return typeof value === "number";
		case "integer":
			return typeof value === "number" && Number.isInteger(value);
		case "boolean":
			return typeof value === "boolean";
		case "array":
			return Array.isArray(value);
		case "object":
			return typeof value === "object" && value !== null && !Array.isArray(value);
		case "null":
			return value === null || value === undefined;
		case "content":
			return value !== null && value !== undefined;
		default:
			return false;
	}
}

/**
 * Whether a value satisfies the declared type. A type name this module does
 * not know is not checked, so a descriptor that declares only such names
 * accepts any value.
 */
function matchesDeclaredType(value: unknown, type: string | string[] | undefined): boolean {
	const known = typeNames(type).filter((name) => KNOWN_TYPES.has(name));
	return known.length === 0 || known.some((name) => matchesTypeName(value, name));
}

/**
 * The forms that Lua 5.4 `tonumber` accepts, between the six ASCII spaces of
 * C `isspace`. `Number()` alone accepts more, such as `0b101`, `0o7` and a
 * no-break space, and fewer, such as `-0x10` and the hexadecimal float `0x1p4`.
 */
const LUA_SPACE = String.raw`[ \t\n\v\f\r]*`;
const LUA_DECIMAL = new RegExp(String.raw`^${LUA_SPACE}([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)${LUA_SPACE}$`);
const LUA_HEX = new RegExp(
	String.raw`^${LUA_SPACE}([+-]?)0[xX](?:([\da-fA-F]+)(?:\.([\da-fA-F]*))?|\.([\da-fA-F]+))(?:[pP]([+-]?\d+))?${LUA_SPACE}$`,
);

/**
 * Read text as a number, as Lua 5.4 `tonumber` does.
 *
 * A hexadecimal integer wraps at 64 bits, so `0xffffffffffffffff` is -1. A
 * decimal that overflows is an infinity.
 *
 * @returns The number, or `undefined` when Lua answers nil.
 */
function luaToNumber(text: string): number | undefined {
	const decimal = LUA_DECIMAL.exec(text);
	if (decimal) {
		return Number(decimal[1]);
	}
	const hex = LUA_HEX.exec(text);
	if (!hex) {
		return undefined;
	}
	const [, sign, whole = "", trailing, bare, exponent] = hex;
	const fraction = trailing ?? bare;
	if (fraction === undefined && exponent === undefined) {
		const wrapped = BigInt.asIntN(64, BigInt(`0x${whole}`) * (sign === "-" ? -1n : 1n));
		return Number(wrapped);
	}
	let mantissa = 0;
	for (const digit of whole + (fraction ?? "")) {
		mantissa = mantissa * 16 + parseInt(digit, 16);
	}
	const power = Number(exponent ?? 0) - 4 * (fraction?.length ?? 0);
	return (sign === "-" ? -mantissa : mantissa) * 2 ** power;
}

function coerceScalar(value: string, name: string): { ok: boolean; value?: unknown } {
	if (name === "number" || name === "integer") {
		const number = luaToNumber(value);
		// An integer is finite, as the Lua type check requires.
		if (number !== undefined && (name === "number" || Number.isInteger(number))) {
			return { ok: true, value: number };
		}
	} else if (name === "boolean") {
		const lowered = value.toLowerCase();
		if (lowered === "true" || lowered === "false") {
			return { ok: true, value: lowered === "true" };
		}
	}
	return { ok: false };
}

/**
 * Coerce a value towards its declared type, as the Lua validator does.
 *
 * A value that already matches one declared type is returned unchanged, so
 * `type: [boolean, string]` keeps the text "fenced" a string. Otherwise text
 * becomes the first scalar type it can stand for: a number, an integer, or
 * `true` and `false` in any case.
 *
 * @param value - The value to coerce.
 * @param type - The declared type of the field.
 * @returns The coerced value, or the value unchanged.
 */
export function coerceFieldValue(value: unknown, type: string | string[] | undefined): unknown {
	const names = typeNames(type);
	if (names.length === 0 || value === null || value === undefined) {
		return value;
	}
	if (names.some((name) => matchesTypeName(value, name))) {
		return value;
	}
	if (typeof value === "string") {
		for (const name of names) {
			const coerced = coerceScalar(value, name);
			if (coerced.ok) {
				return coerced.value;
			}
		}
	}
	return value;
}

/**
 * Build the message of a deprecation warning.
 *
 * @param key - The key as the author wrote it.
 * @param deprecated - The `deprecated` keyword of the descriptor.
 * @returns A sentence that starts with the quoted key, such as
 *   `"old" is deprecated. Use "new" instead.`
 */
export function deprecationMessage(key: string, deprecated: boolean | string | DeprecatedSpec): string {
	if (typeof deprecated === "string") {
		return `"${key}" is deprecated: ${deprecated}.`;
	}
	if (typeof deprecated === "object") {
		const parts = [`"${key}" is deprecated`];
		if (deprecated.since) {
			parts[0] += ` since ${deprecated.since}`;
		}
		if (deprecated.message) {
			parts.push(deprecated.message);
		} else if (deprecated.replaceWith) {
			parts.push(`Use "${deprecated.replaceWith}" instead.`);
		}
		return parts.join(". ") + (parts[parts.length - 1].endsWith(".") ? "" : ".");
	}
	return `"${key}" is deprecated.`;
}

function error(code: FieldFindingCode, message: string): FieldFinding {
	return { code, severity: "error", message };
}

function checkEnum(value: unknown, descriptor: FieldDescriptor, findings: FieldFinding[]): void {
	if (!descriptor.enum) {
		return;
	}
	const allowed = descriptor.enum.map((literal) => coerceFieldValue(literal, descriptor.type));
	const match = allowed.some(
		(literal) =>
			literal === value ||
			(descriptor.enumCaseInsensitive === true &&
				typeof literal === "string" &&
				typeof value === "string" &&
				literal.toLowerCase() === value.toLowerCase()),
	);
	if (!match) {
		findings.push(
			error(
				"schema-enum",
				`value "${String(value)}" is not in the allowed values (${descriptor.enum.map(String).join(", ")}).`,
			),
		);
	}
}

function checkNumeric(value: number, descriptor: FieldDescriptor, findings: FieldFinding[]): void {
	if (descriptor.min !== undefined && value < descriptor.min) {
		findings.push(error("schema-min", `value ${value} is below the minimum of ${descriptor.min}.`));
	}
	if (descriptor.max !== undefined && value > descriptor.max) {
		findings.push(error("schema-max", `value ${value} exceeds the maximum of ${descriptor.max}.`));
	}
	if (descriptor.exclusiveMinimum !== undefined && value <= descriptor.exclusiveMinimum) {
		findings.push(error("schema-min", `value ${value} must be greater than ${descriptor.exclusiveMinimum}.`));
	}
	if (descriptor.exclusiveMaximum !== undefined && value >= descriptor.exclusiveMaximum) {
		findings.push(error("schema-max", `value ${value} must be less than ${descriptor.exclusiveMaximum}.`));
	}
}

function checkString(value: string, descriptor: FieldDescriptor, findings: FieldFinding[]): void {
	if (descriptor.pattern && descriptor.pattern.length <= MAX_PATTERN_LENGTH) {
		let regex: RegExp | undefined;
		try {
			regex = descriptor.patternExact ? new RegExp(`^${descriptor.pattern}$`) : new RegExp(descriptor.pattern);
		} catch {
			// The schema definition diagnostics report a pattern that does not
			// compile, so a value is not held to it here.
		}
		if (regex && !regex.test(value)) {
			findings.push(
				error("schema-pattern", `value "${value}" does not match the required pattern "${descriptor.pattern}".`),
			);
		}
	}

	// Characters and not UTF-16 code units, as the Lua validator counts them.
	const length = [...value].length;
	if (descriptor.minLength !== undefined && length < descriptor.minLength) {
		findings.push(
			error("schema-min-length", `value length ${length} is below the minimum of ${descriptor.minLength}.`),
		);
	}
	if (descriptor.maxLength !== undefined && length > descriptor.maxLength) {
		findings.push(error("schema-max-length", `value length ${length} exceeds the maximum of ${descriptor.maxLength}.`));
	}
}

/**
 * Validate one value against a field descriptor.
 *
 * Checks `deprecated`, `enum` (with `enumCaseInsensitive`), the numeric bounds,
 * `pattern`, `minLength` and `maxLength`. A missing value, a value of another
 * type than the declared one, a `content` value, and the value of a field
 * deprecated with a `replaceWith` get the deprecation finding only: the caller
 * reports a type error, content is not checked, and a replaced value belongs
 * to its replacement.
 *
 * @param key - The key as the author wrote it, used by the deprecation message.
 * @param value - The value, already coerced to the declared type when it was text.
 * @param descriptor - The descriptor of the field.
 * @returns The findings, in the order of the checks. Empty when the value is valid.
 */
export function validateFieldValue(key: string, value: unknown, descriptor: FieldDescriptor): FieldFinding[] {
	const findings: FieldFinding[] = [];

	if (descriptor.deprecated) {
		findings.push({
			code: "schema-deprecated",
			severity: "warning",
			message: deprecationMessage(key, descriptor.deprecated),
		});
	}

	// The Lua validator moves a value with a replacement to the replacement,
	// and so never holds it to this descriptor.
	const forwarded = typeof descriptor.deprecated === "object" && Boolean(descriptor.deprecated.replaceWith);

	if (
		forwarded ||
		value === null ||
		value === undefined ||
		typeNames(descriptor.type).includes("content") ||
		!matchesDeclaredType(value, descriptor.type)
	) {
		return findings;
	}

	checkEnum(value, descriptor, findings);
	if (typeof value === "number") {
		checkNumeric(value, descriptor, findings);
	}
	if (typeof value === "string") {
		checkString(value, descriptor, findings);
	}

	return findings;
}
