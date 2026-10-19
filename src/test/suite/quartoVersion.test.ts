import * as assert from "assert";
import * as vscode from "vscode";
import { getQuartoVersionInfo } from "../../services/quartoVersion";
import { Stubs } from "./stubs";

const UNAVAILABLE = { available: false, version: undefined, path: undefined };

suite("Quarto Version Service Test Suite", () => {
	const stubs = new Stubs();
	let requested: string[];

	function quartoExtension(activate: () => Promise<unknown>): void {
		requested = [];
		stubs.replace(vscode.extensions, "getExtension", (id: string) => {
			requested.push(id);
			return id === "quarto.quarto" ? { activate } : undefined;
		});
	}

	teardown(() => stubs.restore());

	test("Should report Quarto unavailable when the Quarto extension is not installed", async () => {
		stubs.replace(vscode.extensions, "getExtension", () => undefined);
		assert.deepStrictEqual(await getQuartoVersionInfo(), UNAVAILABLE);
	});

	test("Should read availability, version and path from the Quarto extension API", async () => {
		quartoExtension(async () => ({
			isQuartoAvailable: () => true,
			getQuartoVersion: () => "1.9.2",
			getQuartoPath: () => "/opt/quarto/bin",
		}));
		assert.deepStrictEqual(await getQuartoVersionInfo(), {
			available: true,
			version: "1.9.2",
			path: "/opt/quarto/bin",
		});
		assert.deepStrictEqual(requested, ["quarto.quarto"]);
	});

	test("Should pass on an API that finds no Quarto", async () => {
		quartoExtension(async () => ({
			isQuartoAvailable: () => false,
			getQuartoVersion: () => undefined,
			getQuartoPath: () => undefined,
		}));
		assert.deepStrictEqual(await getQuartoVersionInfo(), UNAVAILABLE);
	});

	test("Should leave out the version and path an older API does not expose", async () => {
		quartoExtension(async () => ({ isQuartoAvailable: () => true }));
		assert.deepStrictEqual(await getQuartoVersionInfo(), { available: true, version: undefined, path: undefined });
	});

	test("Should report Quarto unavailable when the API lacks isQuartoAvailable", async () => {
		quartoExtension(async () => ({ getQuartoVersion: () => "1.9.2" }));
		assert.deepStrictEqual(await getQuartoVersionInfo(), UNAVAILABLE);
	});

	test("Should report Quarto unavailable when the extension exports no API", async () => {
		quartoExtension(async () => undefined);
		assert.deepStrictEqual(await getQuartoVersionInfo(), UNAVAILABLE);
	});

	test("Should report Quarto unavailable, and not throw, when activation fails", async () => {
		quartoExtension(async () => {
			throw new Error("activation failed");
		});
		assert.deepStrictEqual(await getQuartoVersionInfo(), UNAVAILABLE);
	});

	test("Should report Quarto unavailable, and not throw, when the API throws", async () => {
		quartoExtension(async () => ({
			isQuartoAvailable: () => {
				throw new Error("no cli");
			},
		}));
		assert.deepStrictEqual(await getQuartoVersionInfo(), UNAVAILABLE);
	});
});
