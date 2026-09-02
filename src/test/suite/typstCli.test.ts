import * as assert from "assert";
import * as path from "node:path";
import {
	buildBlockArgv,
	buildCellArgv,
	compileCwd,
	mergeInputs,
	parseInputString,
	resolveCompileRoot,
	resolveProjectPath,
	typstColourHex,
	type TypstPaths,
} from "../../utils/typst/typstCli";

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
	suite("resolveProjectPath", () => {
		test("Should resolve a leading slash against the project root", () => {
			assert.strictEqual(resolveProjectPath("/assets/fonts", PROJECT), path.join(PROJECT, "assets", "fonts"));
		});

		test("Should leave a relative path alone, which the filter does as well", () => {
			// `paths.lua:44` returns the path unchanged, so it resolves against the
			// working directory of the compile and not against the project.
			assert.strictEqual(resolveProjectPath("fonts", PROJECT), "fonts");
		});

		test("Should strip the leading slash when there is no project root", () => {
			assert.strictEqual(resolveProjectPath("/assets/fonts", undefined), path.join("assets", "fonts"));
		});

		test("Should leave an empty path alone", () => {
			assert.strictEqual(resolveProjectPath("", PROJECT), "");
		});
	});

	suite("resolveCompileRoot", () => {
		test("Should default to the document directory", () => {
			assert.strictEqual(resolveCompileRoot(undefined, PATHS), DOCUMENT);
		});

		test("Should resolve a relative root against the document directory", () => {
			assert.strictEqual(resolveCompileRoot("..", PATHS), path.join(PROJECT, "posts"));
		});

		test("Should resolve a leading slash against the project root", () => {
			assert.strictEqual(resolveCompileRoot("/assets", PATHS), path.join(PROJECT, "assets"));
		});

		test("Should read a bare slash as the project root itself", () => {
			assert.strictEqual(resolveCompileRoot("/", PATHS), PROJECT);
		});

		test("Should fall back to the project root for a document with no directory", () => {
			assert.strictEqual(resolveCompileRoot(undefined, { projectRoot: PROJECT }), PROJECT);
		});

		test("Should resolve nothing when there is no directory and no project", () => {
			assert.strictEqual(resolveCompileRoot("..", {}), undefined);
		});

		test("Should resolve a leading slash to nothing when there is no project", () => {
			// The root is what confines every read, so a guess would either widen it
			// past the document or point it somewhere the document never names.
			assert.strictEqual(resolveCompileRoot("/assets", { documentDirectory: DOCUMENT }), undefined);
		});
	});

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

		test("Should carry the global map alone when the block writes none", () => {
			assert.deepStrictEqual(mergeInputs({ a: "1" }, undefined), { a: "1" });
		});

		test("Should carry the block string alone when there is no global map", () => {
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

	suite("compileCwd", () => {
		test("Should run from the project root, which a relative font path needs", () => {
			assert.strictEqual(compileCwd(PATHS), PROJECT);
		});

		test("Should fall back to the document directory outside every project", () => {
			assert.strictEqual(compileCwd({ documentDirectory: DOCUMENT }), DOCUMENT);
		});

		test("Should run from nowhere in particular for a document with neither", () => {
			assert.strictEqual(compileCwd({}), undefined);
		});
	});

	suite("buildBlockArgv", () => {
		test("Should compile from stdin to stdout as SVG, rooted at the document", () => {
			assert.deepStrictEqual(buildBlockArgv(DOCUMENT), ["compile", "--format", "svg", "--root", DOCUMENT, "-", "-"]);
		});

		test("Should carry no root for a document that is not a file on disk", () => {
			assert.deepStrictEqual(buildBlockArgv(undefined), ["compile", "--format", "svg", "-", "-"]);
		});
	});

	suite("buildCellArgv", () => {
		test("Should root a cell at its document directory by default", () => {
			const argv = buildCellArgv({ options: {}, paths: PATHS });
			assert.deepStrictEqual(argv, ["compile", "--format", "svg", "--root", DOCUMENT, "-", "-"]);
		});

		test("Should root a cell at the root the configuration names", () => {
			const argv = buildCellArgv({ options: { root: "/" }, paths: PATHS });
			assert.strictEqual(flag(argv, "--root"), PROJECT);
		});

		test("Should pass one font path per entry", () => {
			const argv = buildCellArgv({
				options: { "font-path": ["/assets/fonts", "fonts"] },
				paths: PATHS,
			});
			assert.deepStrictEqual(flags(argv, "--font-path"), [path.join(PROJECT, "assets", "fonts"), "fonts"]);
		});

		test("Should pass the package path the configuration names", () => {
			const argv = buildCellArgv({ options: { "package-path": "/packages" }, paths: PATHS });
			assert.strictEqual(flag(argv, "--package-path"), path.join(PROJECT, "packages"));
		});

		test("Should pass every input, sorted, with the block string over the map", () => {
			const argv = buildCellArgv({
				options: { input: { theme: "light", scale: "1" } },
				blockInput: "theme=dark",
				paths: PATHS,
			});
			assert.deepStrictEqual(flags(argv, "--input"), ["scale=1", "theme=dark"]);
		});

		test("Should pass the resolved colours as the inputs the filter passes", () => {
			const argv = buildCellArgv({
				options: {},
				background: 'rgb("#0d1626")',
				foreground: 'rgb("#e7ecf4")',
				paths: PATHS,
			});
			assert.deepStrictEqual(flags(argv, "--input"), [
				"typst-render-foreground=#e7ecf4",
				"typst-render-background=#0d1626",
			]);
		});

		test("Should pass no colour input for a colour no flag can carry", () => {
			const argv = buildCellArgv({ options: {}, background: "none", paths: PATHS });
			assert.deepStrictEqual(flags(argv, "--input"), []);
		});

		test("Should end with the two arguments that read stdin and write stdout", () => {
			const argv = buildCellArgv({
				options: { "font-path": ["fonts"], input: { a: "1" } },
				background: 'rgb("#ffffff")',
				paths: PATHS,
			});
			assert.deepStrictEqual(argv.slice(-2), ["-", "-"]);
			assert.deepStrictEqual(argv.slice(0, 3), ["compile", "--format", "svg"]);
		});
	});
});
