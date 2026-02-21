import * as assert from "assert";
import { getSchemaContext } from "../../providers/schemaDefinitionCompletionProvider";
import type { SchemaContext } from "../../providers/schemaDefinitionCompletionProvider";

suite("Schema Definition Completion Test Suite", () => {
	suite("getSchemaContext", () => {
		suite("key position", () => {
			test("Empty path returns root", () => {
				const result = getSchemaContext([], false);
				assert.deepStrictEqual(result, { kind: "root" });
			});

			test("['options'] returns null (user-defined children)", () => {
				const result = getSchemaContext(["options"], false);
				assert.strictEqual(result, null);
			});

			test("['options', 'myField'] returns field-descriptor", () => {
				const result = getSchemaContext(["options", "myField"], false);
				assert.deepStrictEqual(result, { kind: "field-descriptor", allowName: false });
			});

			test("['options', 'myField', 'items'] returns field-descriptor", () => {
				const result = getSchemaContext(["options", "myField", "items"], false);
				assert.deepStrictEqual(result, { kind: "field-descriptor", allowName: false });
			});

			test("['options', 'myField', 'properties'] returns null (user-defined)", () => {
				const result = getSchemaContext(["options", "myField", "properties"], false);
				assert.strictEqual(result, null);
			});

			test("['options', 'myField', 'properties', 'sub'] returns field-descriptor", () => {
				const result = getSchemaContext(["options", "myField", "properties", "sub"], false);
				assert.deepStrictEqual(result, { kind: "field-descriptor", allowName: false });
			});

			test("['projects'] returns null", () => {
				const result = getSchemaContext(["projects"], false);
				assert.strictEqual(result, null);
			});

			test("['projects', 'myProj'] returns null (flat string array)", () => {
				const result = getSchemaContext(["projects", "myProj"], false);
				assert.strictEqual(result, null);
			});

			test("['formats'] returns null", () => {
				const result = getSchemaContext(["formats"], false);
				assert.strictEqual(result, null);
			});

			test("['formats', 'html'] returns null", () => {
				const result = getSchemaContext(["formats", "html"], false);
				assert.strictEqual(result, null);
			});

			test("['formats', 'html', 'colour'] returns field-descriptor", () => {
				const result = getSchemaContext(["formats", "html", "colour"], false);
				assert.deepStrictEqual(result, { kind: "field-descriptor", allowName: false });
			});

			test("['attributes'] returns null", () => {
				const result = getSchemaContext(["attributes"], false);
				assert.strictEqual(result, null);
			});

			test("['attributes', 'modal'] returns null", () => {
				const result = getSchemaContext(["attributes", "modal"], false);
				assert.strictEqual(result, null);
			});

			test("['attributes', 'modal', 'size'] returns field-descriptor", () => {
				const result = getSchemaContext(["attributes", "modal", "size"], false);
				assert.deepStrictEqual(result, { kind: "field-descriptor", allowName: false });
			});

			test("['classes'] returns null (user-defined class names)", () => {
				const result = getSchemaContext(["classes"], false);
				assert.strictEqual(result, null);
			});

			test("['classes', 'panel'] returns class-entry", () => {
				const result = getSchemaContext(["classes", "panel"], false);
				assert.deepStrictEqual(result, { kind: "class-entry" });
			});

			test("['classes', 'panel', 'description'] with value returns null", () => {
				const result = getSchemaContext(["classes", "panel", "description"], true);
				assert.strictEqual(result, null);
			});

			test("['shortcodes'] returns null", () => {
				const result = getSchemaContext(["shortcodes"], false);
				assert.strictEqual(result, null);
			});

			test("['shortcodes', 'mysc'] returns shortcode-entry", () => {
				const result = getSchemaContext(["shortcodes", "mysc"], false);
				assert.deepStrictEqual(result, { kind: "shortcode-entry" });
			});

			test("['shortcodes', 'mysc', 'arguments'] returns field-descriptor with allowName", () => {
				const result = getSchemaContext(["shortcodes", "mysc", "arguments"], false);
				assert.deepStrictEqual(result, { kind: "field-descriptor", allowName: true });
			});

			test("['shortcodes', 'mysc', 'attributes'] returns null", () => {
				const result = getSchemaContext(["shortcodes", "mysc", "attributes"], false);
				assert.strictEqual(result, null);
			});

			test("['shortcodes', 'mysc', 'attributes', 'flag'] returns field-descriptor", () => {
				const result = getSchemaContext(["shortcodes", "mysc", "attributes", "flag"], false);
				assert.deepStrictEqual(result, { kind: "field-descriptor", allowName: false });
			});

			test("Deep nesting through items and properties", () => {
				const result = getSchemaContext(["options", "field", "items", "properties", "sub", "items"], false);
				assert.deepStrictEqual(result, { kind: "field-descriptor", allowName: false });
			});
		});

		suite("value position", () => {
			test("['$schema'] with value returns schema-uri", () => {
				const result = getSchemaContext(["$schema"], true);
				assert.deepStrictEqual(result, { kind: "value", valueType: "schema-uri" });
			});

			test("['options', 'myField', 'type'] with value returns type", () => {
				const result = getSchemaContext(["options", "myField", "type"], true);
				assert.deepStrictEqual(result, { kind: "value", valueType: "type" });
			});

			test("['options', 'myField', 'required'] with value returns boolean", () => {
				const result = getSchemaContext(["options", "myField", "required"], true);
				assert.deepStrictEqual(result, { kind: "value", valueType: "boolean" });
			});

			test("['options', 'myField', 'deprecated'] with value returns boolean", () => {
				const result = getSchemaContext(["options", "myField", "deprecated"], true);
				assert.deepStrictEqual(result, { kind: "value", valueType: "boolean" });
			});

			test("['options', 'myField', 'enum-case-insensitive'] with value returns boolean", () => {
				const result = getSchemaContext(["options", "myField", "enum-case-insensitive"], true);
				assert.deepStrictEqual(result, { kind: "value", valueType: "boolean" });
			});

			test("['options', 'myField', 'pattern-exact'] with value returns boolean", () => {
				const result = getSchemaContext(["options", "myField", "pattern-exact"], true);
				assert.deepStrictEqual(result, { kind: "value", valueType: "boolean" });
			});

			test("['options', 'myField', 'description'] with value returns null", () => {
				const result = getSchemaContext(["options", "myField", "description"], true);
				assert.strictEqual(result, null);
			});

			test("['formats', 'html', 'colour', 'type'] with value returns type", () => {
				const result = getSchemaContext(["formats", "html", "colour", "type"], true);
				assert.deepStrictEqual(result, { kind: "value", valueType: "type" });
			});

			test("['$schema'] at depth > 1 returns null", () => {
				const result = getSchemaContext(["options", "$schema"], true);
				assert.strictEqual(result, null);
			});

			test("['shortcodes', 'mysc', 'arguments', 'type'] with value returns type", () => {
				const result = getSchemaContext(["shortcodes", "mysc", "arguments", "type"], true);
				assert.deepStrictEqual(result, { kind: "value", valueType: "type" });
			});
		});
	});

	suite("SchemaContext type narrowing", () => {
		test("null context is falsy", () => {
			const ctx: SchemaContext = null;
			assert.strictEqual(!!ctx, false);
		});

		test("root context has kind 'root'", () => {
			const ctx: SchemaContext = { kind: "root" };
			assert.strictEqual(ctx !== null && ctx.kind, "root");
		});

		test("field-descriptor with allowName defaults to false", () => {
			const result = getSchemaContext(["options", "myField"], false);
			assert.ok(result !== null);
			assert.strictEqual(result.kind, "field-descriptor");
			if (result.kind === "field-descriptor") {
				assert.strictEqual(result.allowName, false);
			}
		});

		test("shortcode arguments set allowName to true", () => {
			const result = getSchemaContext(["shortcodes", "mysc", "arguments"], false);
			assert.ok(result !== null);
			assert.strictEqual(result.kind, "field-descriptor");
			if (result.kind === "field-descriptor") {
				assert.strictEqual(result.allowName, true);
			}
		});
	});
});
