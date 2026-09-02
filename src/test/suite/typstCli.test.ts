import * as assert from "assert";
import * as path from "node:path";
import {
	buildTypstCommand,
	commandKey,
	mergeInputs,
	parseInputString,
	typstColourHex,
} from "../../utils/typst/typstCli";
import type { TypstPaths } from "../../utils/typst/typstPaths";

const PROJECT = path.join("/home", "site");
const DOCUMENT = path.join(PROJECT, "posts", "2026");

/** A project with a document below it, which is the ordinary case. */
const PATHS: TypstPaths = { projectRoot: PROJECT, documentDirectory: DOCUMENT };

/** The value of one flag, or undefined when the argv carries none. */
function flag(argv: readonly string[], name: string): string | undefined {
	const at = argv.indexOf(name);
	return at === -1 ? undefined : argv[at + 1];
}

/** Every value of a flag the argv may repeat. */
function flags(argv: readonly string[], name: string): string[] {
	return argv.flatMap((value, at) => (value === name ? [argv[at + 1]] : []));
}

suite("Typst CLI Test Suite", () => {
	suite("parseInputString", () => {
		test("Should read comma-separated pairs and trim around them", () => {
			assert.deepStrictEqual(parseInputString(" a = 1 , b=2 "), { a: "1", b: "2" });
		});

		test("Should keep a key whose value is empty", () => {
			assert.deepStrictEqual(parseInputString("a="), { a: "" });
		});

		test("Should drop an entry with no equals sign and one with no key", () => {
			assert.deepStrictEqual(parseInputString("a,=2,b=3"), { b: "3" });
		});

		test("Should read an empty string as no input at all", () => {
			assert.deepStrictEqual(parseInputString(""), {});
		});
	});

	suite("mergeInputs", () => {
		test("Should let a block value win over a global one", () => {
			assert.deepStrictEqual(mergeInputs({ a: "1", b: "2" }, "b=3"), { a: "1", b: "3" });
		});

		test("Should carry the global mapping alone when the block writes none", () => {
			assert.deepStrictEqual(mergeInputs({ a: "1" }, undefined), { a: "1" });
		});

		test("Should carry the block string alone when there is no global mapping", () => {
			assert.deepStrictEqual(mergeInputs(undefined, "a=1"), { a: "1" });
		});
	});

	suite("typstColourHex", () => {
		test("Should read the hex out of a wrapped colour", () => {
			assert.strictEqual(typstColourHex('rgb("#faf6ee")'), "#faf6ee");
		});

		test("Should read nothing out of an expression that is not a wrapped hex", () => {
			// `typst_colour_to_hex` at `typst-render.lua:748-751` matches that one
			// shape, because it is the only one a `--input` can carry.
			assert.strictEqual(typstColourHex("oklch(60% 0.2 30deg)"), undefined);
			assert.strictEqual(typstColourHex("none"), undefined);
			assert.strictEqual(typstColourHex('rgb("60%, 20%, 30%")'), undefined);
			assert.strictEqual(typstColourHex(undefined), undefined);
		});
	});

	suite("buildTypstCommand", () => {
		test("Should root a block at its document directory by default", () => {
			const command = buildTypstCommand({ paths: PATHS });
			assert.deepStrictEqual(command.argv, ["compile", "--format", "svg", "--root", DOCUMENT, "-", "-"]);
			assert.strictEqual(command.cwd, PROJECT);
		});

		test("Should carry no root for a document that is not a file on disk", () => {
			const command = buildTypstCommand({ paths: {} });
			assert.deepStrictEqual(command.argv, ["compile", "--format", "svg", "-", "-"]);
			assert.strictEqual(command.cwd, undefined);
		});

		test("Should root a block at the root the configuration names", () => {
			const command = buildTypstCommand({ global: { root: "/" }, paths: PATHS });
			assert.strictEqual(flag(command.argv, "--root"), PROJECT);
		});

		test("Should pass one font path per entry", () => {
			const command = buildTypstCommand({ global: { "font-path": ["/assets/fonts", "fonts"] }, paths: PATHS });
			assert.deepStrictEqual(flags(command.argv, "--font-path"), [path.join(PROJECT, "assets", "fonts"), "fonts"]);
		});

		test("Should pass the package path the configuration names", () => {
			const command = buildTypstCommand({ global: { "package-path": "/packages" }, paths: PATHS });
			assert.strictEqual(flag(command.argv, "--package-path"), path.join(PROJECT, "packages"));
		});

		test("Should pass every input, sorted, with the block string over the mapping", () => {
			const command = buildTypstCommand({
				global: { input: { theme: "light", scale: "1" } },
				blockInput: "theme=dark",
				paths: PATHS,
			});
			assert.deepStrictEqual(flags(command.argv, "--input"), ["scale=1", "theme=dark"]);
		});

		test("Should pass the resolved colours as the inputs the filter passes", () => {
			const command = buildTypstCommand({
				background: 'rgb("#0d1626")',
				foreground: 'rgb("#e7ecf4")',
				paths: PATHS,
			});
			assert.deepStrictEqual(flags(command.argv, "--input"), [
				"typst-render-foreground=#e7ecf4",
				"typst-render-background=#0d1626",
			]);
		});

		test("Should pass no colour input for a colour no flag can carry", () => {
			const command = buildTypstCommand({ background: "none", paths: PATHS });
			assert.deepStrictEqual(flags(command.argv, "--input"), []);
		});

		test("Should end with the two arguments that read stdin and write stdout", () => {
			const command = buildTypstCommand({
				global: { "font-path": ["fonts"], input: { a: "1" } },
				background: 'rgb("#ffffff")',
				paths: PATHS,
			});
			assert.deepStrictEqual(command.argv.slice(-2), ["-", "-"]);
			assert.deepStrictEqual(command.argv.slice(0, 3), ["compile", "--format", "svg"]);
		});
	});

	suite("commandKey", () => {
		test("Should tell two commands apart by their directory alone", () => {
			const argv = ["compile", "-", "-"];
			assert.notStrictEqual(commandKey({ argv, cwd: "/a" }), commandKey({ argv, cwd: "/b" }));
		});

		test("Should give one command one key", () => {
			const command = buildTypstCommand({ paths: PATHS });
			assert.strictEqual(commandKey(command), commandKey(buildTypstCommand({ paths: PATHS })));
		});

		test("Should tell a directory that is absent from one that is empty", () => {
			assert.notStrictEqual(commandKey({ argv: [] }), commandKey({ argv: [], cwd: "" }));
		});

		test("Should let no character of an argument spell a boundary", () => {
			// A YAML double-quoted `input:` value can hold any character, the NUL of a
			// `"\0"` escape included, so no separator is safe to rely on. Such a
			// command never spawns, and aliasing one onto a command that does spawn
			// would serve its image for the wrong document.
			const nul = String.fromCharCode(0);
			assert.notStrictEqual(commandKey({ argv: [`a${nul}b`] }), commandKey({ argv: ["a", "b"] }));
		});
	});
});
