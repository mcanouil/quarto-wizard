import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { parseSchemaFile } from "../../src/filesystem/schema.js";
import { coerceFieldValue, validateFieldValue, type FieldFindingCode } from "../../src/validation/field-value.js";
import type { ExtensionSchema, FieldDescriptor } from "../../src/types/schema.js";

// `npm run test:lua` writes this file with the Lua validator, then runs this
// test alone with QW_SCHEMA_CONFORMANCE=1. Without that variable the test
// skips, so a file left by an earlier run never decides a plain `npm test`.
const enabled = process.env.QW_SCHEMA_CONFORMANCE === "1";
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const findingsPath = join(
	packageRoot,
	"..",
	"..",
	"node_modules",
	".cache",
	"quarto-wizard-schema",
	"lua-field-findings.json",
);

interface LuaFinding {
	keyword: string;
	severity: string;
}

interface Probe {
	file: string;
	location: (string | number)[];
	value: unknown;
	// Whether the Lua validator reports the value, once coerced, as the wrong type.
	wrong_type: boolean;
	// The Lua encoder writes an empty table as `{}`.
	findings: LuaFinding[] | Record<string, never>;
}

// The Lua keywords that `validateFieldValue` checks. The other keywords,
// such as `const` and `multipleOf`, are left to the callers or not checked.
const KEYWORD_CODES: Record<string, FieldFindingCode> = {
	enum: "schema-enum",
	minimum: "schema-min",
	exclusiveMinimum: "schema-min",
	maximum: "schema-max",
	exclusiveMaximum: "schema-max",
	pattern: "schema-pattern",
	minLength: "schema-min-length",
	maxLength: "schema-max-length",
	deprecated: "schema-deprecated",
};

function descriptorAt(schema: ExtensionSchema, location: (string | number)[]): FieldDescriptor | undefined {
	let node: unknown = schema;
	for (const part of location) {
		if (node === null || typeof node !== "object") {
			return undefined;
		}
		node = (node as Record<string | number, unknown>)[part];
	}
	return node as FieldDescriptor | undefined;
}

// Text is of the wrong type when it stays text after coercion and the field
// declares no type that holds text, as the inline attribute diagnostics read
// it. The Lua validator moves a value with a replacement to the replacement,
// and so never checks its type against this descriptor.
function textOfWrongType(coerced: unknown, descriptor: FieldDescriptor): boolean {
	const type = descriptor.type;
	const names = type === undefined ? [] : Array.isArray(type) ? type : [type];
	const forwarded = typeof descriptor.deprecated === "object" && Boolean(descriptor.deprecated.replaceWith);
	return (
		!forwarded &&
		typeof coerced === "string" &&
		names.length > 0 &&
		!names.includes("string") &&
		!names.includes("content")
	);
}

function luaFindings(probe: Probe): string[] {
	const findings = Array.isArray(probe.findings) ? probe.findings : [];
	return findings
		.filter((finding) => finding.keyword in KEYWORD_CODES)
		.map((finding) => `${KEYWORD_CODES[finding.keyword]} ${finding.severity}`)
		.sort();
}

const probes: Probe[] = enabled && existsSync(findingsPath) ? JSON.parse(readFileSync(findingsPath, "utf-8")) : [];
const byFile = new Map<string, Probe[]>();
for (const probe of probes) {
	const file = resolve(packageRoot, probe.file);
	byFile.set(file, [...(byFile.get(file) ?? []), probe]);
}

describe.skipIf(!enabled)("field value conformance with the Lua validator (run by npm run test:lua)", () => {
	it("reads the probes that the Lua sweep wrote", () => {
		expect(existsSync(findingsPath), `${findingsPath} is missing`).toBe(true);
		expect(probes.length).toBeGreaterThan(0);
	});

	it("probes the extensions of both corpora", () => {
		const files = [...byFile.keys()].map((file) => relative(join(packageRoot, "..", ".."), file));
		expect(files.some((file) => file.startsWith(join("docs", "_extensions")))).toBe(true);
		expect(files.some((file) => file.startsWith(join("test-fixtures", "_extensions")))).toBe(true);
	});

	for (const [file, fileProbes] of byFile) {
		it(`gives the findings of the Lua validator for ${relative(packageRoot, file)}`, () => {
			const schema = parseSchemaFile(file);
			const mismatches = [];
			for (const probe of fileProbes) {
				const descriptor = descriptorAt(schema, probe.location);
				if (!descriptor) {
					mismatches.push({ location: probe.location, problem: "no descriptor in the TypeScript schema" });
					continue;
				}
				const key = String(probe.location[probe.location.length - 1]);
				const coerced = coerceFieldValue(probe.value, descriptor.type);
				if (typeof probe.value === "string" && textOfWrongType(coerced, descriptor) !== probe.wrong_type) {
					mismatches.push({ location: probe.location, value: probe.value, luaWrongType: probe.wrong_type, coerced });
					continue;
				}
				const actual = validateFieldValue(key, coerced, descriptor)
					.map((finding) => `${finding.code} ${finding.severity}`)
					.sort();
				const expected = luaFindings(probe);
				if (actual.join("|") !== expected.join("|")) {
					mismatches.push({ location: probe.location, value: probe.value, lua: expected, typescript: actual });
				}
			}
			expect(mismatches).toEqual([]);
		});
	}
});
