import * as assert from "assert";
import { readYamlScalarAsQuarto, readYamlValueForType } from "../../utils/quartoYamlScalar";

const cases: [unknown, unknown][] = [
	["0b101", 5],
	["0b1_01", 5],
	["+0b11", 3],
	["-0b11", -3],
	["-0x10", -16],
	["0x_1F", 31],
	["0o17_0", 120],
	["1_000", 1000],
	["1__0", 10],
	["1.5_0", 1.5],
	["1e999", ".inf"],
	[Infinity, ".inf"],
	[-Infinity, "-.inf"],
	[NaN, ".nan"],
	["_1", "_1"],
	["1_", "1_"],
	["0b", "0b"],
	["0x_", "0x_"],
	["0B101", "0B101"],
	["0O7", "0O7"],
	["1:20", "1:20"],
	["-1:20", "-1:20"],
	["0x1p4", "0x1p4"],
	[7, 7],
	[12, 12],
	[1500, 1500],
	[true, true],
	["abc", "abc"],
	[null, null],
];

suite("Quarto YAML Scalar Test Suite", () => {
	for (const [input, expected] of cases) {
		test(`Should read ${String(input)} (${typeof input}) as ${JSON.stringify(expected)}`, () => {
			assert.deepStrictEqual(readYamlScalarAsQuarto(input), expected);
		});
	}

	test("Should read a number for a number type", () => {
		assert.strictEqual(readYamlValueForType("0b101", "number"), 5);
		assert.strictEqual(readYamlValueForType("0b101", ["integer", "null"]), 5);
	});

	test("Should leave the value alone when the type takes a string", () => {
		assert.strictEqual(readYamlValueForType("0b101", ["number", "string"]), "0b101");
		assert.strictEqual(readYamlValueForType("0b101", "string"), "0b101");
		assert.strictEqual(readYamlValueForType("0b101", undefined), "0b101");
	});
});
