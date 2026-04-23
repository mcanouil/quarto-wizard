import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { MANIFEST_FILENAMES } from "@quarto-wizard/core";
import {
	discoverQuartoProjectRoots,
	EXTENSION_MANIFEST_GLOB,
	QUARTO_PROJECT_FILENAMES,
	QUARTO_PROJECT_GLOB,
} from "../../utils/quartoProjectDiscovery";

type AutoProjectDetection = boolean | "subFolders" | "openEditors";

interface MockedConfig {
	autoProjectDetection?: AutoProjectDetection;
}

const GLOB_MATCHERS: Record<string, ReadonlySet<string>> = {
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

	setup(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quarto-wizard-discovery-"));

		mockedTextDocuments = [];
		mockedConfig = { autoProjectDetection: true };

		originalFindFiles = vscode.workspace.findFiles;
		// Default: scan the temp tree on disk and dispatch by glob to mirror the real findFiles.
		vscode.workspace.findFiles = ((include: vscode.GlobPattern) => {
			if (typeof include === "object" && "baseUri" in include) {
				const rel = include as vscode.RelativePattern;
				const matcher = GLOB_MATCHERS[rel.pattern];
				if (matcher) {
					return Promise.resolve(scanForFiles(rel.baseUri.fsPath, matcher));
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

	function makeFolder(name: string, fsPath: string, index = 0): vscode.WorkspaceFolder {
		return { uri: vscode.Uri.file(fsPath), name, index };
	}

	function writeQuartoYml(dir: string): string {
		fs.mkdirSync(dir, { recursive: true });
		const file = path.join(dir, "_quarto.yml");
		fs.writeFileSync(file, "project:\n  type: website\n", "utf8");
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

	test("setting=subFolders: ignores open editors and only scans subfolders", async () => {
		const editorOnlyProject = path.join(tempDir, "editor-only");
		writeQuartoYml(editorOnlyProject);
		const docPath = path.join(editorOnlyProject, "doc.qmd");
		fs.writeFileSync(docPath, "", "utf8");

		mockedConfig.autoProjectDetection = "subFolders";
		mockedTextDocuments = [makeDocument(docPath)];

		const roots = await discoverQuartoProjectRoots([makeFolder("workspace", tempDir)]);

		// editor-only is still found because subFolders scans the on-disk tree.
		assert.strictEqual(roots.length, 1);
		assert.strictEqual(roots[0].fsPath, editorOnlyProject);
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
