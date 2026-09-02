import * as assert from "assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { findTypstBlocks, type TypstBlock } from "../../utils/typst/typstBlocks";
import { EMPTY_BRAND, brandColourReader, splitBrand } from "../../utils/typst/typstBrand";
import { mergeGlobalConfigs, resolveTypstOptions, type TypstGlobalLevel } from "../../utils/typst/typstOptions";
import { buildCell, cellNotes, isUnavailable, resolvePreamble } from "../../utils/typst/typstSource";
import {
	buildCompileRequest,
	isNewerThanPinned,
	PINNED_TYPST_RENDER_VERSION,
	TypstContextCache,
} from "../../providers/typstPreview/typstContext";
import { readBrand, readMetadataChain } from "../../providers/typstPreview/typstMetadata";
import { resolveQuartoPath } from "../../utils/typst/typstPaths";
import { invalidateProjectRoots, setProjectRoots } from "../../utils/projectRootsRegistry";
import { invalidateInstalledExtensionsCache } from "../../utils/installedExtensionsCache";
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
			// A fixture drives the assembly from strings alone, so it names no place
			// on disk, and the command it builds carries no root.
			paths: {},
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

		test("Should compile the body and name no file when a file option is empty", async () => {
			// An empty `file:` skips the read, so the body is what compiles. Reporting
			// it as the external file would print a position with no name beside it
			// and drop the option run correction that the body needs.
			const built = await buildCell(cell(['file: ""']), context);
			assert.ok(!isUnavailable(built));
			assert.strictEqual(built.externalFile, undefined);
			assert.ok(built.source.endsWith("#circle()"));
		});

		test("Should ignore a boolean where a string option is expected", async () => {
			// `true` and `false` become booleans, which `preamble:` and `file:` are
			// never written with. Passing one through raised a `TypeError` from
			// inside the assembler, so the reader was shown a JavaScript message in
			// place of the block.
			const preamble = await buildCell(cell(["preamble: false"]), context);
			assert.ok(!isUnavailable(preamble));
			assert.ok(preamble.source.endsWith("\n#circle()"));

			const file = await buildCell(cell(["file: true"]), context);
			assert.ok(!isUnavailable(file));
			assert.strictEqual(file.externalFile, undefined);
			assert.ok(file.source.endsWith("\n#circle()"));
		});

		test("Should say that it ignored an option that is not text", async () => {
			// The render reads the option whatever it holds, so an image built
			// without it is not the image the render produces. Dropping it in
			// silence would leave the reader with no way to see that.
			const built = await buildCell(cell(["file: true", "preamble: false"]), context);
			assert.ok(!isUnavailable(built));
			assert.deepStrictEqual(
				built.notes.filter((note) => note.includes("was ignored")),
				["the `preamble` option is not text and was ignored", "the `file` option is not text and was ignored"],
			);
		});

		test("Should say so when a file option cannot be read", async () => {
			// The filter renders nothing here. A blank image with no reason beside
			// it would look like the block itself was empty.
			const built = await buildCell(cell(["file: missing.typ"]), context);
			assert.ok(isUnavailable(built));
			assert.ok(built.unavailable.includes("missing.typ"));
		});

		test("Should note an option line the run below it does not read", async () => {
			// `code-cell.lua:110-118` warns and leaves the line as code. The two
			// spellings look the same in the block, so the note is what says which
			// one this is.
			const block = cell(["margin: 2mm"], "#circle()\n//| width: 3cm");
			const built = await buildCell(block, context);
			assert.ok(!isUnavailable(built));
			assert.ok(built.notes.some((note) => note.includes("compiled as code")));
		});

		test("Should not note a late option line the file option threw away", async () => {
			// A `file:` replaces the body outright, so the line below the run is not
			// compiled at all and a note saying that it is would be wrong.
			const block = cell(["file: diagram.typ"], "#circle()\n//| width: 3cm");
			const built = await buildCell(block, { ...context, readFile: reader({ "diagram.typ": "#rect()\n" }) });
			assert.ok(!isUnavailable(built));
			assert.ok(!built.notes.some((note) => note.includes("compiled as code")));
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

		test("Should ignore a block-level root and font path, which are global-only", async () => {
			// `typst-render.lua:1284-1293` reads these from the global configuration
			// alone, so a block writing one changes neither the source nor the command.
			// The document sits somewhere on disk here, or every command would carry
			// no root and the comparison would hold for the wrong reason.
			const placed = { ...context, paths: { projectRoot: "/p", documentDirectory: path.join("/p", "posts") } };
			const plain = await buildCell(cell([]), placed);
			const rooted = await buildCell(cell(["root: ../assets"]), placed);
			const fonted = await buildCell(cell(["font-path: /other"]), placed);
			assert.ok(!isUnavailable(plain) && !isUnavailable(rooted) && !isUnavailable(fonted));
			assert.deepStrictEqual(plain.command.argv, [
				"compile",
				"--format",
				"svg",
				"--root",
				path.join("/p", "posts"),
				"-",
				"-",
			]);
			assert.deepStrictEqual(rooted.command, plain.command);
			assert.deepStrictEqual(fonted.command, plain.command);
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

		/** An open document holding the given text. */
		async function documentOf(text: string): Promise<vscode.TextDocument> {
			return vscode.workspace.openTextDocument({ language: "quarto", content: text });
		}

		/** A temporary project, with `typst-render` installed when asked. */
		function project(withExtension: boolean | "ownerless"): string {
			const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "typst-gate-")));
			fs.writeFileSync(path.join(directory, "_quarto.yml"), "project:\n  type: default\n");
			if (withExtension) {
				// An extension installed from a repository sits under its owner, and a
				// copy placed by hand sits straight under `_extensions`. Discovery
				// reports the second with no owner, and the gate has to accept both.
				const manifest =
					withExtension === "ownerless"
						? path.join(directory, "_extensions", "typst-render")
						: path.join(directory, "_extensions", "mcanouil", "typst-render");
				fs.mkdirSync(manifest, { recursive: true });
				fs.writeFileSync(
					path.join(manifest, "_extension.yml"),
					"title: Typst Render\nauthor: Mickael Canouil\nversion: 0.21.0\ncontributes:\n  filters:\n    - typst-render.lua\n",
				);
			}
			setProjectRoots([makeRoot(makeFolder("typst-gate", directory))]);
			return directory;
		}

		/** The one cell document every gate test previews. */
		const CELL = "```{typst}\n//| margin: 2mm\n#circle()\n```\n";

		teardown(() => {
			invalidateProjectRoots();
			invalidateInstalledExtensionsCache();
		});

		test("Should assemble a cell when the project has typst-render installed", async () => {
			const directory = project(true);
			try {
				fs.writeFileSync(path.join(directory, "doc.qmd"), CELL);
				const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(directory, "doc.qmd")));
				const request = await buildCompileRequest(document, new vscode.Position(2, 0), HEADER, new TypstContextCache());
				assert.ok(!isUnavailable(request));
				// The filter's own contract, and not the preview's theme header: the
				// bindings and the page directive come from the options in force.
				assert.ok(request.source.includes("#let _typst_render_background = none"));
				assert.ok(request.source.includes("margin: 2mm"));
				assert.ok(!request.source.includes(HEADER));
				// The option run is in the document but not in the compiled source, so
				// a diagnostic has to have it added back.
				assert.strictEqual(request.bodyLineOffset, 1);
				assert.ok(request.brandMode === "light" || request.brandMode === "dark");
			} finally {
				fs.rmSync(directory, { recursive: true, force: true });
			}
		});

		test("Should resolve a cell against the brand mode the caller names", async () => {
			// The toggle command is how a reader sees the other side of a brand, so the
			// mode it names wins over the theme the preview would follow by itself.
			const directory = project(true);
			try {
				fs.writeFileSync(path.join(directory, "doc.qmd"), CELL);
				const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(directory, "doc.qmd")));
				const cache = new TypstContextCache();
				const light = await buildCompileRequest(document, new vscode.Position(2, 0), HEADER, cache, "light");
				const dark = await buildCompileRequest(document, new vscode.Position(2, 0), HEADER, cache, "dark");
				assert.ok(!isUnavailable(light));
				assert.ok(!isUnavailable(dark));
				assert.strictEqual(light.brandMode, "light");
				assert.strictEqual(dark.brandMode, "dark");
			} finally {
				fs.rmSync(directory, { recursive: true, force: true });
			}
		});

		test("Should let the named brand mode win over the one the document sets", async () => {
			// A document that names a mode still gets the other side on request. The
			// toggle would otherwise do nothing at all in exactly the documents whose
			// author thought about the brand.
			const directory = project(true);
			try {
				fs.writeFileSync(path.join(directory, "doc.qmd"), `---\nbrand-mode: light\n---\n\n${CELL}`);
				const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(directory, "doc.qmd")));
				const cache = new TypstContextCache();
				const followed = await buildCompileRequest(document, new vscode.Position(6, 0), HEADER, cache);
				const named = await buildCompileRequest(document, new vscode.Position(6, 0), HEADER, cache, "dark");
				assert.ok(!isUnavailable(followed));
				assert.ok(!isUnavailable(named));
				assert.strictEqual(followed.brandMode, "light");
				assert.strictEqual(named.brandMode, "dark");
			} finally {
				fs.rmSync(directory, { recursive: true, force: true });
			}
		});

		test("Should assemble a cell when typst-render is installed with no owner", async () => {
			const directory = project("ownerless");
			try {
				fs.writeFileSync(path.join(directory, "doc.qmd"), CELL);
				const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(directory, "doc.qmd")));
				const request = await buildCompileRequest(document, new vscode.Position(2, 0), HEADER, new TypstContextCache());
				assert.ok(!isUnavailable(request));
			} finally {
				fs.rmSync(directory, { recursive: true, force: true });
			}
		});

		test("Should refuse a cell when the project has no typst-render", async () => {
			// Never previewed with guessed options: an image compiled without the
			// extension's own defaults is not the image the render produces.
			const directory = project(false);
			try {
				fs.writeFileSync(path.join(directory, "doc.qmd"), CELL);
				const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(directory, "doc.qmd")));
				const request = await buildCompileRequest(document, new vscode.Position(2, 0), HEADER, new TypstContextCache());
				assert.ok(isUnavailable(request));
				assert.ok(request.unavailable.includes("typst-render"));
			} finally {
				fs.rmSync(directory, { recursive: true, force: true });
			}
		});

		test("Should still preview a plain block in a project with no typst-render", async () => {
			// The gate is the cell's alone. A plain block is never executed by Quarto,
			// so the extension has nothing to do with it.
			const directory = project(false);
			try {
				fs.writeFileSync(path.join(directory, "doc.qmd"), "```typst\n#circle()\n```\n");
				const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(directory, "doc.qmd")));
				const request = await buildCompileRequest(document, new vscode.Position(1, 0), HEADER, new TypstContextCache());
				assert.ok(!isUnavailable(request));
				assert.strictEqual(request.source, `${HEADER}\n#circle()\n`);
			} finally {
				fs.rmSync(directory, { recursive: true, force: true });
			}
		});

		test("Should root a cell at its own directory and run from the project", async () => {
			// The source reaches Typst on stdin, so the root is what every relative
			// path the cell reads resolves against. Without it a cell reading a file
			// beside its document searches the working directory of the extension
			// host, which is where this whole slice went wrong.
			const directory = project(true);
			try {
				const posts = path.join(directory, "posts");
				fs.mkdirSync(posts);
				fs.writeFileSync(path.join(posts, "doc.qmd"), CELL);
				const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(posts, "doc.qmd")));
				const request = await buildCompileRequest(document, new vscode.Position(2, 0), HEADER, new TypstContextCache());
				assert.ok(!isUnavailable(request));
				assert.deepStrictEqual(request.command.argv, ["compile", "--format", "svg", "--root", posts, "-", "-"]);
				assert.strictEqual(request.command.cwd, directory);
			} finally {
				fs.rmSync(directory, { recursive: true, force: true });
			}
		});

		test("Should carry the root and the font path the configuration names", async () => {
			const directory = project(true);
			try {
				const text = [
					"---",
					"extensions:",
					"  typst-render:",
					"    root: /",
					"    font-path: /assets/fonts",
					"---",
					"",
					CELL,
				].join("\n");
				fs.writeFileSync(path.join(directory, "doc.qmd"), text);
				const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(directory, "doc.qmd")));
				const request = await buildCompileRequest(document, new vscode.Position(9, 0), HEADER, new TypstContextCache());
				assert.ok(!isUnavailable(request));
				assert.deepStrictEqual(request.command.argv, [
					"compile",
					"--format",
					"svg",
					"--root",
					directory,
					"--font-path",
					path.join(directory, "assets", "fonts"),
					"-",
					"-",
				]);
			} finally {
				fs.rmSync(directory, { recursive: true, force: true });
			}
		});

		test("Should root a plain block at the directory of its document", async () => {
			// A plain block never reaches the filter, so it reads no option of it. The
			// directory of the document is the whole answer, and it costs no read.
			const directory = project(false);
			try {
				fs.writeFileSync(path.join(directory, "doc.qmd"), "```typst\n#circle()\n```\n");
				const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(directory, "doc.qmd")));
				const request = await buildCompileRequest(document, new vscode.Position(1, 0), HEADER, new TypstContextCache());
				assert.ok(!isUnavailable(request));
				assert.deepStrictEqual(request.command.argv, ["compile", "--format", "svg", "--root", directory, "-", "-"]);
				assert.strictEqual(request.command.cwd, directory);
			} finally {
				fs.rmSync(directory, { recursive: true, force: true });
			}
		});

		test("Should carry no root for a document that is not a file on disk", async () => {
			const document = await documentOf("```typst\n#circle()\n```\n");
			const request = await buildCompileRequest(document, new vscode.Position(1, 0), HEADER, new TypstContextCache());
			assert.ok(!isUnavailable(request));
			assert.deepStrictEqual(request.command.argv, ["compile", "--format", "svg", "-", "-"]);
			assert.strictEqual(request.command.cwd, undefined);
		});

		test("Should say so when the cursor is in no block", async () => {
			const document = await documentOf("Prose only.\n");
			const request = await buildCompileRequest(document, new vscode.Position(0, 0), HEADER, new TypstContextCache());
			assert.ok(isUnavailable(request));
			assert.ok(request.unavailable.includes("cursor"));
		});

		test("Should assemble a plain block under the preview's own header", async () => {
			const document = await documentOf("```typst\n#circle()\n```\n");
			const request = await buildCompileRequest(document, new vscode.Position(1, 0), HEADER, new TypstContextCache());
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
			const request = await buildCompileRequest(document, new vscode.Position(5, 0), HEADER, new TypstContextCache());
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

		test("Should splice a metadata-files target above the level that named it", async () => {
			// Quarto merges the included metadata over the file that included it, so
			// the target wins against its own declaring level and loses to every level
			// above it.
			asProject();
			write(
				"_quarto.yml",
				"metadata-files:\n  - shared.yml\nextensions:\n  typst-render:\n    margin: 1cm\n    width: 6cm\n",
			);
			write("shared.yml", "extensions:\n  typst-render:\n    margin: 2cm\n");
			write("sub/_metadata.yml", "extensions:\n  typst-render:\n    width: 9cm\n");
			write("sub/doc.qmd", "Body\n");

			const chain = await readMetadataChain(await open("sub/doc.qmd"));
			assert.deepStrictEqual(chain.levels, [{ margin: "1cm", width: "6cm" }, { margin: "2cm" }, { width: "9cm" }]);
		});

		test("Should not read a metadata-files target another document named", async () => {
			// The registry aggregates every target declared anywhere under the project
			// root, so a chain built from it would merge this file into a preview of
			// the other document and show an image its render never produces.
			asProject();
			write("a/doc-a.qmd", "---\nmetadata-files:\n  - opts.yml\n---\n\nBody\n");
			write("a/opts.yml", 'extensions:\n  typst-render:\n    background: "#000000"\n');
			write("b/doc-b.qmd", "Body\n");
			// Open the other document, so a registry-driven chain would have seen it.
			await open("a/doc-a.qmd");

			const chain = await readMetadataChain(await open("b/doc-b.qmd"));
			assert.deepStrictEqual(chain.levels, []);
		});

		test("Should read a metadata-files target the document itself names", async () => {
			asProject();
			write("sub/opts.yml", "extensions:\n  typst-render:\n    margin: 3cm\n");
			write("sub/doc.qmd", "---\nmetadata-files:\n  - opts.yml\n---\n\nBody\n");

			const chain = await readMetadataChain(await open("sub/doc.qmd"));
			assert.deepStrictEqual(chain.levels, [{ margin: "3cm" }]);
		});

		test("Should resolve a brand a project metadata-files target names from the root", async () => {
			// The target was pulled in by `_quarto.yml`, so it is project metadata and
			// its `brand:` resolves from the project root, not from the directory of
			// whichever document is being previewed.
			asProject();
			write("_quarto.yml", "metadata-files:\n  - shared.yml\n");
			write("shared.yml", "brand: theme/x.yml\n");
			write("theme/x.yml", "color:\n  background: '#101418'\n");
			write("sub/doc.qmd", "Body\n");

			const chain = await readMetadataChain(await open("sub/doc.qmd"));
			const brand = await readBrand(chain);
			assert.strictEqual(brandColourReader(brand)("light", "background"), "#101418");
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

	suite("TypstContextCache", () => {
		/** One document, as the cache sees it: a URI, a version and its text. */
		function document(version: number): vscode.TextDocument {
			return { uri: vscode.Uri.file("/doc.qmd"), version } as vscode.TextDocument;
		}

		const FRONT_MATTER = "---\ntitle: One\n---\n\n";

		test("Should read the disk again only when the front matter moves", async () => {
			// The metadata chain reads the front matter and then the disk, so an edit
			// to a block leaves every answer it gave unchanged. Keying on the document
			// version instead would walk the whole project on every keystroke.
			const cache = new TypstContextCache();
			const first = cache.cellContext(document(1), `${FRONT_MATTER}Body\n`);
			const again = cache.cellContext(document(2), `${FRONT_MATTER}Body and more\n`);
			assert.strictEqual(await again, await first, "a body edit reads nothing again");

			const moved = cache.cellContext(document(3), "---\ntitle: Two\n---\n\nBody\n");
			assert.notStrictEqual(await moved, await first, "a front matter edit reads again");
		});

		test("Should read the document again when its version moves", async () => {
			// The blocks are a function of the whole text, so the version is the whole
			// key, which is the half of the cache the front matter does not decide.
			const cache = new TypstContextCache();
			const first = cache.blocksOf(document(1), () => "```typst\n#circle()\n```\n");
			assert.strictEqual(
				cache.blocksOf(document(1), () => "```typst\n#circle()\n```\n"),
				first,
			);
			assert.notStrictEqual(
				cache.blocksOf(document(2), () => "```typst\n#square()\n```\n"),
				first,
			);
		});

		test("Should forget what a file changing can move, and keep the rest", async () => {
			const cache = new TypstContextCache();
			const blocks = cache.blocksOf(document(1), () => "```typst\n#circle()\n```\n");
			const context = await cache.cellContext(document(1), `${FRONT_MATTER}Body\n`);

			cache.forgetFiles();
			assert.strictEqual(
				cache.blocksOf(document(1), () => "```typst\n#circle()\n```\n"),
				blocks,
			);
			assert.notStrictEqual(await cache.cellContext(document(1), `${FRONT_MATTER}Body\n`), context);
		});
	});
});
