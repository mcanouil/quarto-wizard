import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { formatExtensionId } from "../src/types/extension.js";
import { discoverInstalledExtensionsSync } from "../src/filesystem/discovery.js";

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		readdirSync: (...args: Parameters<typeof actual.readdirSync>) =>
			(actual.readdirSync(...args) as unknown[]).slice().reverse(),
	};
});

describe("discoverInstalledExtensionsSync order", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "discovery-order-test-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	function createExtension(owner: string | null, name: string): void {
		const extPath = path.join(tempDir, "_extensions", ...(owner ? [owner, name] : [name]));
		fs.mkdirSync(extPath, { recursive: true });
		fs.writeFileSync(path.join(extPath, "_extension.yml"), `title: ${name}\n`);
	}

	it("returns extensions in code-point order whatever order the filesystem lists them in", () => {
		createExtension("beta", "same");
		createExtension("alpha", "same");
		createExtension("alpha", "other");
		createExtension("Zulu", "widget");
		createExtension(null, "gamma");

		const ids = discoverInstalledExtensionsSync(tempDir).map((ext) => formatExtensionId(ext.id));

		expect(ids).toEqual(["Zulu/widget", "alpha/other", "alpha/same", "beta/same", "gamma"]);
	});
});
