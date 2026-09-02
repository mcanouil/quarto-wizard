import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { EXTENSIONS_DIR, MANIFEST_FILENAMES } from "@quarto-wizard/core";
import {
	discoverQuartoProjectRoots,
	EXTENSION_MANIFEST_DIRECT_GLOB,
	EXTENSION_MANIFEST_GLOB,
	QUARTO_PROJECT_DIRECT_GLOB,
	QUARTO_PROJECT_FILENAMES,
	QUARTO_PROJECT_GLOB,
} from "../../utils/quartoProjectDiscovery";
import type { AutoProjectDetection } from "../../utils/extensionDetails";
import { makeFolder } from "./projectFixtures";

interface MockedConfig {
	autoProjectDetection?: AutoProjectDetection;
}

const MANIFEST_FILENAME_SET = new Set<string>(MANIFEST_FILENAMES);

const RECURSIVE_GLOB_MATCHERS: Record<string, ReadonlySet<string>> = {
	[QUARTO_PROJECT_GLOB]: new Set<string>(QUARTO_PROJECT_FILENAMES),
	[EXTENSION_MANIFEST_GLOB]: new Set<string>(MANIFEST_FILENAMES),
};

suite("Quarto Project Discovery Test Suite", () => {
	let tempDir: string;
	let originalFindFiles: typeof vscode.workspace.findFiles;
	let originalTextDocumentsDescriptor: PropertyDescriptor | undefined;
	let originalGetConfiguration: typeof vscode.workspace.getConfiguration;

	let mockedTextDocuments: readonly vscode.TextDocument[];
	let mockedConfig: MockedConfig;
	let mockedFilesExclude: Record<string, boolean> | undefined;
	let mockedSearchExclude: Record<string, boolean> | undefined;

	setup(() => {
		// Normalise via Uri.file so Windows drive-letter casing matches what `findFiles`
		// and other VSCode APIs return for paths in this directory.
		tempDir = vscode.Uri.file(fs.mkdtempSync(path.join(os.tmpdir(), "quarto-wizard-discovery-"))).fsPath;

		mockedTextDocuments = [];
		mockedConfig = { autoProjectDetection: "subFolders" };
		mockedFilesExclude = undefined;
		mockedSearchExclude = undefined;

		originalFindFiles = vscode.workspace.findFiles;
		// Default: scan the temp tree on disk and dispatch by glob to mirror the real findFiles.
		vscode.workspace.findFiles = ((include: vscode.GlobPattern) => {
			if (typeof include === "object" && "baseUri" in include) {
				const rel = include as vscode.RelativePattern;
				const recursive = RECURSIVE_GLOB_MATCHERS[rel.pattern];
				if (recursive) {
					return Promise.resolve(scanForFiles(rel.baseUri.fsPath, recursive));
				}
				if (rel.pattern === QUARTO_PROJECT_DIRECT_GLOB) {
					return Promise.resolve(scanDirectChildren(rel.baseUri.fsPath, QUARTO_PROJECT_FILENAMES));
				}
				if (rel.pattern === EXTENSION_MANIFEST_DIRECT_GLOB) {
					return Promise.resolve(scanDirectExtensions(rel.baseUri.fsPath));
				}
			}
			return Promise.resolve([]);
		}) as typeof vscode.workspace.findFiles;

		originalTextDocumentsDescriptor = Object.getOwnPropertyDescriptor(vscode.workspace, "textDocuments");
		Object.defineProperty(vscode.workspace, "textDocuments", {
			get: () => mockedTextDocuments,
			configurable: true,
		});

		originalGetConfiguration = vscode.workspace.getConfiguration;
		vscode.workspace.getConfiguration = ((section?: string) => {
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
			if (section === "quartoWizard") {
				return {
					get: <T>(key: string, defaultValue?: T): T => {
						if (key === "autoProjectDetection") {
							const value = mockedConfig.autoProjectDetection;
							return (value !== undefined ? value : defaultValue) as T;
						}
						return defaultValue as T;
					},
					has: () => true,
					inspect: () => undefined,
					update: async () => {
						/* no-op */
					},
				} as unknown as vscode.WorkspaceConfiguration;
			}
			return originalGetConfiguration(section);
		}) as typeof vscode.workspace.getConfiguration;
	});

	teardown(() => {
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
		vscode.workspace.findFiles = originalFindFiles;
		vscode.workspace.getConfiguration = originalGetConfiguration;
		if (originalTextDocumentsDescriptor) {
			Object.defineProperty(vscode.workspace, "textDocuments", originalTextDocumentsDescriptor);
		}
	});

	function writeQuartoYml(dir: string): string {
		fs.mkdirSync(dir, { recursive: true });
		const file = path.join(dir, "_quarto.yml");
		fs.writeFileSync(file, "project:\n  type: website\n", "utf8");
		return file;
	}

	function writeQuartoIgnore(dir: string, content: string): string {
		fs.mkdirSync(dir, { recursive: true });
		const file = path.join(dir, ".quartoignore");
		fs.writeFileSync(file, content, "utf8");
		return file;
	}

	function writeExtensionManifest(projectDir: string, owner: string, name: string): string {
		const dir = path.join(projectDir, "_extensions", owner, name);
		fs.mkdirSync(dir, { recursive: true });
		const file = path.join(dir, "_extension.yml");
		fs.writeFileSync(file, `title: ${name}\nauthor: ${owner}\nversion: 1.0.0\n`, "utf8");
		return file;
	}

	function scanForFiles(base: string, matcher: ReadonlySet<string>): vscode.Uri[] {
		const matches: vscode.Uri[] = [];
		const walk = (current: string) => {
			let entries: fs.Dirent[];
			try {
				entries = fs.readdirSync(current, { withFileTypes: true });
			} catch {
				return;
			}
			for (const entry of entries) {
				const fullPath = path.join(current, entry.name);
				if (entry.isDirectory()) {
					walk(fullPath);
				} else if (entry.isFile() && matcher.has(entry.name)) {
					matches.push(vscode.Uri.file(fullPath));
				}
			}
		};
		walk(base);
		return matches;
	}

	function forEachDirectChildDir(base: string, visit: (subdir: string) => void): void {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(base, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.isDirectory()) visit(path.join(base, entry.name));
		}
	}

	function scanDirectChildren(base: string, filenames: readonly string[]): vscode.Uri[] {
		const matches: vscode.Uri[] = [];
		forEachDirectChildDir(base, (subdir) => {
			for (const filename of filenames) {
				const candidate = path.join(subdir, filename);
				try {
					if (fs.statSync(candidate).isFile()) {
						matches.push(vscode.Uri.file(candidate));
					}
				} catch {
					// candidate file doesn't exist; skip
				}
			}
		});
		return matches;
	}

	function scanDirectExtensions(base: string): vscode.Uri[] {
		const matches: vscode.Uri[] = [];
		forEachDirectChildDir(base, (subdir) => {
			const extDir = path.join(subdir, EXTENSIONS_DIR);
			try {
				if (!fs.statSync(extDir).isDirectory()) return;
			} catch {
				return;
			}
			matches.push(...scanForFiles(extDir, MANIFEST_FILENAME_SET));
		});
		return matches;
	}

	function makeDocument(filePath: string): vscode.TextDocument {
		return {
			uri: vscode.Uri.file(filePath),
			isUntitled: false,
		} as unknown as vscode.TextDocument;
	}

	test("returns empty array for no workspace folders", async () => {
		const roots = await discoverQuartoProjectRoots([]);
		assert.deepStrictEqual(roots, []);
	});

	test("smart-merges: workspace root with _quarto.yml hides nested ones", async () => {
		writeQuartoYml(tempDir);
		writeQuartoYml(path.join(tempDir, "child"));

		const roots = await discoverQuartoProjectRoots([makeFolder("workspace", tempDir)]);

		assert.strictEqual(roots.length, 1);
		assert.strictEqual(roots[0].fsPath, tempDir);
		assert.strictEqual(roots[0].label, "workspace");
	});

	test("smart-merges: workspace root _quarto.yml subsumes sibling _extensions/-only sub-roots", async () => {
		// Workspace IS a Quarto project; a sibling using `_extensions/` is part of that
		// project and must not appear as its own root.
		writeQuartoYml(tempDir);
		writeExtensionManifest(path.join(tempDir, "scratch"), "quarto-ext", "fontawesome");

		const roots = await discoverQuartoProjectRoots([makeFolder("workspace", tempDir)]);

		assert.strictEqual(roots.length, 1);
		assert.strictEqual(roots[0].fsPath, tempDir);
	});

	test("returns all detected sub-roots when workspace root has no _quarto.yml", async () => {
		writeQuartoYml(path.join(tempDir, "site-a"));
		writeQuartoYml(path.join(tempDir, "site-b"));

		const roots = await discoverQuartoProjectRoots([makeFolder("workspace", tempDir)]);

		assert.strictEqual(roots.length, 2);
		const labels = roots.map((r) => r.label).sort();
		assert.deepStrictEqual(labels, ["workspace/site-a", "workspace/site-b"]);
		for (const root of roots) {
			assert.strictEqual(root.workspaceFolder.name, "workspace");
		}
	});

	test("falls back to workspace folder when nothing is detected", async () => {
		const roots = await discoverQuartoProjectRoots([makeFolder("workspace", tempDir)]);

		assert.strictEqual(roots.length, 1);
		assert.strictEqual(roots[0].fsPath, tempDir);
		assert.strictEqual(roots[0].label, "workspace");
	});

	test("setting=false: returns workspace folder only and does not scan", async () => {
		writeQuartoYml(path.join(tempDir, "site-a"));
		mockedConfig.autoProjectDetection = false;
		let findFilesCalled = false;
		vscode.workspace.findFiles = (() => {
			findFilesCalled = true;
			return Promise.resolve([]);
		}) as typeof vscode.workspace.findFiles;

		const roots = await discoverQuartoProjectRoots([makeFolder("workspace", tempDir)]);

		assert.strictEqual(findFilesCalled, false);
		assert.strictEqual(roots.length, 1);
		assert.strictEqual(roots[0].fsPath, tempDir);
	});

	test("setting=openEditors: detects project root from an open document", async () => {
		const projectDir = path.join(tempDir, "nested", "site");
		writeQuartoYml(projectDir);
		const docPath = path.join(projectDir, "post", "index.qmd");
		fs.mkdirSync(path.dirname(docPath), { recursive: true });
		fs.writeFileSync(docPath, "", "utf8");

		mockedConfig.autoProjectDetection = "openEditors";
		mockedTextDocuments = [makeDocument(docPath)];

		const roots = await discoverQuartoProjectRoots([makeFolder("workspace", tempDir)]);

		assert.strictEqual(roots.length, 1);
		assert.strictEqual(roots[0].fsPath, projectDir);
		assert.strictEqual(roots[0].label, "workspace/nested/site");
	});

	test("setting=subFolders: ignores open editors and only scans direct subfolders", async () => {
		const editorOnlyProject = path.join(tempDir, "editor-only");
		writeQuartoYml(editorOnlyProject);
		const docPath = path.join(editorOnlyProject, "doc.qmd");
		fs.writeFileSync(docPath, "", "utf8");

		mockedConfig.autoProjectDetection = "subFolders";
		mockedTextDocuments = [makeDocument(docPath)];

		const roots = await discoverQuartoProjectRoots([makeFolder("workspace", tempDir)]);

		// editor-only is found because it is a direct subfolder; the open editor is ignored.
		assert.strictEqual(roots.length, 1);
		assert.strictEqual(roots[0].fsPath, editorOnlyProject);
	});

	test("setting=subFolders: skips deeply-nested projects (direct children only)", async () => {
		const direct = path.join(tempDir, "site-a");
		const deep = path.join(tempDir, "deep", "nested");
		writeQuartoYml(direct);
		writeQuartoYml(deep);

		mockedConfig.autoProjectDetection = "subFolders";

		const roots = await discoverQuartoProjectRoots([makeFolder("workspace", tempDir)]);

		assert.strictEqual(roots.length, 1);
		assert.strictEqual(roots[0].fsPath, direct);
	});

	test("setting=subFolders: detects workspace root marker via the explicit root check", async () => {
		writeQuartoYml(tempDir);

		mockedConfig.autoProjectDetection = "subFolders";

		const roots = await discoverQuartoProjectRoots([makeFolder("workspace", tempDir)]);

		assert.strictEqual(roots.length, 1);
		assert.strictEqual(roots[0].fsPath, tempDir);
		assert.strictEqual(roots[0].label, "workspace");
	});

	test("setting=subFolders: discovers depth-1 _extensions/-only projects", async () => {
		const extProject = path.join(tempDir, "ext-only");
		writeExtensionManifest(extProject, "quarto-ext", "fontawesome");

		mockedConfig.autoProjectDetection = "subFolders";

		const roots = await discoverQuartoProjectRoots([makeFolder("workspace", tempDir)]);

		assert.strictEqual(roots.length, 1);
		assert.strictEqual(roots[0].fsPath, extProject);
	});

	test("setting=true: recursive scan finds deeply-nested projects", async () => {
		const direct = path.join(tempDir, "site-a");
		const deep = path.join(tempDir, "deep", "nested");
		writeQuartoYml(direct);
		writeQuartoYml(deep);

		mockedConfig.autoProjectDetection = true;

		const roots = await discoverQuartoProjectRoots([makeFolder("workspace", tempDir)]);

		const paths = roots.map((r) => r.fsPath).sort();
		assert.deepStrictEqual(paths, [deep, direct].sort());
	});

	test("setting=<invalid>: falls back to direct subfolder scan", async () => {
		writeQuartoYml(path.join(tempDir, "site-a"));

		mockedConfig.autoProjectDetection = "recursive" as unknown as AutoProjectDetection;

		const roots = await discoverQuartoProjectRoots([makeFolder("workspace", tempDir)]);

		assert.strictEqual(roots.length, 1);
		assert.strictEqual(roots[0].fsPath, path.join(tempDir, "site-a"));
	});

	test("setting=true: does not auto-detect via open editors", async () => {
		const projectDir = path.join(tempDir, "site");
		writeQuartoYml(projectDir);
		const docPath = path.join(projectDir, "doc.qmd");
		fs.writeFileSync(docPath, "", "utf8");

		// Force findFiles to return no subfolder matches so any detection must come from
		// the open-editor walk-up. With the narrowed `true` semantics, that path is gated
		// off and the discovery should fall back to the workspace folder.
		vscode.workspace.findFiles = (() => Promise.resolve([])) as typeof vscode.workspace.findFiles;

		mockedConfig.autoProjectDetection = true;
		mockedTextDocuments = [makeDocument(docPath)];

		const roots = await discoverQuartoProjectRoots([makeFolder("workspace", tempDir)]);

		assert.strictEqual(roots.length, 1);
		assert.strictEqual(roots[0].fsPath, tempDir);
	});

	test("detects workspace root via _extensions/ when _quarto.yml is absent", async () => {
		writeExtensionManifest(tempDir, "quarto-ext", "fontawesome");

		const roots = await discoverQuartoProjectRoots([makeFolder("workspace", tempDir)]);

		assert.strictEqual(roots.length, 1);
		assert.strictEqual(roots[0].fsPath, tempDir);
		assert.strictEqual(roots[0].label, "workspace");
	});

	test("returns mixed _quarto.yml and _extensions/ sub-roots", async () => {
		const siteA = path.join(tempDir, "site-a");
		const siteB = path.join(tempDir, "site-b");
		writeQuartoYml(siteA);
		writeExtensionManifest(siteB, "quarto-ext", "fontawesome");

		const roots = await discoverQuartoProjectRoots([makeFolder("workspace", tempDir)]);

		const paths = roots.map((r) => r.fsPath).sort();
		assert.deepStrictEqual(paths, [siteA, siteB]);
	});

	test("empty _extensions/ directory does not qualify; falls back to workspace folder", async () => {
		fs.mkdirSync(path.join(tempDir, "lonely", "_extensions"), { recursive: true });

		const roots = await discoverQuartoProjectRoots([makeFolder("workspace", tempDir)]);

		assert.strictEqual(roots.length, 1);
		assert.strictEqual(roots[0].fsPath, tempDir);
	});

	test("nested _extensions/ inside another extension is not treated as a separate root", async () => {
		// Outer: /temp/_extensions/outer/_extension.yml
		// Nested: /temp/_extensions/outer/template/_extensions/inner/_extension.yml
		writeExtensionManifest(tempDir, "outer", "ext");
		const nested = path.join(tempDir, "_extensions", "outer", "ext", "template", "_extensions", "inner");
		fs.mkdirSync(nested, { recursive: true });
		fs.writeFileSync(path.join(nested, "_extension.yml"), "title: inner\n", "utf8");

		const roots = await discoverQuartoProjectRoots([makeFolder("workspace", tempDir)]);

		// Only the workspace root is reported; the nested `_extensions/` stays inside the outer extension.
		assert.strictEqual(roots.length, 1);
		assert.strictEqual(roots[0].fsPath, tempDir);
	});

	test("setting=openEditors: ascend finds _extensions/-only folder", async () => {
		const projectDir = path.join(tempDir, "nested", "ext-only");
		writeExtensionManifest(projectDir, "quarto-ext", "fontawesome");
		const docPath = path.join(projectDir, "doc.qmd");
		fs.writeFileSync(docPath, "", "utf8");

		mockedConfig.autoProjectDetection = "openEditors";
		mockedTextDocuments = [makeDocument(docPath)];

		const roots = await discoverQuartoProjectRoots([makeFolder("workspace", tempDir)]);

		assert.strictEqual(roots.length, 1);
		assert.strictEqual(roots[0].fsPath, projectDir);
		assert.strictEqual(roots[0].label, "workspace/nested/ext-only");
	});

	// Mirrors an extension development repository: the extension lives in the root
	// `_extensions/`, and `docs/` is a documentation website with its own project files.
	function writeExtensionRepoFixture(): string {
		writeExtensionManifest(tempDir, "mcanouil", "gitlink");
		const docs = path.join(tempDir, "docs");
		writeQuartoYml(docs);
		writeExtensionManifest(docs, "mcanouil", "gitlink");
		const docPath = path.join(docs, "index.qmd");
		fs.writeFileSync(docPath, "", "utf8");
		return docPath;
	}

	for (const setting of [true, "subFolders", "openEditors"] as const) {
		test(`setting=${setting}: populated root _extensions/ hides every sub-root`, async () => {
			const docPath = writeExtensionRepoFixture();
			mockedConfig.autoProjectDetection = setting;
			mockedTextDocuments = [makeDocument(docPath)];

			const roots = await discoverQuartoProjectRoots([makeFolder("workspace", tempDir)]);

			assert.strictEqual(roots.length, 1);
			assert.strictEqual(roots[0].fsPath, tempDir);
			assert.strictEqual(roots[0].label, "workspace");
		});
	}

	test("scans with the exclude settings of the editor, a result cap, and the caller's token", async () => {
		writeQuartoYml(path.join(tempDir, "site-a"));
		mockedFilesExclude = { "**/.git": true, "**/.hg": false };
		mockedSearchExclude = { "**/node_modules": true };

		interface ScanCall {
			exclude: vscode.GlobPattern | null | undefined;
			maxResults: number | undefined;
			token: vscode.CancellationToken | undefined;
		}
		const calls: ScanCall[] = [];
		vscode.workspace.findFiles = ((
			_include: vscode.GlobPattern,
			exclude?: vscode.GlobPattern | null,
			maxResults?: number,
			token?: vscode.CancellationToken,
		) => {
			calls.push({ exclude, maxResults, token });
			return Promise.resolve([]);
		}) as typeof vscode.workspace.findFiles;

		const source = new vscode.CancellationTokenSource();
		try {
			await discoverQuartoProjectRoots([makeFolder("workspace", tempDir)], source.token);
		} finally {
			source.dispose();
		}

		assert.strictEqual(calls.length, 2);
		for (const call of calls) {
			// A `null` exclude turns every exclude off, and an `undefined` exclude
			// applies `files.exclude` alone, which holds neither `node_modules` nor
			// build output. Both send the scan through the whole tree.
			assert.strictEqual(call.exclude, "{**/.git,**/node_modules}");
			assert.strictEqual(typeof call.maxResults, "number");
			assert.strictEqual(call.token, source.token);
		}
	});

	test("populated root _extensions/ short-circuits before any scan", async () => {
		writeExtensionRepoFixture();
		let findFilesCalled = false;
		vscode.workspace.findFiles = (() => {
			findFilesCalled = true;
			return Promise.resolve([]);
		}) as typeof vscode.workspace.findFiles;

		const roots = await discoverQuartoProjectRoots([makeFolder("workspace", tempDir)]);

		assert.strictEqual(findFilesCalled, false);
		assert.strictEqual(roots.length, 1);
		assert.strictEqual(roots[0].fsPath, tempDir);
	});

	test("empty root _extensions/ does not hide sub-roots", async () => {
		fs.mkdirSync(path.join(tempDir, EXTENSIONS_DIR), { recursive: true });
		const site = path.join(tempDir, "site");
		writeQuartoYml(site);

		const roots = await discoverQuartoProjectRoots([makeFolder("workspace", tempDir)]);

		assert.strictEqual(roots.length, 1);
		assert.strictEqual(roots[0].fsPath, site);
	});

	test(".quartoignore removes matching sub-roots", async () => {
		writeQuartoIgnore(tempDir, "# the documentation website\ndocs\n");
		writeQuartoYml(path.join(tempDir, "docs"));
		const paper = path.join(tempDir, "paper");
		writeQuartoYml(paper);

		const roots = await discoverQuartoProjectRoots([makeFolder("workspace", tempDir)]);

		assert.strictEqual(roots.length, 1);
		assert.strictEqual(roots[0].fsPath, paper);
	});

	test(".quartoignore removes sub-roots detected via _extensions/", async () => {
		writeQuartoIgnore(tempDir, "docs\n");
		writeExtensionManifest(path.join(tempDir, "docs"), "mcanouil", "gitlink");

		const roots = await discoverQuartoProjectRoots([makeFolder("workspace", tempDir)]);

		// Nothing survives the filter, so the workspace folder fallback applies.
		assert.strictEqual(roots.length, 1);
		assert.strictEqual(roots[0].fsPath, tempDir);
	});

	test(".quartoignore removes sub-roots found by the open-editor walk-up", async () => {
		writeQuartoIgnore(tempDir, "docs\n");
		const docs = path.join(tempDir, "docs");
		writeQuartoYml(docs);
		const docPath = path.join(docs, "index.qmd");
		fs.writeFileSync(docPath, "", "utf8");

		mockedConfig.autoProjectDetection = "openEditors";
		mockedTextDocuments = [makeDocument(docPath)];

		const roots = await discoverQuartoProjectRoots([makeFolder("workspace", tempDir)]);

		assert.strictEqual(roots.length, 1);
		assert.strictEqual(roots[0].fsPath, tempDir);
	});

	test("setting=openEditors: symlink loops in _extensions/ do not cause infinite recursion", async function () {
		// Skip on Windows; symlinks need elevated privileges there.
		if (process.platform === "win32") {
			this.skip();
			return;
		}
		const projectDir = path.join(tempDir, "with-loop");
		const extensionsDir = path.join(projectDir, "_extensions");
		fs.mkdirSync(extensionsDir, { recursive: true });
		// Self-referential symlink: `_extensions/loop -> _extensions`.
		fs.symlinkSync(extensionsDir, path.join(extensionsDir, "loop"), "dir");
		const docPath = path.join(projectDir, "doc.qmd");
		fs.writeFileSync(docPath, "", "utf8");

		mockedConfig.autoProjectDetection = "openEditors";
		mockedTextDocuments = [makeDocument(docPath)];

		// No assertion on the precise result; the test passes if discovery returns at all.
		const roots = await discoverQuartoProjectRoots([makeFolder("workspace", tempDir)]);

		// Empty `_extensions/` (only a symlink loop, no manifests) must not promote the folder.
		assert.strictEqual(roots.length, 1);
		assert.strictEqual(roots[0].fsPath, tempDir);
	});
});
