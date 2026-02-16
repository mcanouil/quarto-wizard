import * as assert from "assert";
import { isFilePathDescriptor } from "../../utils/filePathCompletion";
import { hasCompletableValues } from "../../utils/schemaDocumentation";
import type { FieldDescriptor } from "@quarto-wizard/core";

suite("File Path Completion", () => {
	suite("isFilePathDescriptor", () => {
		test("should return true when completion.type is 'file'", () => {
			const descriptor: FieldDescriptor = {
				type: "string",
				completion: { type: "file" },
			};
			assert.strictEqual(isFilePathDescriptor(descriptor), true);
		});

		test("should return true with file type and extensions", () => {
			const descriptor: FieldDescriptor = {
				type: "string",
				completion: { type: "file", extensions: [".md", ".qmd"] },
			};
			assert.strictEqual(isFilePathDescriptor(descriptor), true);
		});

		test("should return false when completion is undefined", () => {
			const descriptor: FieldDescriptor = {
				type: "string",
			};
			assert.strictEqual(isFilePathDescriptor(descriptor), false);
		});

		test("should return false when completion.type is not 'file'", () => {
			const descriptor: FieldDescriptor = {
				type: "string",
				completion: { values: ["a", "b"] },
			};
			assert.strictEqual(isFilePathDescriptor(descriptor), false);
		});

		test("should return false for a boolean descriptor", () => {
			const descriptor: FieldDescriptor = {
				type: "boolean",
			};
			assert.strictEqual(isFilePathDescriptor(descriptor), false);
		});

		test("should return false for an enum descriptor without file completion", () => {
			const descriptor: FieldDescriptor = {
				type: "string",
				enum: ["a", "b", "c"],
			};
			assert.strictEqual(isFilePathDescriptor(descriptor), false);
		});
	});

	suite("hasCompletableValues recognises file-path descriptors", () => {
		test("should return true for file-path descriptor", () => {
			const descriptor: FieldDescriptor = {
				type: "string",
				completion: { type: "file" },
			};
			assert.strictEqual(hasCompletableValues(descriptor), true);
		});

		test("should return true for file-path descriptor with extensions", () => {
			const descriptor: FieldDescriptor = {
				type: "string",
				completion: { type: "file", extensions: [".qmd"] },
			};
			assert.strictEqual(hasCompletableValues(descriptor), true);
		});

		test("should still return true for enum descriptor", () => {
			const descriptor: FieldDescriptor = {
				type: "string",
				enum: ["a", "b"],
			};
			assert.strictEqual(hasCompletableValues(descriptor), true);
		});

		test("should still return true for boolean descriptor", () => {
			const descriptor: FieldDescriptor = {
				type: "boolean",
			};
			assert.strictEqual(hasCompletableValues(descriptor), true);
		});

		test("should still return true for completion.values descriptor", () => {
			const descriptor: FieldDescriptor = {
				type: "string",
				completion: { values: ["x", "y"] },
			};
			assert.strictEqual(hasCompletableValues(descriptor), true);
		});

		test("should return false for plain string descriptor", () => {
			const descriptor: FieldDescriptor = {
				type: "string",
			};
			assert.strictEqual(hasCompletableValues(descriptor), false);
		});
	});
});
