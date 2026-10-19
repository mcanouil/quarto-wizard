import * as assert from "assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SchemaCache } from "@quarto-wizard/schema";
import { invalidateInstalledExtensionsCache } from "../../utils/installedExtensionsCache";
import { getWorkspaceSchemaIndex, invalidateWorkspaceSchemaIndex } from "../../utils/workspaceSchemaIndex";

const WORKSPACE = path.resolve(__dirname, "..", "..", "..", "test-fixtures");

function schemaWithOption(name: string): string {
	return `options:\n  ${name}:\n    type: string\n`;
}

suite("Workspace Schema Index", () => {
	let temporary: string | undefined;

	teardown(() => {
		invalidateInstalledExtensionsCache();
		invalidateWorkspaceSchemaIndex();
		if (temporary) {
			fs.rmSync(temporary, { recursive: true, force: true });
			temporary = undefined;
		}
	});

	function installExtension(root: string, owner: string, name: string, schema?: string): string {
		const directory = path.join(root, "_extensions", owner, name);
		fs.mkdirSync(directory, { recursive: true });
		fs.writeFileSync(path.join(directory, "_extension.yml"), `title: ${name}\nversion: 1.0.0\n`);
		if (schema !== undefined) {
			fs.writeFileSync(path.join(directory, "_schema.yml"), schema);
		}
		return directory;
	}

	test("Indexes the extensions of the fixture workspace that have a schema", async () => {
		const { schemaMap, extMap } = await getWorkspaceSchemaIndex(WORKSPACE, new SchemaCache());
		assert.deepStrictEqual([...schemaMap.keys()].sort(), ["github", "mcanouil/github"]);
		assert.deepStrictEqual([...extMap.keys()].sort(), ["github", "mcanouil/github"]);
		assert.ok(schemaMap.get("github")?.options?.["repository-name"]);
		assert.strictEqual(extMap.get("github")?.manifest.title, "GitHub");
	});

	test("Leaves out an extension without a schema", async () => {
		const { schemaMap, extMap } = await getWorkspaceSchemaIndex(WORKSPACE, new SchemaCache());
		assert.ok(!schemaMap.has("attribution"));
		assert.ok(!extMap.has("attribution"));
	});

	test("Returns an empty index for a directory without extensions", async () => {
		temporary = fs.mkdtempSync(path.join(os.tmpdir(), "qw-index-"));
		const { schemaMap, extMap } = await getWorkspaceSchemaIndex(temporary, new SchemaCache());
		assert.strictEqual(schemaMap.size, 0);
		assert.strictEqual(extMap.size, 0);
	});

	test("Gives a short name that two owners share to the first one found", async () => {
		temporary = fs.mkdtempSync(path.join(os.tmpdir(), "qw-index-"));
		installExtension(temporary, "alpha", "same", schemaWithOption("first"));
		installExtension(temporary, "beta", "same", schemaWithOption("second"));
		const { schemaMap } = await getWorkspaceSchemaIndex(temporary, new SchemaCache());
		assert.deepStrictEqual([...schemaMap.keys()].sort(), ["alpha/same", "beta/same", "same"]);
		assert.ok(schemaMap.get("alpha/same")?.options?.["first"]);
		assert.ok(schemaMap.get("beta/same")?.options?.["second"]);
		assert.strictEqual(schemaMap.get("same"), schemaMap.get("alpha/same"));
	});

	test("Reflects a changed schema once the index is invalidated", async () => {
		temporary = fs.mkdtempSync(path.join(os.tmpdir(), "qw-index-"));
		const schemaCache = new SchemaCache();
		const directory = installExtension(temporary, "acme", "widget", schemaWithOption("before"));

		const first = await getWorkspaceSchemaIndex(temporary, schemaCache);
		assert.ok(first.schemaMap.get("widget")?.options?.["before"]);

		fs.writeFileSync(path.join(directory, "_schema.yml"), schemaWithOption("after"));
		schemaCache.invalidate(directory);

		invalidateWorkspaceSchemaIndex(temporary);
		const second = await getWorkspaceSchemaIndex(temporary, schemaCache);
		assert.notStrictEqual(second, first);
		assert.ok(second.schemaMap.get("widget")?.options?.["after"]);
		assert.ok(!second.schemaMap.get("widget")?.options?.["before"]);
	});

	test("Picks up an extension installed after the first build once both caches are invalidated", async () => {
		temporary = fs.mkdtempSync(path.join(os.tmpdir(), "qw-index-"));
		const schemaCache = new SchemaCache();
		installExtension(temporary, "acme", "one", schemaWithOption("a"));
		const first = await getWorkspaceSchemaIndex(temporary, schemaCache);
		assert.deepStrictEqual([...first.schemaMap.keys()].sort(), ["acme/one", "one"]);

		installExtension(temporary, "acme", "two", schemaWithOption("b"));
		invalidateInstalledExtensionsCache(temporary);
		invalidateWorkspaceSchemaIndex(temporary);
		const second = await getWorkspaceSchemaIndex(temporary, schemaCache);
		assert.deepStrictEqual([...second.schemaMap.keys()].sort(), ["acme/one", "acme/two", "one", "two"]);
	});

	test("Keeps a separate index for each schema cache", async () => {
		const one = await getWorkspaceSchemaIndex(WORKSPACE, new SchemaCache());
		const other = await getWorkspaceSchemaIndex(WORKSPACE, new SchemaCache());
		assert.notStrictEqual(one, other);
	});
});
