import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
	getMetadataFiles,
	invalidateMetadataFiles,
	isRegisteredMetadataFile,
	isRelevantYaml,
	refreshSource,
} from "../../utils/metadataFilesRegistry";

const QUARTO_AND_METADATA_FILENAMES = new Set(["_quarto.yml", "_quarto.yaml", "_metadata.yml", "_metadata.yaml"]);

suite("Metadata Files Registry Test Suite", () => {
	let tempDir: string;
	let originalFindFiles: typeof vscode.workspace.findFiles;
	let originalTextDocumentsDescriptor: PropertyDescriptor | undefined;
	let mockedTextDocuments: readonly vscode.TextDocument[];

	function scan(base: string, filenames: ReadonlySet<string>): vscode.Uri[] {
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
				} else if (entry.isFile() && filenames.has(entry.name)) {
					matches.push(vscode.Uri.file(fullPath));
				}
			}
		};
		walk(base);
		return matches;
	}

	setup(() => {
		tempDir = vscode.Uri.file(fs.mkdtempSync(path.join(os.tmpdir(), "quarto-wizard-metadata-"))).fsPath;

		mockedTextDocuments = [];
		originalFindFiles = vscode.workspace.findFiles;
		vscode.workspace.findFiles = ((include: vscode.GlobPattern) => {
			if (typeof include === "object" && "baseUri" in include) {
				const rel = include as vscode.RelativePattern;
				if (rel.pattern === "**/_{quarto,metadata}.{yml,yaml}") {
					return Promise.resolve(scan(rel.baseUri.fsPath, QUARTO_AND_METADATA_FILENAMES));
				}
			}
			return Promise.resolve([]);
		}) as typeof vscode.workspace.findFiles;

		originalTextDocumentsDescriptor = Object.getOwnPropertyDescriptor(vscode.workspace, "textDocuments");
		Object.defineProperty(vscode.workspace, "textDocuments", {
			get: () => mockedTextDocuments,
			configurable: true,
		});

		invalidateMetadataFiles();
	});

	teardown(() => {
		invalidateMetadataFiles();
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
		vscode.workspace.findFiles = originalFindFiles;
		if (originalTextDocumentsDescriptor) {
			Object.defineProperty(vscode.workspace, "textDocuments", originalTextDocumentsDescriptor);
		}
	});

	function writeFile(filePath: string, content: string): void {
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, content, "utf8");
	}

	function makeDocument(filePath: string, text: string, languageId = "quarto"): vscode.TextDocument {
		const lineCount = text.split("\n").length;
		return {
			uri: vscode.Uri.file(filePath),
			fileName: filePath,
			isUntitled: false,
			isClosed: false,
			languageId,
			lineCount,
			getText: () => text,
		} as unknown as vscode.TextDocument;
	}

	test("collects metadata-files from _quarto.yml", async () => {
		writeFile(
			path.join(tempDir, "_quarto.yml"),
			["project:", "  type: website", "metadata-files:", "  - _sidebar.yml", "  - sub/_extra.yml", ""].join("\n"),
		);

		const files = await getMetadataFiles(tempDir);
		assert.strictEqual(files.size, 2);
		assert.ok(files.has(path.normalize(path.join(tempDir, "_sidebar.yml"))));
		assert.ok(files.has(path.normalize(path.join(tempDir, "sub/_extra.yml"))));
	});

	test("isRegisteredMetadataFile returns the owning project root", async () => {
		writeFile(path.join(tempDir, "_quarto.yml"), "metadata-files:\n  - _sidebar.yml\n");

		await getMetadataFiles(tempDir);
		const owning = isRegisteredMetadataFile(path.join(tempDir, "_sidebar.yml"));
		assert.strictEqual(owning, path.normalize(tempDir));
	});

	test("collects from _metadata.yml in subdirectory", async () => {
		writeFile(path.join(tempDir, "chapter", "_metadata.yml"), "metadata-files:\n  - shared.yml\n  - ../top.yml\n");

		const files = await getMetadataFiles(tempDir);
		assert.strictEqual(files.size, 2);
		assert.ok(files.has(path.normalize(path.join(tempDir, "chapter", "shared.yml"))));
		assert.ok(files.has(path.normalize(path.join(tempDir, "top.yml"))));
	});

	test("collects from .qmd front-matter via open document", async () => {
		const qmdPath = path.join(tempDir, "doc.qmd");
		const text = ["---", "title: Doc", "metadata-files:", "  - _sidebar.yml", "---", "", "Body."].join("\n");
		writeFile(qmdPath, text);
		mockedTextDocuments = [makeDocument(qmdPath, text)];

		const files = await getMetadataFiles(tempDir);
		assert.ok(files.has(path.normalize(path.join(tempDir, "_sidebar.yml"))));
	});

	test("refreshSource drops removed entries", async () => {
		const sourcePath = path.join(tempDir, "_quarto.yml");
		writeFile(sourcePath, "metadata-files:\n  - _a.yml\n  - _b.yml\n");

		const before = await getMetadataFiles(tempDir);
		assert.strictEqual(before.size, 2);

		writeFile(sourcePath, "metadata-files:\n  - _a.yml\n");
		const changed = await refreshSource(tempDir, sourcePath);
		assert.strictEqual(changed, true);

		const after = await getMetadataFiles(tempDir);
		assert.strictEqual(after.size, 1);
		assert.ok(after.has(path.normalize(path.join(tempDir, "_a.yml"))));
		assert.strictEqual(isRegisteredMetadataFile(path.join(tempDir, "_b.yml")), undefined);
	});

	test("refreshSource returns false when contributions are unchanged", async () => {
		const sourcePath = path.join(tempDir, "_quarto.yml");
		writeFile(sourcePath, "metadata-files:\n  - _a.yml\n");

		await getMetadataFiles(tempDir);
		const changedAgain = await refreshSource(tempDir, sourcePath);
		assert.strictEqual(changedAgain, false);
	});

	test("refreshSource removes all entries when source is deleted", async () => {
		const sourcePath = path.join(tempDir, "_quarto.yml");
		writeFile(sourcePath, "metadata-files:\n  - _a.yml\n");

		await getMetadataFiles(tempDir);
		fs.rmSync(sourcePath);
		await refreshSource(tempDir, sourcePath);

		const after = await getMetadataFiles(tempDir);
		assert.strictEqual(after.size, 0);
	});

	test("invalid YAML is tolerated silently", async () => {
		writeFile(path.join(tempDir, "_quarto.yml"), "metadata-files:\n  - _ok.yml\n: : not valid\n");
		const files = await getMetadataFiles(tempDir);
		assert.strictEqual(files.size, 0);
	});

	test("missing metadata-files key yields empty set", async () => {
		writeFile(path.join(tempDir, "_quarto.yml"), "project:\n  type: website\n");
		const files = await getMetadataFiles(tempDir);
		assert.strictEqual(files.size, 0);
	});

	test("isRelevantYaml accepts canonical files and registered metadata files", async () => {
		writeFile(path.join(tempDir, "_quarto.yml"), "metadata-files:\n  - _sidebar.yml\n");
		await getMetadataFiles(tempDir);

		const qmdDoc = makeDocument(path.join(tempDir, "doc.qmd"), "", "quarto");
		const quartoYml = makeDocument(path.join(tempDir, "_quarto.yml"), "", "yaml");
		const metadataYml = makeDocument(path.join(tempDir, "sub", "_metadata.yml"), "", "yaml");
		const includedYml = makeDocument(path.join(tempDir, "_sidebar.yml"), "", "yaml");
		const unrelatedYml = makeDocument(path.join(tempDir, "other.yml"), "", "yaml");

		assert.strictEqual(isRelevantYaml(qmdDoc), true);
		assert.strictEqual(isRelevantYaml(quartoYml), true);
		assert.strictEqual(isRelevantYaml(metadataYml), true);
		assert.strictEqual(isRelevantYaml(includedYml), true);
		assert.strictEqual(isRelevantYaml(unrelatedYml), false);
	});
});
