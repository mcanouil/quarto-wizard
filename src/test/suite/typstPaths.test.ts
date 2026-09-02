import * as assert from "assert";
import * as path from "node:path";
import { compileCwd, resolveCompileRoot, resolveProjectPath, type TypstPaths } from "../../utils/typst/typstPaths";

const PROJECT = path.join("/home", "site");
const DOCUMENT = path.join(PROJECT, "posts", "2026");

/** A project with a document below it, which is the ordinary case. */
const PATHS: TypstPaths = { projectRoot: PROJECT, documentDirectory: DOCUMENT };

suite("Typst Paths Test Suite", () => {
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
});
