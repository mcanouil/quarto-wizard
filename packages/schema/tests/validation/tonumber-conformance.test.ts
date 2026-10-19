import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { coerceFieldValue } from "../../src/validation/field-value.js";

// `npm run test:lua` writes this file with Lua `tonumber`, then runs this test
// with QW_SCHEMA_CONFORMANCE=1. Without that variable the test skips.
const enabled = process.env.QW_SCHEMA_CONFORMANCE === "1";
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const resultsPath = join(
	packageRoot,
	"..",
	"..",
	"node_modules",
	".cache",
	"quarto-wizard-schema",
	"lua-tonumber.json",
);
const corpus: string[] = JSON.parse(
	readFileSync(join(packageRoot, "tests", "validation", "lua", "tonumber-corpus.json"), "utf-8"),
);

interface LuaResult {
	text: string;
	value: string | null;
}

function luaNumber(value: string | null): number | undefined {
	if (value === null) {
		return undefined;
	}
	if (value === "inf") {
		return Infinity;
	}
	if (value === "-inf") {
		return -Infinity;
	}
	return Number(value);
}

const results: LuaResult[] = enabled && existsSync(resultsPath) ? JSON.parse(readFileSync(resultsPath, "utf-8")) : [];

describe.skipIf(!enabled)("number coercion conformance with Lua tonumber (run by npm run test:lua)", () => {
	it("reads a result for every text of the corpus", () => {
		expect(existsSync(resultsPath), `${resultsPath} is missing`).toBe(true);
		expect(results.map((result) => result.text)).toEqual(corpus);
	});

	it("reads each text as the number that Lua tonumber gives", () => {
		const mismatches = [];
		for (const { text, value } of results) {
			const expected = luaNumber(value);
			const actual = coerceFieldValue(text, "number");
			// `===` and not `Object.is`: Lua has no negative integer zero, and the
			// sign of a zero changes no finding.
			const same = expected === undefined ? actual === text : actual === expected;
			if (!same) {
				mismatches.push({ text, lua: value, typescript: actual });
			}
		}
		expect(mismatches).toEqual([]);
	});
});
