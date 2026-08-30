import * as assert from "assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { findTypstBlocks, type TypstBlock } from "../../utils/typst/typstBlocks";
import { EMPTY_BRAND, brandColourReader, splitBrand } from "../../utils/typst/typstBrand";
import { buildCell, isUnavailable, resolvePreamble } from "../../utils/typst/typstSource";
import type { SchemaCache } from "@quarto-wizard/schema";
import {
	buildCompileRequest,
	isNewerThanPinned,
	isUnavailableRequest,
	limitations,
	PINNED_TYPST_RENDER_VERSION,
} from "../../providers/typstPreview/typstContext";
import { readBrand, readFrontMatter, readMetadataChain } from "../../providers/typstPreview/typstMetadata";
import { invalidateProjectRoots, setProjectRoots } from "../../utils/projectRootsRegistry";
import { makeFolder, makeRoot } from "./projectFixtures";

/** The one cell of a document written as an option run over one line of code. */
function cell(options: string[], code = "#circle()"): TypstBlock {
	const body = [...options.map((option) => `//| ${option}`), code].join("\n");
	return findTypstBlocks(`\`\`\`{typst}\n${body}\n\`\`\`\n`)[0];
}

/** A read that answers from a table rather than from disk. */
function reader(files: Record<string, string>): (documentPath: string) => string | undefined {
	return (documentPath) => files[documentPath];
}

suite("Typst Preview Context Test Suite", () => {
	suite("resolvePreamble", () => {
		test("Should keep an entry that is not a path as inline code", () => {
			assert.strictEqual(resolvePreamble("#let a = 1", reader({})), "#let a = 1");
		});

		test("Should read an entry ending in .typ from disk", () => {
			assert.strictEqual(resolvePreamble("shared.typ", reader({ "shared.typ": "#let a = 1\n" })), "#let a = 1\n");
		});

		test("Should join a list with newlines, in order", () => {
			const resolved = resolvePreamble(["#let a = 1", "shared.typ"], reader({ "shared.typ": "#let b = 2" }));
			assert.strictEqual(resolved, "#let a = 1\n#let b = 2");
		});

		test("Should drop an entry that cannot be read rather than failing", () => {
			// The filter logs and carries on. A preview that refused the whole block
			// would say nothing about the one entry that is wrong.
			assert.strictEqual(resolvePreamble(["#let a = 1", "missing.typ"], reader({})), "#let a = 1");
		});

		test("Should answer nothing for an absent or empty preamble", () => {
			assert.strictEqual(resolvePreamble(undefined, reader({})), "");
			assert.strictEqual(resolvePreamble("", reader({})), "");
			assert.strictEqual(resolvePreamble([], reader({})), "");
		});
	});

	suite("buildCell", () => {
		const context = {
			levels: [],
			brand: EMPTY_BRAND,
			mode: "light" as const,
			readFile: reader({}),
		};

		test("Should count every injected line so a diagnostic maps back", () => {
			const built = buildCell(cell([]), context);
			assert.ok(!isUnavailable(built));
			// Three bindings and the page directive, and no `#set text` because
			// nothing set a foreground.
			assert.strictEqual(built.injectedLines, 4);
			assert.ok(built.source.endsWith("\n#circle()"));
		});

		test("Should add the text fill line when a foreground is set", () => {
			const built = buildCell(cell(['foreground: "#1a1a1a"']), context);
			assert.ok(!isUnavailable(built));
			assert.strictEqual(built.injectedLines, 5);
			assert.ok(built.source.includes('#set text(fill: rgb("#1a1a1a"))'));
		});

		test("Should bind the foreground as none when nothing sets one", () => {
			// Consuming Typst code reads `_typst_render_foreground` whether or not
			// the document sets a colour, so the binding is always written.
			const built = buildCell(cell([]), context);
			assert.ok(!isUnavailable(built));
			assert.ok(built.source.includes("#let _typst_render_foreground = none"));
		});

		test("Should replace the body with the contents of a file option", () => {
			const built = buildCell(cell(["file: diagram.typ"]), {
				...context,
				readFile: reader({ "diagram.typ": "#rect()\n" }),
			});
			assert.ok(!isUnavailable(built));
			assert.ok(built.source.endsWith("#rect()\n"));
			assert.ok(!built.source.includes("#circle()"));
		});

		test("Should say so when a file option cannot be read", () => {
			// The filter renders nothing here. A blank image with no reason beside
			// it would look like the block itself was empty.
			const built = buildCell(cell(["file: missing.typ"]), context);
			assert.ok(isUnavailable(built));
			assert.ok(built.unavailable.includes("missing.typ"));
		});

		test("Should read the colours of the mode in force", () => {
			const brand = splitBrand({
				color: { background: { light: "#fdf6e3", dark: "#101418" } },
			});
			const dark = buildCell(cell(["background: auto"]), { ...context, brand, mode: "dark" });
			assert.ok(!isUnavailable(dark));
			assert.ok(dark.source.includes('#let _typst_render_background = rgb("#101418")'));
		});

		test("Should let a global level set the geometry", () => {
			const built = buildCell(cell([]), { ...context, levels: [{ width: "6cm", margin: "1cm" }] });
			assert.ok(!isUnavailable(built));
			assert.ok(built.source.includes("#set page(width: 6cm, height: auto, margin: 1cm, fill: none)"));
		});

		test("Should ignore a block-level root, which is a global-only option", () => {
			// `root` never reaches the source, so a block writing it changes nothing.
			const plain = buildCell(cell([]), context);
			const rooted = buildCell(cell(["root: ../assets"]), context);
			assert.ok(!isUnavailable(plain) && !isUnavailable(rooted));
			assert.strictEqual(rooted.source, plain.source);
		});
	});

	suite("limitations", () => {
		test("Should say that the preview compiles to SVG for another format", () => {
			assert.deepStrictEqual(limitations(cell(["format: pdf"])), ["the preview compiles to SVG, not to pdf"]);
			assert.deepStrictEqual(limitations(cell(["format: html"])), ["the preview compiles to SVG, not to html"]);
		});

		test("Should say nothing about a format the preview does produce", () => {
			assert.deepStrictEqual(limitations(cell(["format: svg"])), []);
			assert.deepStrictEqual(limitations(cell([])), []);
		});

		test("Should say that an asis cell inherits a page the preview cannot apply", () => {
			assert.deepStrictEqual(limitations(cell(["output: asis"])), [
				"an `output: asis` cell inherits the document page, which the preview cannot apply",
			]);
		});

		test("Should say that only the first page is shown when pages selects some", () => {
			assert.deepStrictEqual(limitations(cell(["pages: 2-3"])), ["the preview shows the first page only"]);
			assert.deepStrictEqual(limitations(cell(["pages: all"])), []);
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

	suite("readFrontMatter", () => {
		test("Should parse the mapping between the delimiters", () => {
			assert.deepStrictEqual(readFrontMatter("---\ntitle: A\n---\n\nBody\n"), { title: "A" });
		});

		test("Should parse a document written with CRLF", () => {
			assert.deepStrictEqual(readFrontMatter("---\r\ntitle: A\r\n---\r\n"), { title: "A" });
		});

		test("Should answer nothing for a document with no front matter", () => {
			assert.strictEqual(readFrontMatter("Body only.\n"), undefined);
			assert.strictEqual(readFrontMatter("---\ntitle: A\n"), undefined);
		});

		test("Should answer nothing for front matter that does not parse", () => {
			assert.strictEqual(readFrontMatter("---\na: [1,\n---\n"), undefined);
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
			assert.ok(isUnavailableRequest(request));
			assert.ok(request.unavailable.includes("cursor"));
		});

		test("Should assemble a plain block under the preview's own header", async () => {
			const document = await documentOf("```typst\n#circle()\n```\n");
			const request = await buildCompileRequest(document, new vscode.Position(1, 0), HEADER, NO_SCHEMA_CACHE);
			assert.ok(!isUnavailableRequest(request));
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
			assert.ok(!isUnavailableRequest(request));
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
			const brand = await readBrand(chain, directory);
			assert.strictEqual(brandColourReader(brand)("light", "background"), "#fdf6e3");
		});

		test("Should read the brand from the _brand directory when the root has none", async () => {
			asProject();
			write("_brand/_brand.yml", "color:\n  background: '#101418'\n");
			write("doc.qmd", "Body\n");

			const chain = await readMetadataChain(await open("doc.qmd"));
			const brand = await readBrand(chain, directory);
			assert.strictEqual(brandColourReader(brand)("light", "background"), "#101418");
		});

		test("Should honour a brand path the document names, relative to itself", async () => {
			asProject();
			write("_brand.yml", "color:\n  background: '#ffffff'\n");
			write("sub/theme.yml", "color:\n  background: '#101418'\n");
			write("sub/doc.qmd", "---\nbrand: theme.yml\n---\n\nBody\n");

			const chain = await readMetadataChain(await open("sub/doc.qmd"));
			const brand = await readBrand(chain, path.join(directory, "sub"));
			assert.strictEqual(brandColourReader(brand)("light", "background"), "#101418");
		});

		test("Should read a leading slash in a brand path as the project root", async () => {
			asProject();
			write("theme.yml", "color:\n  background: '#101418'\n");
			write("sub/doc.qmd", "---\nbrand: /theme.yml\n---\n\nBody\n");

			const chain = await readMetadataChain(await open("sub/doc.qmd"));
			const brand = await readBrand(chain, path.join(directory, "sub"));
			assert.strictEqual(brandColourReader(brand)("light", "background"), "#101418");
		});

		test("Should read no brand at all when the document disables it", async () => {
			asProject();
			write("_brand.yml", "color:\n  background: '#fdf6e3'\n");
			write("doc.qmd", "---\nbrand: false\n---\n\nBody\n");

			const chain = await readMetadataChain(await open("doc.qmd"));
			const brand = await readBrand(chain, directory);
			assert.strictEqual(brandColourReader(brand)("light", "background"), undefined);
		});

		test("Should take each mode from its own file when brand names a pair", async () => {
			asProject();
			write("light.yml", "color:\n  background: '#fdf6e3'\n");
			write("dark.yml", "color:\n  background: '#101418'\n");
			write("doc.qmd", "---\nbrand:\n  light: light.yml\n  dark: dark.yml\n---\n\nBody\n");

			const chain = await readMetadataChain(await open("doc.qmd"));
			const read = brandColourReader(await readBrand(chain, directory));
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
			const brand = await readBrand(chain, directory);
			assert.strictEqual(brandColourReader(brand)("light", "background"), undefined);
		});
	});
});
