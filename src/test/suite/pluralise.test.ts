import * as assert from "assert";
import { pluralise } from "../../utils/pluralise";

suite("Pluralise Test Suite", () => {
	test("uses the singular for one", () => {
		assert.strictEqual(pluralise(1, "extension"), "1 extension");
	});

	test("uses the plural for zero", () => {
		assert.strictEqual(pluralise(0, "extension"), "0 extensions");
	});

	test("adds an s for more than one", () => {
		assert.strictEqual(pluralise(2, "arg"), "2 args");
	});

	test("uses the given plural", () => {
		assert.strictEqual(pluralise(3, "repository", "repositories"), "3 repositories");
	});
});
