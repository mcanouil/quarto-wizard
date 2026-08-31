import * as assert from "assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { findTypstBlocks, type TypstBlock } from "../../utils/typst/typstBlocks";
import { EMPTY_BRAND, brandColourReader, splitBrand } from "../../utils/typst/typstBrand";
import { mergeGlobalConfigs, resolveTypstOptions, type TypstGlobalLevel } from "../../utils/typst/typstOptions";
import { buildCell, cellNotes, isUnavailable, resolvePreamble } from "../../utils/typst/typstSource";
import type { SchemaCache } from "@quarto-wizard/schema";
import {
	buildCompileRequest,
	isNewerThanPinned,
	PINNED_TYPST_RENDER_VERSION,
} from "../../providers/typstPreview/typstContext";
import { readBrand, readMetadataChain, resolveQuartoPath } from "../../providers/typstPreview/typstMetadata";
import { invalidateProjectRoots, setProjectRoots } from "../../utils/projectRootsRegistry";
import { parseFrontMatter } from "../../utils/yamlPosition";
import { makeFolder, makeRoot } from "./projectFixtures";

/** The one cell of a document written as an option run over one line of code. */
function cell(options: string[], code = "#circle()"): TypstBlock {
	const body = [...options.map((option) => `//| ${option}`), code].join("\n");
	return findTypstBlocks(`\`\`\`{typst}\n${body}\n\`\`\`\n`)[0];
}

/** A read that answers from a table rather than from disk. */
function reader(files: Record<string, string>): (documentPath: string) => Promise<string | undefined> {
	return (documentPath) => Promise.resolve(files[documentPath]);
}

suite("Typst Preview Context Test Suite", () => {
	suite("resolvePreamble", () => {
		test("Should keep an entry that is not a path as inline code", async () => {
			assert.strictEqual(await resolvePreamble("#let a = 1", reader({})), "#let a = 1");
		});

		test("Should read an entry ending in .typ from disk", async () => {
			assert.strictEqual(await resolvePreamble("shared.typ", reader({ "shared.typ": "#let a = 1\n" })), "#let a = 1\n");
		});

		test("Should join a list with newlines, in order", async () => {
			const resolved = await resolvePreamble(["#let a = 1", "shared.typ"], reader({ "shared.typ": "#let b = 2" }));
			assert.strictEqual(resolved, "#let a = 1\n#let b = 2");
		});

		test("Should drop an entry that cannot be read rather than failing", async () => {
			// The filter logs and carries on. A preview that refused the whole block
			// would say nothing about the one entry that is wrong.
			assert.strictEqual(await resolvePreamble(["#let a = 1", "missing.typ"], reader({})), "#let a = 1");
		});

		test("Should answer nothing for an absent or empty preamble", async () => {
			assert.strictEqual(await resolvePreamble(undefined, reader({})), "");
			assert.strictEqual(await resolvePreamble("", reader({})), "");
			assert.strictEqual(await resolvePreamble([], reader({})), "");
		});
	});

	suite("buildCell", () => {
		const context = {
			levels: [],
			brand: EMPTY_BRAND,
			mode: "light" as const,
			readFile: reader({}),
		};

		test("Should count every injected line so a diagnostic maps back", async () => {
			const built = await buildCell(cell([]), context);
			assert.ok(!isUnavailable(built));
			// Three bindings and the page directive, and no `#set text` because
			// nothing set a foreground.
			assert.strictEqual(built.injectedLines, 4);
			assert.ok(built.source.endsWith("\n#circle()"));
		});

		test("Should add the text fill line when a foreground is set", async () => {
			const built = await buildCell(cell(['foreground: "#1a1a1a"']), context);
			assert.ok(!isUnavailable(built));
			assert.strictEqual(built.injectedLines, 5);
			assert.ok(built.source.includes('#set text(fill: rgb("#1a1a1a"))'));
		});

		test("Should bind the foreground as none when nothing sets one", async () => {
			// Consuming Typst code reads `_typst_render_foreground` whether or not
			// the document sets a colour, so the binding is always written.
			const built = await buildCell(cell([]), context);
			assert.ok(!isUnavailable(built));
			assert.ok(built.source.includes("#let _typst_render_foreground = none"));
		});

		test("Should replace the body with the contents of a file option", async () => {
			const built = await buildCell(cell(["file: diagram.typ"]), {
				...context,
				readFile: reader({ "diagram.typ": "#rect()\n" }),
			});
			assert.ok(!isUnavailable(built));
			assert.ok(built.source.endsWith("#rect()\n"));
			assert.ok(!built.source.includes("#circle()"));
		});

		test("Should say so when a file option cannot be read", async () => {
			// The filter renders nothing here. A blank image with no reason beside
			// it would look like the block itself was empty.
			const built = await buildCell(cell(["file: missing.typ"]), context);
			assert.ok(isUnavailable(built));
			assert.ok(built.unavailable.includes("missing.typ"));
		});

		test("Should read the colours of the mode in force", async () => {
			const brand = splitBrand({
				color: { background: { light: "#fdf6e3", dark: "#101418" } },
			});
			const dark = await buildCell(cell(["background: auto"]), { ...context, brand, mode: "dark" });
			assert.ok(!isUnavailable(dark));
			assert.ok(dark.source.includes('#let _typst_render_background = rgb("#101418")'));
		});

		test("Should let a global level set the geometry", async () => {
			const built = await buildCell(cell([]), { ...context, levels: [{ width: "6cm", margin: "1cm" }] });
			assert.ok(!isUnavailable(built));
			assert.ok(built.source.includes("#set page(width: 6cm, height: auto, margin: 1cm, fill: none)"));
		});

		test("Should ignore a block-level root, which is a global-only option", async () => {
			// `root` never reaches the source, so a block writing it changes nothing.
			const plain = await buildCell(cell([]), context);
			const rooted = await buildCell(cell(["root: ../assets"]), context);
			assert.ok(!isUnavailable(plain) && !isUnavailable(rooted));
			assert.strictEqual(rooted.source, plain.source);
		});
	});

	suite("resolveQuartoPath", () => {
		test("Should read a leading slash as the project root", () => {
			assert.strictEqual(resolveQuartoPath("/theme.typ", "/p/sub", "/p"), path.join("/p", "theme.typ"));
		});

		test("Should read every other path against the directory given", () => {
			// This is the `preamble:` and `file:` rule, and it is not the rule `root`,
			// `font-path` and `package-path` follow. Conflating the two would read a
			// preamble from the wrong directory in any project whose documents are not
			// at its root.
			assert.strictEqual(resolveQuartoPath("theme.typ", "/p/sub", "/p"), path.join("/p/sub", "theme.typ"));
		});

		test("Should answer nothing when there is no directory to resolve against", () => {
			assert.strictEqual(resolveQuartoPath("theme.typ", undefined, "/p"), undefined);
			assert.strictEqual(resolveQuartoPath("/theme.typ", "/p/sub", undefined), undefined);
		});
	});

	suite("cellNotes", () => {
		/** The notes of a cell written with the given options and global levels. */
		function notesOf(options: string[], levels: TypstGlobalLevel[] = []): string[] {
			const merged = mergeGlobalConfigs(levels, brandColourReader(EMPTY_BRAND));
			return cellNotes(resolveTypstOptions(cell(options), merged, brandColourReader(EMPTY_BRAND)));
		}

		test("Should say that the preview compiles to SVG for another format", () => {
			assert.deepStrictEqual(notesOf(["format: pdf"]), ["the preview compiles to SVG, not to pdf"]);
			assert.deepStrictEqual(notesOf(["format: html"]), ["the preview compiles to SVG, not to html"]);
		});

		test("Should say nothing about a format the preview does produce", () => {
			assert.deepStrictEqual(notesOf(["format: svg"]), []);
			assert.deepStrictEqual(notesOf([]), []);
		});

		test("Should read a format a global level set, not only one on the block", () => {
			// `format`, `output` and `pages` are all global keys as well, so reading
			// the block's own run alone would say nothing about a document that sets
			// the format once in its `_quarto.yml`.
			assert.deepStrictEqual(notesOf([], [{ format: "pdf" }]), ["the preview compiles to SVG, not to pdf"]);
		});

		test("Should say that an asis cell inherits a page the preview cannot apply", () => {
			assert.deepStrictEqual(notesOf(["output: asis"]), [
				"an `output: asis` cell inherits the document page, which the preview cannot apply",
			]);
		});

		test("Should say that only the first page is shown when pages selects some", () => {
			assert.deepStrictEqual(notesOf(["pages: 2-3"]), ["the preview shows the first page only"]);
			assert.deepStrictEqual(notesOf(["pages: all"]), []);
		});
	});

	suite("isNewerThanPinned", () => {
		test("Should hold only for a version above the pinned one", () => {
			assert.strictEqual(isNewerThanPinned("0.22.0", "0.21.0"), true);
			assert.strictEqual(isNewerThanPinned("1.0.0", "0.21.0"), true);
			assert.strictEqual(isNewerThanPinned("0.21.1", "0.21.0"), true);
			assert.strictEqual(isNewerThanPinned("0.21.0", "0.21.0"), false);
			assert.strictEqual(isNewerThanPinned("0.20.9", "0.21.0"), false);
		});

		test("Should compare part by part and not as text", () => {
			// `"0.9.0" > "0.21.0"` holds as a string comparison and is wrong.
			assert.strictEqual(isNewerThanPinned("0.9.0", "0.21.0"), false);
		});

		test("Should say nothing about a version it cannot compare", () => {
			// A pre-release suffix is not worth a warning of its own, and neither is
			// a version string that is not a number at all.
			assert.strictEqual(isNewerThanPinned("0.22.0-beta", "0.21.0"), true);
			assert.strictEqual(isNewerThanPinned("next", "0.21.0"), false);
		});

		test("Should pin the version the fixtures were recorded from", () => {
			assert.strictEqual(PINNED_TYPST_RENDER_VERSION, "0.21.0");
		});
	});

	suite("parseFrontMatter", () => {
		test("Should parse the mapping between the delimiters", () => {
			assert.deepStrictEqual(parseFrontMatter("---\ntitle: A\n---\n\nBody\n"), { title: "A" });
		});

		test("Should parse a document written with CRLF", () => {
			assert.deepStrictEqual(parseFrontMatter("---\r\ntitle: A\r\n---\r\n"), { title: "A" });
		});

		test("Should answer nothing for a document with no front matter", () => {
			assert.strictEqual(parseFrontMatter("Body only.\n"), undefined);
			assert.strictEqual(parseFrontMatter("---\ntitle: A\n"), undefined);
		});

		test("Should answer nothing for front matter that does not parse", () => {
			assert.strictEqual(parseFrontMatter("---\na: [1,\n---\n"), undefined);
		});
	});

	suite("buildCompileRequest", () => {
		/** The page setup a preview injects above a plain block and a raw block. */
		const HEADER = "#set page(width: auto, height: auto, margin: 0.5em)";

		/**
		 * A cache the cell path would read and the other two never touch.
		 *
		 * The paths under test here never reach the schema gate, so a stub is what
		 * says that rather than a real cache quietly making it look reachable.
		 */
		const NO_SCHEMA_CACHE = {
			get: () => {
				throw new Error("the schema cache is only for a cell");
			},
		} as unknown as SchemaCache;

		/** An open document holding the given text. */
		async function documentOf(text: string): Promise<vscode.TextDocument> {
			return vscode.workspace.openTextDocument({ language: "quarto", content: text });
		}

		test("Should say so when the cursor is in no block", async () => {
			const document = await documentOf("Prose only.\n");
			const request = await buildCompileRequest(document, new vscode.Position(0, 0), HEADER, NO_SCHEMA_CACHE);
			assert.ok(isUnavailable(request));
			assert.ok(request.unavailable.includes("cursor"));
		});

		test("Should assemble a plain block under the preview's own header", async () => {
			const document = await documentOf("```typst\n#circle()\n```\n");
			const request = await buildCompileRequest(document, new vscode.Position(1, 0), HEADER, NO_SCHEMA_CACHE);
			assert.ok(!isUnavailable(request));
			assert.strictEqual(request.source, `${HEADER}\n#circle()\n`);
			assert.strictEqual(request.block.kind, "plain");
			// The header is the preview's own, so the brand of the document has no
			// part in it and there is no mode to report.
			assert.strictEqual(request.brandMode, undefined);
			assert.deepStrictEqual(request.notes, []);
		});

		test("Should assemble a raw block under the raw blocks above it", async () => {
			const text = "```{=typst}\n#let a = red\n```\n\n```{=typst}\n#text(fill: a)[Hi]\n```\n";
			const document = await documentOf(text);
			const request = await buildCompileRequest(document, new vscode.Position(5, 0), HEADER, NO_SCHEMA_CACHE);
			assert.ok(!isUnavailable(request));
			assert.strictEqual(request.source, `${HEADER}\n#let a = red\n#text(fill: a)[Hi]\n`);
			assert.strictEqual(request.injectedLines, 2);
		});
	});

	suite("readMetadataChain and readBrand", () => {
		let directory: string;

		/** Write a file inside the temporary project, making its directory. */
		function write(relative: string, text: string): string {
			const file = path.join(directory, relative);
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, text);
			return file;
		}

		/** Open a document of the temporary project. */
		async function open(relative: string): Promise<vscode.TextDocument> {
			return vscode.workspace.openTextDocument(vscode.Uri.file(path.join(directory, relative)));
		}

		setup(() => {
			directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "typst-chain-")));
		});

		teardown(() => {
			invalidateProjectRoots();
			fs.rmSync(directory, { recursive: true, force: true });
		});

		/** Treat the temporary directory as the one Quarto project root. */
		function asProject(): void {
			setProjectRoots([makeRoot(makeFolder("typst-chain", directory))]);
		}

		test("Should read the front matter of a document outside every project", async () => {
			// A scratch file has no project root, so the chain is its front matter
			// alone and nothing about it is guessed from the workspace.
			setProjectRoots([]);
			write("loose.qmd", "---\nextensions:\n  typst-render:\n    dpi: 300\n---\n\nBody\n");
			const chain = await readMetadataChain(await open("loose.qmd"));
			assert.deepStrictEqual(chain.levels, [{ dpi: 300 }]);
			assert.strictEqual(chain.projectRoot, undefined);
		});

		test("Should order the chain from the project root down to the document", async () => {
			// The order is the precedence order, so a level nearer the document
			// overrides one further from it.
			asProject();
			write("_quarto.yml", "extensions:\n  typst-render:\n    margin: 1cm\n    width: 6cm\n");
			write("sub/_metadata.yml", "extensions:\n  typst-render:\n    margin: 2cm\n");
			write("sub/doc.qmd", "---\nextensions:\n  typst-render:\n    margin: 3cm\n---\n\nBody\n");

			const chain = await readMetadataChain(await open("sub/doc.qmd"));
			assert.deepStrictEqual(chain.levels, [{ margin: "1cm", width: "6cm" }, { margin: "2cm" }, { margin: "3cm" }]);
		});

		test("Should walk every _metadata.yml between the root and the document", async () => {
			asProject();
			write("_metadata.yml", "extensions:\n  typst-render:\n    margin: 1cm\n");
			write("a/_metadata.yml", "extensions:\n  typst-render:\n    margin: 2cm\n");
			write("a/b/_metadata.yml", "extensions:\n  typst-render:\n    margin: 3cm\n");
			write("a/b/doc.qmd", "Body\n");

			const chain = await readMetadataChain(await open("a/b/doc.qmd"));
			assert.deepStrictEqual(chain.levels, [{ margin: "1cm" }, { margin: "2cm" }, { margin: "3cm" }]);
		});

		test("Should read the bare typst-render key of a level as well", async () => {
			asProject();
			write("doc.qmd", "---\ntypst-render:\n  margin: 2cm\n---\n\nBody\n");
			const chain = await readMetadataChain(await open("doc.qmd"));
			assert.deepStrictEqual(chain.levels, [{ margin: "2cm" }]);
		});

		test("Should read the brand from the project root", async () => {
			asProject();
			write("_brand.yml", "color:\n  palette:\n    paper: '#fdf6e3'\n  background: paper\n");
			write("doc.qmd", "Body\n");

			const chain = await readMetadataChain(await open("doc.qmd"));
			const brand = await readBrand(chain);
			assert.strictEqual(brandColourReader(brand)("light", "background"), "#fdf6e3");
		});

		test("Should read the brand from the _brand directory when the root has none", async () => {
			asProject();
			write("_brand/_brand.yml", "color:\n  background: '#101418'\n");
			write("doc.qmd", "Body\n");

			const chain = await readMetadataChain(await open("doc.qmd"));
			const brand = await readBrand(chain);
			assert.strictEqual(brandColourReader(brand)("light", "background"), "#101418");
		});

		test("Should honour a brand path the document names, relative to itself", async () => {
			asProject();
			write("_brand.yml", "color:\n  background: '#ffffff'\n");
			write("sub/theme.yml", "color:\n  background: '#101418'\n");
			write("sub/doc.qmd", "---\nbrand: theme.yml\n---\n\nBody\n");

			const chain = await readMetadataChain(await open("sub/doc.qmd"));
			const brand = await readBrand(chain);
			assert.strictEqual(brandColourReader(brand)("light", "background"), "#101418");
		});

		test("Should resolve a brand path from _quarto.yml against the project root", async () => {
			// Quarto splits the two cases: a `brand:` in the project configuration
			// resolves from the project root, and one reaching the file metadata
			// resolves from the directory of the document. Resolving both the same way
			// would look for the file beside a document that never named it.
			asProject();
			write("_quarto.yml", "brand: theme.yml\n");
			write("theme.yml", "color:\n  background: '#101418'\n");
			write("sub/doc.qmd", "Body\n");

			const chain = await readMetadataChain(await open("sub/doc.qmd"));
			const brand = await readBrand(chain);
			assert.strictEqual(brandColourReader(brand)("light", "background"), "#101418");
		});

		test("Should read a leading slash in a brand path as the project root", async () => {
			asProject();
			write("theme.yml", "color:\n  background: '#101418'\n");
			write("sub/doc.qmd", "---\nbrand: /theme.yml\n---\n\nBody\n");

			const chain = await readMetadataChain(await open("sub/doc.qmd"));
			const brand = await readBrand(chain);
			assert.strictEqual(brandColourReader(brand)("light", "background"), "#101418");
		});

		test("Should read no brand at all when the document disables it", async () => {
			asProject();
			write("_brand.yml", "color:\n  background: '#fdf6e3'\n");
			write("doc.qmd", "---\nbrand: false\n---\n\nBody\n");

			const chain = await readMetadataChain(await open("doc.qmd"));
			const brand = await readBrand(chain);
			assert.strictEqual(brandColourReader(brand)("light", "background"), undefined);
		});

		test("Should take each mode from its own file when brand names a pair", async () => {
			asProject();
			write("light.yml", "color:\n  background: '#fdf6e3'\n");
			write("dark.yml", "color:\n  background: '#101418'\n");
			write("doc.qmd", "---\nbrand:\n  light: light.yml\n  dark: dark.yml\n---\n\nBody\n");

			const chain = await readMetadataChain(await open("doc.qmd"));
			const read = brandColourReader(await readBrand(chain));
			assert.strictEqual(read("light", "background"), "#fdf6e3");
			assert.strictEqual(read("dark", "background"), "#101418");
		});

		test("Should have no brand for a document outside every project", async () => {
			// A brand is a property of a project, and there is no root to resolve a
			// candidate path against.
			setProjectRoots([]);
			write("loose.qmd", "Body\n");
			write("_brand.yml", "color:\n  background: '#fdf6e3'\n");

			const chain = await readMetadataChain(await open("loose.qmd"));
			const brand = await readBrand(chain);
			assert.strictEqual(brandColourReader(brand)("light", "background"), undefined);
		});
	});
});
