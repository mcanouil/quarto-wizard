import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
	normaliseFieldDescriptor,
	normaliseFieldDescriptorMap,
	normaliseShortcodeSchema,
	normaliseSchema,
} from "../../src/types/schema.js";
import {
	findSchemaFile,
	parseSchemaContent,
	parseSchemaFile,
	readSchema,
} from "../../src/filesystem/schema.js";
import { SchemaCache } from "../../src/filesystem/schema-cache.js";
import { SchemaError } from "../../src/errors.js";

describe("normaliseFieldDescriptor", () => {
	it("passes through camelCase keys unchanged", () => {
		const result = normaliseFieldDescriptor({
			type: "string",
			required: true,
			description: "A test field",
		});

		expect(result.type).toBe("string");
		expect(result.required).toBe(true);
		expect(result.description).toBe("A test field");
	});

	it("converts kebab-case keys to camelCase", () => {
		const result = normaliseFieldDescriptor({
			"enum-case-insensitive": true,
			"pattern-exact": true,
			"min-length": 3,
			"max-length": 50,
		});

		expect(result.enumCaseInsensitive).toBe(true);
		expect(result.patternExact).toBe(true);
		expect(result.minLength).toBe(3);
		expect(result.maxLength).toBe(50);
	});

	it("normalises nested items descriptor", () => {
		const result = normaliseFieldDescriptor({
			type: "array",
			items: {
				type: "string",
				"min-length": 1,
			},
		});

		expect(result.items).toBeDefined();
		expect(result.items!.type).toBe("string");
		expect(result.items!.minLength).toBe(1);
	});

	it("normalises nested properties descriptors", () => {
		const result = normaliseFieldDescriptor({
			type: "object",
			properties: {
				name: { type: "string", "max-length": 100 },
				count: { type: "number", min: 0 },
			},
		});

		expect(result.properties).toBeDefined();
		expect(result.properties!["name"].type).toBe("string");
		expect(result.properties!["name"].maxLength).toBe(100);
		expect(result.properties!["count"].type).toBe("number");
		expect(result.properties!["count"].min).toBe(0);
	});

	it("handles enum and default values", () => {
		const result = normaliseFieldDescriptor({
			type: "string",
			enum: ["left", "right", "center"],
			default: "left",
		});

		expect(result.enum).toEqual(["left", "right", "center"]);
		expect(result.default).toBe("left");
	});

	it("handles aliases and deprecated fields", () => {
		const result = normaliseFieldDescriptor({
			type: "string",
			aliases: ["old-name"],
			deprecated: "Use new-field instead",
		});

		expect(result.aliases).toEqual(["old-name"]);
		expect(result.deprecated).toBe("Use new-field instead");
	});

	it("handles completion spec", () => {
		const result = normaliseFieldDescriptor({
			type: "string",
			completion: {
				type: "file",
				extensions: [".lua"],
			},
		});

		expect(result.completion).toBeDefined();
		expect(result.completion!.type).toBe("file");
		expect(result.completion!.extensions).toEqual([".lua"]);
	});
});

describe("normaliseFieldDescriptorMap", () => {
	it("normalises a map of field descriptors", () => {
		const result = normaliseFieldDescriptorMap({
			theme: { type: "string", "enum-case-insensitive": true },
			count: { type: "number", min: 1, max: 100 },
		});

		expect(result["theme"].type).toBe("string");
		expect(result["theme"].enumCaseInsensitive).toBe(true);
		expect(result["count"].min).toBe(1);
		expect(result["count"].max).toBe(100);
	});

	it("skips non-object entries", () => {
		const result = normaliseFieldDescriptorMap({
			valid: { type: "string" },
			invalid: "not an object" as unknown as Record<string, unknown>,
		});

		expect(result["valid"]).toBeDefined();
		expect(result["invalid"]).toBeUndefined();
	});
});

describe("normaliseShortcodeSchema", () => {
	it("normalises a shortcode with arguments and attributes", () => {
		const result = normaliseShortcodeSchema({
			description: "A test shortcode",
			arguments: [
				{ name: "src", type: "string", required: true },
				{ name: "alt", type: "string" },
			],
			attributes: {
				width: { type: "number", min: 0 },
				caption: { type: "string", "max-length": 200 },
			},
		});

		expect(result.description).toBe("A test shortcode");
		expect(result.arguments).toHaveLength(2);
		expect(result.arguments![0].name).toBe("src");
		expect(result.arguments![0].required).toBe(true);
		expect(result.attributes!["width"].min).toBe(0);
		expect(result.attributes!["caption"].maxLength).toBe(200);
	});

	it("handles missing optional fields", () => {
		const result = normaliseShortcodeSchema({});

		expect(result.description).toBeUndefined();
		expect(result.arguments).toBeUndefined();
		expect(result.attributes).toBeUndefined();
	});
});

describe("normaliseSchema", () => {
	it("normalises all five sections", () => {
		const result = normaliseSchema({
			options: {
				theme: { type: "string" },
			},
			shortcodes: {
				img: { description: "Image shortcode" },
			},
			formats: {
				html: {
					toc: { type: "boolean", default: true },
				},
			},
			projects: {
				output: { type: "string" },
			},
			"element-attributes": {
				width: { type: "number" },
			},
		});

		expect(result.options).toBeDefined();
		expect(result.options!["theme"].type).toBe("string");
		expect(result.shortcodes).toBeDefined();
		expect(result.shortcodes!["img"].description).toBe("Image shortcode");
		expect(result.formats).toBeDefined();
		expect(result.formats!["html"]["toc"].type).toBe("boolean");
		expect(result.projects).toBeDefined();
		expect(result.projects!["output"].type).toBe("string");
		expect(result.elementAttributes).toBeDefined();
		expect(result.elementAttributes!["width"].type).toBe("number");
	});

	it("returns empty object for empty schema", () => {
		const result = normaliseSchema({});

		expect(result.options).toBeUndefined();
		expect(result.shortcodes).toBeUndefined();
		expect(result.formats).toBeUndefined();
		expect(result.projects).toBeUndefined();
		expect(result.elementAttributes).toBeUndefined();
	});
});

describe("parseSchemaContent", () => {
	it("parses valid YAML with options", () => {
		const yamlContent = `
options:
  theme:
    type: string
    enum:
      - light
      - dark
    default: light
`;

		const schema = parseSchemaContent(yamlContent);

		expect(schema.options).toBeDefined();
		expect(schema.options!["theme"].type).toBe("string");
		expect(schema.options!["theme"].enum).toEqual(["light", "dark"]);
		expect(schema.options!["theme"].default).toBe("light");
	});

	it("parses valid YAML with shortcodes", () => {
		const yamlContent = `
shortcodes:
  placeholder:
    description: Generates placeholder images
    arguments:
      - name: width
        type: number
        required: true
    attributes:
      format:
        type: string
        enum:
          - png
          - jpg
`;

		const schema = parseSchemaContent(yamlContent);

		expect(schema.shortcodes).toBeDefined();
		expect(schema.shortcodes!["placeholder"].description).toBe("Generates placeholder images");
		expect(schema.shortcodes!["placeholder"].arguments).toHaveLength(1);
		expect(schema.shortcodes!["placeholder"].arguments![0].name).toBe("width");
		expect(schema.shortcodes!["placeholder"].attributes!["format"].enum).toEqual(["png", "jpg"]);
	});

	it("parses kebab-case keys and normalises to camelCase", () => {
		const yamlContent = `
options:
  name:
    type: string
    min-length: 1
    max-length: 100
    enum-case-insensitive: true
    pattern-exact: false
`;

		const schema = parseSchemaContent(yamlContent);

		expect(schema.options!["name"].minLength).toBe(1);
		expect(schema.options!["name"].maxLength).toBe(100);
		expect(schema.options!["name"].enumCaseInsensitive).toBe(true);
		expect(schema.options!["name"].patternExact).toBe(false);
	});

	it("parses element-attributes section", () => {
		const yamlContent = `
element-attributes:
  width:
    type: number
    min: 0
  height:
    type: number
    min: 0
`;

		const schema = parseSchemaContent(yamlContent);

		expect(schema.elementAttributes).toBeDefined();
		expect(schema.elementAttributes!["width"].type).toBe("number");
		expect(schema.elementAttributes!["height"].min).toBe(0);
	});

	it("parses formats section with nested format options", () => {
		const yamlContent = `
formats:
  html:
    toc:
      type: boolean
      default: true
  pdf:
    margin:
      type: string
      default: 1in
`;

		const schema = parseSchemaContent(yamlContent);

		expect(schema.formats).toBeDefined();
		expect(schema.formats!["html"]["toc"].type).toBe("boolean");
		expect(schema.formats!["pdf"]["margin"].default).toBe("1in");
	});

	it("throws SchemaError on empty content", () => {
		expect(() => parseSchemaContent("")).toThrow(SchemaError);
	});

	it("throws SchemaError on invalid YAML", () => {
		expect(() => parseSchemaContent("title: [invalid")).toThrow(SchemaError);
	});

	it("includes source path in error for empty content", () => {
		expect(() => parseSchemaContent("", "/path/to/schema.yml")).toThrow(/schema/i);
	});

	it("handles minimal schema with only one section", () => {
		const yamlContent = `
options:
  enabled:
    type: boolean
    default: true
`;

		const schema = parseSchemaContent(yamlContent);

		expect(schema.options).toBeDefined();
		expect(schema.shortcodes).toBeUndefined();
		expect(schema.formats).toBeUndefined();
		expect(schema.projects).toBeUndefined();
		expect(schema.elementAttributes).toBeUndefined();
	});

	it("parses nested field descriptors with items and properties", () => {
		const yamlContent = `
options:
  tags:
    type: array
    items:
      type: string
      min-length: 1
  config:
    type: object
    properties:
      name:
        type: string
        required: true
      nested:
        type: object
        properties:
          level:
            type: number
`;

		const schema = parseSchemaContent(yamlContent);

		expect(schema.options!["tags"].items).toBeDefined();
		expect(schema.options!["tags"].items!.type).toBe("string");
		expect(schema.options!["tags"].items!.minLength).toBe(1);
		expect(schema.options!["config"].properties).toBeDefined();
		expect(schema.options!["config"].properties!["name"].required).toBe(true);
		expect(schema.options!["config"].properties!["nested"].properties!["level"].type).toBe("number");
	});
});

describe("filesystem schema functions", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-test-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	describe("findSchemaFile", () => {
		it("finds _schema.yml", () => {
			const schemaPath = path.join(tempDir, "_schema.yml");
			fs.writeFileSync(schemaPath, "options:\n  test:\n    type: string\n");

			const result = findSchemaFile(tempDir);

			expect(result).toBe(schemaPath);
		});

		it("finds _schema.yaml", () => {
			const schemaPath = path.join(tempDir, "_schema.yaml");
			fs.writeFileSync(schemaPath, "options:\n  test:\n    type: string\n");

			const result = findSchemaFile(tempDir);

			expect(result).toBe(schemaPath);
		});

		it("prefers .yml over .yaml", () => {
			fs.writeFileSync(path.join(tempDir, "_schema.yml"), "options:\n  a:\n    type: string\n");
			fs.writeFileSync(path.join(tempDir, "_schema.yaml"), "options:\n  b:\n    type: string\n");

			const result = findSchemaFile(tempDir);

			expect(result).toBe(path.join(tempDir, "_schema.yml"));
		});

		it("returns null when no schema exists", () => {
			const result = findSchemaFile(tempDir);

			expect(result).toBeNull();
		});
	});

	describe("parseSchemaFile", () => {
		it("parses a schema file", () => {
			const schemaPath = path.join(tempDir, "_schema.yml");
			fs.writeFileSync(
				schemaPath,
				"options:\n  enabled:\n    type: boolean\n    default: true\n",
			);

			const schema = parseSchemaFile(schemaPath);

			expect(schema.options).toBeDefined();
			expect(schema.options!["enabled"].type).toBe("boolean");
			expect(schema.options!["enabled"].default).toBe(true);
		});

		it("throws SchemaError for non-existent file", () => {
			const schemaPath = path.join(tempDir, "nonexistent.yml");

			expect(() => parseSchemaFile(schemaPath)).toThrow(SchemaError);
		});

		it("re-throws SchemaError from parsing", () => {
			const schemaPath = path.join(tempDir, "_schema.yml");
			fs.writeFileSync(schemaPath, "");

			expect(() => parseSchemaFile(schemaPath)).toThrow(SchemaError);
		});
	});

	describe("readSchema", () => {
		it("reads schema from directory", () => {
			fs.writeFileSync(
				path.join(tempDir, "_schema.yml"),
				"options:\n  theme:\n    type: string\n",
			);

			const result = readSchema(tempDir);

			expect(result).not.toBeNull();
			expect(result!.schema.options!["theme"].type).toBe("string");
			expect(result!.filename).toBe("_schema.yml");
		});

		it("returns null when no schema in directory", () => {
			const result = readSchema(tempDir);

			expect(result).toBeNull();
		});
	});
});

describe("SchemaError", () => {
	it("has the correct error code", () => {
		const error = new SchemaError("test error");

		expect(error.code).toBe("SCHEMA_ERROR");
		expect(error.name).toBe("SchemaError");
	});

	it("includes schema path", () => {
		const error = new SchemaError("test error", { schemaPath: "/path/to/schema.yml" });

		expect(error.schemaPath).toBe("/path/to/schema.yml");
		expect(error.suggestion).toContain("/path/to/schema.yml");
	});

	it("preserves the cause chain", () => {
		const cause = new Error("original error");
		const error = new SchemaError("wrapped", { cause });

		expect(error.cause).toBe(cause);
	});
});

describe("SchemaCache", () => {
	let tempDir: string;
	let cache: SchemaCache;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-cache-test-"));
		cache = new SchemaCache();
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("returns null for directory without schema", () => {
		const result = cache.get(tempDir);

		expect(result).toBeNull();
	});

	it("loads and caches schema on first access", () => {
		fs.writeFileSync(
			path.join(tempDir, "_schema.yml"),
			"options:\n  theme:\n    type: string\n",
		);

		const result = cache.get(tempDir);

		expect(result).not.toBeNull();
		expect(result!.options!["theme"].type).toBe("string");
		expect(cache.has(tempDir)).toBe(true);
	});

	it("returns cached schema on subsequent access", () => {
		fs.writeFileSync(
			path.join(tempDir, "_schema.yml"),
			"options:\n  theme:\n    type: string\n",
		);

		const first = cache.get(tempDir);
		const second = cache.get(tempDir);

		expect(first).toBe(second);
	});

	it("invalidates a specific entry", () => {
		fs.writeFileSync(
			path.join(tempDir, "_schema.yml"),
			"options:\n  theme:\n    type: string\n",
		);

		cache.get(tempDir);
		expect(cache.has(tempDir)).toBe(true);

		cache.invalidate(tempDir);
		expect(cache.has(tempDir)).toBe(false);
	});

	it("invalidates all entries", () => {
		const tempDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "schema-cache-test2-"));
		fs.writeFileSync(
			path.join(tempDir, "_schema.yml"),
			"options:\n  a:\n    type: string\n",
		);
		fs.writeFileSync(
			path.join(tempDir2, "_schema.yml"),
			"options:\n  b:\n    type: string\n",
		);

		cache.get(tempDir);
		cache.get(tempDir2);
		expect(cache.has(tempDir)).toBe(true);
		expect(cache.has(tempDir2)).toBe(true);

		cache.invalidateAll();
		expect(cache.has(tempDir)).toBe(false);
		expect(cache.has(tempDir2)).toBe(false);

		fs.rmSync(tempDir2, { recursive: true, force: true });
	});

	it("reloads schema after invalidation", () => {
		fs.writeFileSync(
			path.join(tempDir, "_schema.yml"),
			"options:\n  theme:\n    type: string\n",
		);

		const first = cache.get(tempDir);
		cache.invalidate(tempDir);

		fs.writeFileSync(
			path.join(tempDir, "_schema.yml"),
			"options:\n  colour:\n    type: string\n",
		);

		const second = cache.get(tempDir);

		expect(first!.options!["theme"]).toBeDefined();
		expect(second!.options!["colour"]).toBeDefined();
		expect(second!.options!["theme"]).toBeUndefined();
	});

	it("reports has as false before first access", () => {
		fs.writeFileSync(
			path.join(tempDir, "_schema.yml"),
			"options:\n  test:\n    type: string\n",
		);

		expect(cache.has(tempDir)).toBe(false);

		cache.get(tempDir);
		expect(cache.has(tempDir)).toBe(true);
	});
});
