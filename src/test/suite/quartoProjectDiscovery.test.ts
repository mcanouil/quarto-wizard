import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
	buildExcludeGlob,
	collectExcludePatterns,
	discoverQuartoProjectRoots,
} from "../../utils/quartoProjectDiscovery";
import { makeFolder } from "./projectFixtures";

suite("Quarto Project Discovery Test Suite", () => {
	let tempDir: string;
	let originalGetConfiguration: typeof vscode.workspace.getConfiguration;
	let mockedFilesExclude: Record<string, boolean> | undefined;
	let mockedSearchExclude: Record<string, boolean> | undefined;

	setup(() => {
		// Normalise via Uri.file so Windows drive-letter casing matches what other
		// VS Code APIs return for paths in this directory.
		tempDir = vscode.Uri.file(fs.mkdtempSync(path.join(os.tmpdir(), "quarto-wizard-discovery-"))).fsPath;
		mockedFilesExclude = undefined;
		mockedSearchExclude = undefined;

		originalGetConfiguration = vscode.workspace.getConfiguration;
		vscode.workspace.getConfiguration = ((section?: string, scope?: vscode.ConfigurationScope) => {
			const mockedExclude =
				section === "files" ? mockedFilesExclude : section === "search" ? mockedSearchExclude : undefined;
			if (mockedExclude) {
				return {
					get: <T>(key: string, defaultValue?: T): T =>
						key === "exclude" ? (mockedExclude as T) : (defaultValue as T),
					has: () => true,
					inspect: () => undefined,
					update: async () => {
						/* no-op */
					},
				} as unknown as vscode.WorkspaceConfiguration;
			}
			return originalGetConfiguration(section, scope);
		}) as typeof vscode.workspace.getConfiguration;
	});

	teardown(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
		vscode.workspace.getConfiguration = originalGetConfiguration;
	});

	function writeQuartoYml(dir: string): void {
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, "_quarto.yml"), "project:\n  type: website\n", "utf8");
	}

	function writeExtension(extensionDir: string, name: string): void {
		fs.mkdirSync(extensionDir, { recursive: true });
		fs.writeFileSync(path.join(extensionDir, "_extension.yml"), `title: ${name}\nversion: 1.0.0\n`, "utf8");
	}

	/** Mirrors an extension repository: the extension at the root, and a documentation website in `docs`. */
	function writeAtelierLayout(): void {
		writeExtension(path.join(tempDir, "_extensions", "mcanouil", "atelier"), "atelier");
		const docs = path.join(tempDir, "docs");
		writeQuartoYml(docs);
		writeExtension(path.join(docs, "_extensions", "mcanouil", "atelier"), "atelier");
	}

	test("returns empty array for no workspace folders", async () => {
		const roots = await discoverQuartoProjectRoots([]);
		assert.deepStrictEqual(roots, []);
	});

	test("returns root and docs when both hold extensions", async () => {
		writeAtelierLayout();
		const folder = makeFolder("workspace", tempDir);

		const roots = await discoverQuartoProjectRoots([folder]);

		assert.deepStrictEqual(
			roots.map((root) => ({ fsPath: root.fsPath, label: root.label, relativePath: root.relativePath })),
			[
				{ fsPath: tempDir, label: "workspace", relativePath: "." },
				{ fsPath: path.join(tempDir, "docs"), label: "workspace/docs", relativePath: "docs" },
			],
		);
		for (const root of roots) {
			assert.strictEqual(root.workspaceFolder, folder);
			assert.strictEqual(root.quartoIgnored, false);
			assert.strictEqual(root.kind, "project");
		}
	});

	test("marks .quartoignore matches instead of dropping them", async () => {
		writeAtelierLayout();
		fs.writeFileSync(path.join(tempDir, ".quartoignore"), "# the documentation website\ndocs\n", "utf8");

		const roots = await discoverQuartoProjectRoots([makeFolder("workspace", tempDir)]);

		assert.deepStrictEqual(
			roots.map((root) => ({ relativePath: root.relativePath, quartoIgnored: root.quartoIgnored })),
			[
				{ relativePath: ".", quartoIgnored: false },
				{ relativePath: "docs", quartoIgnored: true },
			],
		);
	});

	test("returns embedded parents with embeddedIn set", async () => {
		const parent = path.join(tempDir, "_extensions", "astek");
		writeExtension(parent, "astek");
		writeExtension(path.join(parent, "_extensions", "mcanouil", "cascade"), "cascade");

		const roots = await discoverQuartoProjectRoots([makeFolder("workspace", tempDir)]);

		assert.deepStrictEqual(
			roots.map((root) => ({ fsPath: root.fsPath, label: root.label, relativePath: root.relativePath })),
			[
				{ fsPath: tempDir, label: "workspace", relativePath: "." },
				{ fsPath: parent, label: "workspace/_extensions/astek", relativePath: "_extensions/astek" },
			],
		);
		assert.strictEqual(roots[0].kind, "project");
		assert.strictEqual(roots[1].kind, "embedded");
		assert.deepStrictEqual(roots[1].kind === "embedded" ? roots[1].embeddedIn : undefined, {
			id: { owner: null, name: "astek" },
			source: undefined,
		});
	});

	test("sets kind and readOnly for each root", async () => {
		writeQuartoYml(path.join(tempDir, "site"));
		const local = path.join(tempDir, "_extensions", "local");
		writeExtension(local, "local");
		writeExtension(path.join(local, "_extensions", "acme", "child"), "child");
		const installed = path.join(tempDir, "_extensions", "acme", "installed");
		fs.mkdirSync(installed, { recursive: true });
		fs.writeFileSync(
			path.join(installed, "_extension.yml"),
			"title: installed\nversion: 1.0.0\nsource: acme/installed@v1.0.0\n",
			"utf8",
		);
		writeExtension(path.join(installed, "_extensions", "acme", "child"), "child");

		const roots = await discoverQuartoProjectRoots([makeFolder("workspace", tempDir)]);

		assert.deepStrictEqual(
			roots.map((root) => [root.relativePath, root.kind, root.readOnly]),
			[
				[".", "project", false],
				["_extensions/acme/installed", "embedded", true],
				["_extensions/local", "embedded", false],
				["site", "project", false],
			],
		);
	});

	test("returns nested projects without the root", async () => {
		writeQuartoYml(path.join(tempDir, "site-b"));
		writeExtension(path.join(tempDir, "site-a", "_extensions", "quarto-ext", "fontawesome"), "fontawesome");

		const roots = await discoverQuartoProjectRoots([makeFolder("workspace", tempDir)]);

		assert.deepStrictEqual(
			roots.map((root) => root.label),
			["workspace/site-a", "workspace/site-b"],
		);
	});

	test("falls back to the workspace folder when nothing is detected", async () => {
		fs.mkdirSync(path.join(tempDir, "lonely", "_extensions"), { recursive: true });

		const roots = await discoverQuartoProjectRoots([makeFolder("workspace", tempDir)]);

		assert.deepStrictEqual(
			roots.map((root) => ({
				fsPath: root.fsPath,
				label: root.label,
				relativePath: root.relativePath,
				quartoIgnored: root.quartoIgnored,
			})),
			[{ fsPath: tempDir, label: "workspace", relativePath: ".", quartoIgnored: false }],
		);
	});

	test("stops scanning when the token is cancelled", async () => {
		writeAtelierLayout();
		const source = new vscode.CancellationTokenSource();
		source.cancel();
		try {
			const roots = await discoverQuartoProjectRoots([makeFolder("workspace", tempDir)], source.token);

			assert.deepStrictEqual(roots, []);
		} finally {
			source.dispose();
		}
	});

	test("skips folders that the exclude settings of the editor hide", async () => {
		writeQuartoYml(path.join(tempDir, "site-a"));
		writeQuartoYml(path.join(tempDir, "build", "site-b"));
		mockedFilesExclude = { "**/build": true };

		const roots = await discoverQuartoProjectRoots([makeFolder("workspace", tempDir)]);

		assert.deepStrictEqual(
			roots.map((root) => root.relativePath),
			["site-a"],
		);
	});

	test("collects the enabled exclude patterns of both settings", () => {
		mockedFilesExclude = { "**/.git": true, "**/.hg": false };
		mockedSearchExclude = { "**/node_modules": true, "**/.git": true };

		const patterns = collectExcludePatterns(vscode.Uri.file(tempDir));

		assert.deepStrictEqual(patterns, ["**/.git", "**/node_modules"]);
	});

	test("drops an exclude pattern that holds a comma, which would split the brace group", () => {
		mockedFilesExclude = { "**/data, raw": true, "**/.git": true };
		mockedSearchExclude = { "**/{node_modules,dist}": true };

		const exclude = buildExcludeGlob(vscode.Uri.file(tempDir));

		// `**/data` alone would hide every `data` directory, and the projects under it.
		assert.strictEqual(exclude, "{**/.git,**/{node_modules,dist}}");
	});
});
