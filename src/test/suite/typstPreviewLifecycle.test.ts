import * as assert from "assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import {
	CACHE_LIMIT,
	TypstPreviewController,
	type TypstCompilerLike,
	type TypstPreviewResult,
	type TypstPreviewUpdate,
} from "../../providers/typstPreview/typstPreviewController";
import type { TypstCompileResult } from "../../providers/typstPreview/typstCompiler";
import { invalidateProjectRoots, setProjectRoots } from "../../utils/projectRootsRegistry";
import { invalidateInstalledExtensionsCache } from "../../utils/installedExtensionsCache";
import { makeFolder, makeRoot } from "./projectFixtures";

/** An image that is never compiled, so nothing here spawns Typst. */
const SVG = '<svg width="10pt" height="10pt"></svg>';

/**
 * A compiler whose every answer is given by the test.
 *
 * Continuous integration has no Quarto and must never spawn Typst, and the
 * lifecycle is about which results are published rather than about what Typst
 * writes, so nothing is lost by answering from a queue.
 */
class StubCompiler implements TypstCompilerLike {
	readonly sources: string[] = [];
	disposed = false;
	/** The pending compiles, in the order they were asked for. */
	private readonly pending: ((result: TypstCompileResult) => void)[] = [];
	/** What an unanswered compile resolves to, when the test does not answer it. */
	private readonly automatic: TypstCompileResult | undefined;

	constructor(automatic?: TypstCompileResult) {
		this.automatic = automatic;
	}

	compile(source: string): Promise<TypstCompileResult> {
		this.sources.push(source);
		if (this.automatic !== undefined) {
			return Promise.resolve(this.automatic);
		}
		return new Promise<TypstCompileResult>((resolve) => this.pending.push(resolve));
	}

	/** Answer the compile that was asked for at `index`. */
	answer(index: number, result: TypstCompileResult): void {
		const resolve = this.pending[index];
		assert.ok(resolve, `no compile was asked for at index ${index}`);
		resolve(result);
	}

	/** Answer every compile asked for so far. */
	answerAll(result: TypstCompileResult): void {
		assert.ok(this.pending.length > 0, "no compile was asked for");
		for (const resolve of this.pending) {
			resolve(result);
		}
	}

	dispose(): void {
		this.disposed = true;
	}
}

/** The text of a document holding one plain Typst block, which needs nothing from disk. */
function plainText(body = "#circle()"): string {
	return `# Title\n\n\`\`\`typst\n${body}\n\`\`\`\n`;
}

/** A document holding one plain Typst block, which needs nothing from disk. */
async function plainDocument(body = "#circle()"): Promise<vscode.TextDocument> {
	return vscode.workspace.openTextDocument({ language: "quarto", content: plainText(body) });
}

/**
 * The same document, written to disk as a `.qmd`.
 *
 * An untitled document is neither named `.qmd` nor given the `quarto` language,
 * which is contributed by another extension, so the cursor-driven path does not
 * recognise it as a document this feature previews.
 */
async function plainFile(body = "#circle()"): Promise<vscode.TextDocument> {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "typst-preview-"));
	written.push(directory);
	const file = path.join(directory, "doc.qmd");
	fs.writeFileSync(file, plainText(body));
	return vscode.workspace.openTextDocument(vscode.Uri.file(file));
}

/** The directories `plainFile` made, removed when the suite is over. */
const written: string[] = [];

/**
 * A document holding one `{typst}` cell, in a project that has `typst-render`.
 *
 * A cell is the only kind that resolves a colour from a brand, so it is the only
 * kind the brand mode command works on, and the install gate refuses a cell in a
 * project without the extension.
 */
async function cellDocument(): Promise<vscode.TextDocument> {
	const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "typst-preview-cell-")));
	written.push(directory);
	fs.writeFileSync(path.join(directory, "_quarto.yml"), "project:\n  type: default\n");
	const manifest = path.join(directory, "_extensions", "mcanouil", "typst-render");
	fs.mkdirSync(manifest, { recursive: true });
	fs.writeFileSync(
		path.join(manifest, "_extension.yml"),
		"title: Typst Render\nauthor: Mickael Canouil\nversion: 0.21.0\ncontributes:\n  filters:\n    - typst-render.lua\n",
	);
	const file = path.join(directory, "doc.qmd");
	fs.writeFileSync(file, "```{typst}\n//| margin: 2mm\n#circle()\n```\n");
	setProjectRoots([makeRoot(makeFolder("typst-preview-cell", directory))]);
	return vscode.workspace.openTextDocument(vscode.Uri.file(file));
}

/** The position inside the one block of `plainDocument`. */
const INSIDE_BLOCK = new vscode.Position(3, 1);

/** The position inside the one cell of `cellDocument`. */
const INSIDE_CELL = new vscode.Position(2, 0);

/** The position inside the second block of `twoBlockFile`. */
const SECOND_BLOCK = new vscode.Position(7, 1);

/**
 * A `.qmd` on disk holding two plain blocks.
 *
 * Written to disk and not left untitled, because the cursor-driven path only
 * follows a document the editor calls a Quarto one.
 */
async function twoBlockFile(): Promise<vscode.TextDocument> {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "typst-preview-two-"));
	written.push(directory);
	const file = path.join(directory, "doc.qmd");
	fs.writeFileSync(file, "# Title\n\n```typst\n#circle()\n```\n\n```typst\n#square()\n```\n");
	return vscode.workspace.openTextDocument(vscode.Uri.file(file));
}

/** A controller wired to a stub, with a surface showing unless the test says otherwise. */
function makeController(
	compiler: TypstCompilerLike,
	overrides: { surface?: boolean; binary?: string | undefined } = {},
): { controller: TypstPreviewController; messages: string[]; showing: { value: boolean } } {
	const messages: string[] = [];
	const showing = { value: overrides.surface !== false };
	const controller = new TypstPreviewController({
		hasSurface: () => showing.value,
		show: (message) => messages.push(message),
		resolveBinary: () => Promise.resolve("binary" in overrides ? overrides.binary : "/typst"),
		createCompiler: () => compiler,
	});
	return { controller, messages, showing };
}

/** The next result the controller publishes, or a rejection when none arrives. */
function nextResult(controller: TypstPreviewController, timeoutMs = 2000): Promise<TypstPreviewResult | undefined> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			subscription.dispose();
			reject(new Error("no result was published"));
		}, timeoutMs);
		const subscription = controller.onDidChangeResult((update) => {
			clearTimeout(timer);
			subscription.dispose();
			resolve(update.result);
		});
	});
}

/** Edit the one block of a document, so the next request cannot answer from the cache. */
async function editBlock(document: vscode.TextDocument, text = "#"): Promise<void> {
	const edit = new vscode.WorkspaceEdit();
	edit.insert(document.uri, new vscode.Position(3, 0), text);
	assert.ok(await vscode.workspace.applyEdit(edit));
}

/** Let every pending microtask and timer of the current pass run. */
function settle(delayMs = 50): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

suite("Typst Preview Lifecycle Test Suite", () => {
	teardown(async () => {
		// `cellDocument` names a project root and reads the extensions installed in
		// it, and both are held for the session, so a later test would read the
		// project of an earlier one.
		invalidateProjectRoots();
		invalidateInstalledExtensionsCache();
		// An editor left open is a cursor the next test did not put anywhere, and
		// the cursor is what several of these paths follow.
		await vscode.commands.executeCommand("workbench.action.closeAllEditors");
	});

	suiteTeardown(() => {
		for (const directory of written) {
			fs.rmSync(directory, { recursive: true, force: true });
		}
		written.length = 0;
	});

	test("Should publish the compiled image of the block under the cursor", async () => {
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const { controller } = makeController(compiler);
		const document = await plainDocument();

		const published = nextResult(controller);
		controller.request(document, INSIDE_BLOCK);
		const result = await published;

		assert.strictEqual(result?.svg, SVG);
		assert.strictEqual(result?.error, undefined);
		assert.strictEqual(result?.block.kind, "plain");
		assert.ok(result?.header.includes("line 3"));
		assert.strictEqual(controller.current()?.svg, SVG);
		controller.dispose();
	});

	test("Should compile once for a source it has already compiled", async () => {
		// A cache hit is what makes typing a character and undoing it free, and it
		// is what lets a hover answer without waiting for a compile.
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const { controller } = makeController(compiler);
		const document = await plainDocument();

		const first = nextResult(controller);
		controller.request(document, INSIDE_BLOCK);
		await first;
		const second = nextResult(controller);
		controller.request(document, INSIDE_BLOCK);
		await second;

		assert.strictEqual(compiler.sources.length, 1);
		controller.dispose();
	});

	test("Should discard the result of a superseded request", async () => {
		// The compiler kills its own running child, so the older compile answers
		// nothing in production. It is answered here anyway, because a result that
		// arrives out of order must be dropped by the counter and not by luck.
		const compiler = new StubCompiler();
		const { controller } = makeController(compiler);
		const document = await plainDocument();
		const other = await plainDocument("#square()");

		controller.request(document, INSIDE_BLOCK);
		await settle();
		controller.request(other, INSIDE_BLOCK);
		await settle();
		assert.strictEqual(compiler.sources.length, 2);

		const published = nextResult(controller);
		compiler.answer(1, { svg: SVG, stderr: "" });
		const result = await published;
		assert.ok(result?.svg);

		// The superseded compile answers last, and its result is stale.
		const later: TypstPreviewResult[] = [];
		const subscription = controller.onDidChangeResult((update) => {
			if (update.result) {
				later.push(update.result);
			}
		});
		compiler.answer(0, { svg: "<svg id='stale'/>", stderr: "" });
		await settle();
		assert.deepStrictEqual(later, []);
		subscription.dispose();
		controller.dispose();
	});

	test("Should keep the last good image behind a failure of the same block", async () => {
		const compiler = new StubCompiler();
		const { controller } = makeController(compiler);
		const document = await plainDocument();

		const good = nextResult(controller);
		controller.request(document, INSIDE_BLOCK);
		await settle();
		compiler.answer(0, { svg: SVG, stderr: "" });
		await good;

		// The block is edited, or the second request would answer from the cache.
		await editBlock(document);

		const failed = nextResult(controller);
		controller.request(document, INSIDE_BLOCK);
		await settle();
		compiler.answer(1, { stderr: "error: expected expression\n  ┌─ <stdin>:3:1\n  │\n" });
		const result = await failed;

		assert.strictEqual(result?.svg, SVG, "the last good image stays on screen");
		assert.ok(result?.error?.startsWith("error"), `unexpected error text: ${result?.error}`);
		controller.dispose();
	});

	test("Should drop the last good image when the block under the cursor changes", async () => {
		// An error of one block over the image of another says nothing true about
		// either of them.
		const compiler = new StubCompiler();
		const { controller } = makeController(compiler);
		const document = await vscode.workspace.openTextDocument({
			language: "quarto",
			content: "```typst\n#circle()\n```\n\n```typst\n#square()\n```\n",
		});

		const good = nextResult(controller);
		controller.request(document, new vscode.Position(1, 1));
		await settle();
		compiler.answer(0, { svg: SVG, stderr: "" });
		await good;

		const failed = nextResult(controller);
		controller.request(document, new vscode.Position(5, 1));
		await settle();
		compiler.answer(1, { stderr: "error: expected expression\n  ┌─ <stdin>:3:1\n  │\n" });
		const result = await failed;

		assert.strictEqual(result?.svg, undefined);
		assert.ok(result?.error);
		controller.dispose();
	});

	test("Should not compile for a background change when no surface is showing", async () => {
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const { controller } = makeController(compiler, { surface: false });
		const document = await plainDocument();

		controller.refresh();
		await settle();
		assert.strictEqual(compiler.sources.length, 0);

		// The command is not a background change, so it compiles anyway.
		const published = nextResult(controller);
		controller.request(document, INSIDE_BLOCK);
		await published;
		assert.strictEqual(compiler.sources.length, 1);
		controller.dispose();
	});

	test("Should compile nothing for a document whose surface is off", async () => {
		// The gate is here and not in each surface, because this is what spawns the
		// process. With the gate in the surfaces alone, an open panel went on
		// compiling every edit in a folder that had turned the feature off.
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const { controller, messages } = makeController(compiler);
		const document = await plainDocument();
		const config = vscode.workspace.getConfiguration("quartoWizard.typstPreview");
		await config.update("surface", "off", vscode.ConfigurationTarget.Global);

		try {
			controller.request(document, INSIDE_BLOCK);
			await settle();

			assert.strictEqual(compiler.sources.length, 0);
			assert.strictEqual(messages.length, 1, `unexpected messages: ${messages.join(" | ")}`);
			assert.ok(messages[0].includes("surface"), `the message does not name the setting: ${messages[0]}`);

			// An edit is not a question, so it is refused without saying anything.
			// `refresh` follows the active editor, so without showing the document it
			// would return before it ever reached the gate this is about.
			await vscode.window.showTextDocument(document);
			controller.refresh();
			await settle();
			assert.strictEqual(messages.length, 1);
		} finally {
			await config.update("surface", undefined, vscode.ConfigurationTarget.Global);
			controller.dispose();
		}
	});

	test("Should take the preview away when the surface is turned off", async () => {
		// The gate stops the compiles, which is what it is for, but a panel that is
		// already open would otherwise keep an image that has silently stopped
		// tracking the document: live-looking and frozen, with nothing said.
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const { controller } = makeController(compiler);
		const document = await plainDocument();
		const config = vscode.workspace.getConfiguration("quartoWizard.typstPreview");

		await nextResultFor(controller, document);
		assert.ok(controller.current(), "there is a preview to take away");

		const cleared = nextResult(controller);
		await config.update("surface", "off", vscode.ConfigurationTarget.Global);
		try {
			assert.strictEqual(await cleared, undefined);
			assert.strictEqual(controller.current(), undefined);
		} finally {
			await config.update("surface", undefined, vscode.ConfigurationTarget.Global);
			controller.dispose();
		}
	});

	test("Should take away a tracked preview a hover has moved off", async () => {
		// The tracked preview and the last compile can be two documents, because a
		// hover compiles a block the panel does not follow. Asking only about the
		// last compile would leave the panel holding an image of a document that
		// stopped being previewed: live-looking and frozen, with nothing said.
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const { controller } = makeController(compiler);
		const document = await plainDocument("#circle()");
		const hovered = await plainDocument("#square()");
		const config = vscode.workspace.getConfiguration("quartoWizard.typstPreview");

		await nextResultFor(controller, document);
		await controller.preview(hovered, INSIDE_BLOCK);
		assert.strictEqual(controller.current()?.uri.toString(), hovered.uri.toString());
		assert.strictEqual(controller.shown()?.uri.toString(), document.uri.toString());

		const cleared = nextResult(controller);
		await config.update("surface", "off", vscode.ConfigurationTarget.Global);
		try {
			// Nothing, and not the block the pointer rested on: a surface given that
			// would move to a document the reader never asked it to show.
			assert.strictEqual(await cleared, undefined);
			assert.notStrictEqual(controller.shown()?.uri.toString(), document.uri.toString());
		} finally {
			await config.update("surface", undefined, vscode.ConfigurationTarget.Global);
			controller.dispose();
		}
	});

	test("Should follow an edit of the block on screen after a hover over another", async () => {
		// The edit gate asks whether the change reaches the block being previewed.
		// Asking about the last compile instead reads an edit inside the block on
		// screen as an edit of a block that is nowhere, and leaves the panel stale.
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const { controller } = makeController(compiler);
		const document = await twoBlockFile();

		await vscode.window.showTextDocument(document, { selection: new vscode.Range(INSIDE_BLOCK, INSIDE_BLOCK) });
		await settle(500);
		// A pointer rest on the second block, which the panel does not follow.
		await controller.preview(document, SECOND_BLOCK);
		const before = compiler.sources.length;

		await editBlock(document);
		await settle(700);

		assert.ok(compiler.sources.length > before, "the edited block compiled again");
		controller.dispose();
	});

	test("Should say once that there is no Typst binary", async () => {
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const { controller, messages } = makeController(compiler, { binary: undefined });
		const document = await plainDocument();

		controller.request(document, INSIDE_BLOCK);
		await settle();
		controller.request(document, INSIDE_BLOCK);
		await settle();

		assert.strictEqual(messages.length, 1, `unexpected messages: ${messages.join(" | ")}`);
		assert.ok(messages[0].includes("Typst binary"));
		assert.strictEqual(compiler.sources.length, 0);
		controller.dispose();
	});

	test("Should say where there is no block, and only when the user asked", async () => {
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const { controller, messages } = makeController(compiler);
		const document = await plainDocument();

		controller.request(document, new vscode.Position(0, 0));
		await settle();
		assert.strictEqual(messages.length, 1);
		assert.ok(messages[0].includes("Typst block"));
		assert.strictEqual(compiler.sources.length, 0);
		controller.dispose();
	});

	test("Should leave nothing behind when it is disposed", async () => {
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const { controller } = makeController(compiler);
		const document = await plainDocument();

		const published = nextResult(controller);
		controller.request(document, INSIDE_BLOCK);
		await published;

		controller.dispose();
		assert.ok(compiler.disposed, "the compiler is disposed, which kills any live child");
		assert.strictEqual(controller.current(), undefined);

		// A request after disposal is not a second lifetime.
		controller.request(document, INSIDE_BLOCK);
		await settle();
		assert.strictEqual(compiler.sources.length, 1);
	});

	test("Should recompile the block on screen rather than the one under the cursor", async () => {
		// A theme, a setting or a file the preview reads changing changes the image
		// of the block being looked at. The cursor may have moved on to a document
		// with no block in it at all, so following it would leave the surface
		// showing an image nothing recompiled.
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const { controller } = makeController(compiler);
		const document = await plainDocument();

		await nextResultFor(controller, document);
		// Edited, so the block on screen has a source the cache cannot answer, and
		// there is no active editor at all for `refresh` to have followed.
		await editBlock(document);
		const again = nextResult(controller);
		controller.recompile();
		const result = await again;

		assert.strictEqual(result?.blockIndex, 0);
		assert.strictEqual(compiler.sources.length, 2);
		assert.ok(compiler.sources[1].includes("##circle()"), `unexpected source: ${compiler.sources[1]}`);
		controller.dispose();
	});

	test("Should carry the source it compiled, so a reader can reproduce it", async () => {
		// This is what makes the feature supportable: the exact source pasted into
		// `typst compile` reproduces the failure outside the editor.
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const { controller } = makeController(compiler);
		const document = await plainDocument();

		const result = await nextResultFor(controller, document);

		assert.strictEqual(result?.source, compiler.sources[0]);
		assert.ok(result?.source.includes("#circle()"));
		controller.dispose();
	});

	test("Should compile again from nothing when the preview is reloaded", async () => {
		// A reload is what a reader runs when the image and the document disagree,
		// so it has to outrank the cache. Answering the same block from the cache
		// would make the command look as though it did nothing.
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const { controller } = makeController(compiler);
		const document = await plainDocument();

		await nextResultFor(controller, document);
		assert.strictEqual(compiler.sources.length, 1);

		const again = nextResult(controller);
		controller.reload();
		const result = await again;

		assert.strictEqual(result?.blockIndex, 0);
		assert.strictEqual(compiler.sources.length, 2);
		controller.dispose();
	});

	test("Should keep every other remembered image when the preview is reloaded", async () => {
		// The reader asked for one block. Emptying the cache would make every other
		// block previewed in the session spawn Typst again on the next hover.
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const { controller } = makeController(compiler);
		const first = await plainDocument("#circle()");
		const second = await plainDocument("#square()");

		await nextResultFor(controller, first);
		await nextResultFor(controller, second);
		assert.strictEqual(compiler.sources.length, 2);

		const reloaded = nextResult(controller);
		controller.reload();
		await reloaded;
		assert.strictEqual(compiler.sources.length, 3, "the block on screen compiled again");

		await nextResultFor(controller, first);
		assert.strictEqual(compiler.sources.length, 3, "the other block answered from the cache");
		controller.dispose();
	});

	test("Should not answer from an image a reload asked it to stop trusting", async () => {
		// A reload compiles again, and another request can supersede that compile
		// before it is remembered. The entry the reader distrusted would otherwise
		// still be there for the next request that assembles the same source.
		const compiler = new StubCompiler();
		const { controller } = makeController(compiler);
		const document = await plainDocument("#circle()");
		const other = await plainDocument("#square()");

		const first = nextResult(controller);
		controller.request(document, INSIDE_BLOCK);
		await settle();
		compiler.answer(0, { svg: SVG, stderr: "" });
		await first;

		controller.reload();
		await settle();
		controller.request(other, INSIDE_BLOCK);
		await settle();
		assert.strictEqual(compiler.sources.length, 3);
		compiler.answerAll({ svg: SVG, stderr: "" });
		await settle();

		controller.request(document, INSIDE_BLOCK);
		await settle();
		assert.strictEqual(compiler.sources.length, 4, "the superseded entry was not left behind");
		controller.dispose();
	});

	test("Should keep the image of the tracked block when a hover compiled another", async () => {
		// A hover moves the last compile without moving what the panel shows. A
		// failure of the block on screen has to keep that block's own last image,
		// or the panel flashes empty on almost every keystroke after a pointer rest.
		const compiler = new StubCompiler();
		const { controller } = makeController(compiler);
		const document = await plainDocument("#circle()");
		const other = await plainDocument("#square()");

		const shown = nextResult(controller);
		controller.request(document, INSIDE_BLOCK);
		await settle();
		compiler.answer(0, { svg: SVG, stderr: "" });
		await shown;

		const hovered = controller.preview(other, INSIDE_BLOCK);
		await settle();
		compiler.answer(1, { svg: '<svg width="20pt" height="20pt"></svg>', stderr: "" });
		await hovered;

		await editBlock(document);
		const failed = nextResult(controller);
		controller.request(document, INSIDE_BLOCK);
		await settle();
		compiler.answer(2, { stderr: "error: <stdin>:2:0: unexpected" });
		const result = await failed;

		assert.strictEqual(result?.svg, SVG);
		assert.ok(result?.error);
		controller.dispose();
	});

	test("Should say what to do when a reload has nothing to compile", async () => {
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const { controller, messages } = makeController(compiler);

		controller.reload();
		await settle();

		assert.strictEqual(compiler.sources.length, 0);
		assert.strictEqual(messages.length, 1);
		assert.ok(messages[0].includes("Typst block"), `unexpected message: ${messages[0]}`);
		controller.dispose();
	});

	test("Should switch a cell to the other side of the brand, and back on a reload", async () => {
		// The command exists so that a reader can see the side the editor theme is
		// not showing. The side has to reach the compiled source, and a refresh has
		// to be the way back to following the theme.
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const { controller } = makeController(compiler);
		const document = await cellDocument();

		const first = await nextResultFor(controller, document, INSIDE_CELL);
		const mode = first?.brandMode;
		assert.ok(mode === "light" || mode === "dark", `unexpected mode: ${String(mode)}`);

		const switched = nextResult(controller);
		controller.toggleBrandMode();
		assert.strictEqual((await switched)?.brandMode, mode === "dark" ? "light" : "dark");

		const reloaded = nextResult(controller);
		controller.reload();
		assert.strictEqual((await reloaded)?.brandMode, mode, "a reload follows the theme again");
		controller.dispose();
	});

	test("Should refuse to switch the brand mode of a block that has none", async () => {
		// Only a cell resolves colours against a brand. A plain block carries the
		// preview's own header, so there is no other side to show.
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const { controller, messages } = makeController(compiler);
		const document = await plainDocument();

		await nextResultFor(controller, document);
		controller.toggleBrandMode();
		await settle();

		assert.strictEqual(compiler.sources.length, 1);
		assert.strictEqual(messages.length, 1);
		assert.ok(messages[0].includes("cell"), `unexpected message: ${messages[0]}`);
		controller.dispose();
	});

	test("Should drop a background result whose surface closed while it compiled", async () => {
		// A compile runs for up to the timeout and the reader can close the panel
		// meanwhile. Publishing anyway would have the surface build itself again,
		// which reopens a panel the reader just closed.
		const compiler = new StubCompiler();
		const { controller, showing } = makeController(compiler);
		const document = await plainFile();

		// Driven through the cursor, which is what a background request follows.
		// Showing the document is itself an event the controller acts on, so the
		// count is not pinned: what matters is that something is in flight.
		await vscode.window.showTextDocument(document, { selection: new vscode.Range(INSIDE_BLOCK, INSIDE_BLOCK) });
		await settle();
		controller.refresh();
		await settle();
		assert.ok(compiler.sources.length >= 1, "a background compile is in flight");

		const published: TypstPreviewUpdate[] = [];
		const subscription = controller.onDidChangeResult((update) => published.push(update));
		showing.value = false;
		compiler.answerAll({ svg: SVG, stderr: "" });
		await settle();

		assert.deepStrictEqual(published, []);
		subscription.dispose();
		controller.dispose();
	});

	test("Should report a failure to read the context rather than rejecting", async () => {
		// Every caller starts a request and does not await it, so a throw on the way
		// to the compiler would be an unhandled rejection: no log line, no message,
		// and a preview that looks inert.
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const messages: string[] = [];
		const controller = new TypstPreviewController({
			hasSurface: () => true,
			show: (message) => messages.push(message),
			resolveBinary: () => Promise.reject(new Error("the probe failed")),
			createCompiler: () => compiler,
		});
		const document = await plainDocument();

		controller.request(document, INSIDE_BLOCK);
		await settle();

		assert.deepStrictEqual(messages, ["the probe failed"]);
		assert.strictEqual(compiler.sources.length, 0);
		controller.dispose();
	});

	test("Should forget the result used longest ago once the cache is full", async () => {
		// The cache is what makes an undone keystroke free, and it is bounded, so a
		// long session cannot grow it without end. The first source compiled is the
		// first one forgotten.
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const { controller } = makeController(compiler);
		const documents = [];
		for (let index = 0; index <= CACHE_LIMIT; index++) {
			documents.push(await plainDocument(`#circle(radius: ${index}pt)`));
		}

		for (const document of documents) {
			await nextResultFor(controller, document);
		}
		assert.strictEqual(compiler.sources.length, CACHE_LIMIT + 1);

		// The last one asked for is still held, and the first one is not.
		await nextResultFor(controller, documents[CACHE_LIMIT]);
		assert.strictEqual(compiler.sources.length, CACHE_LIMIT + 1);
		await nextResultFor(controller, documents[0]);
		assert.strictEqual(compiler.sources.length, CACHE_LIMIT + 2);
		controller.dispose();
	});

	test("Should keep the cache under its byte budget, and never empty", async () => {
		// The count alone is not a bound: one compile may produce megabytes, so a
		// handful of dense pages would hold far more than the count suggests. One
		// entry is kept whatever its size, or a block larger than the whole budget
		// would recompile on every request that already has its answer.
		const big = `<svg>${"x".repeat(600)}</svg>`;
		const compiler = new StubCompiler({ svg: big, stderr: "" });
		const messages: string[] = [];
		const controller = new TypstPreviewController({
			hasSurface: () => true,
			show: (message) => messages.push(message),
			resolveBinary: () => Promise.resolve("/typst"),
			createCompiler: () => compiler,
			cacheLimitBytes: 1000,
		});
		const first = await plainDocument("#circle()");
		const second = await plainDocument("#square()");

		await nextResultFor(controller, first);
		await nextResultFor(controller, second);
		assert.strictEqual(compiler.sources.length, 2);

		// Two images are over the budget, so the older one went and the newer stayed.
		await nextResultFor(controller, second);
		assert.strictEqual(compiler.sources.length, 2, "the newest entry survives the eviction");
		await nextResultFor(controller, first);
		assert.strictEqual(compiler.sources.length, 3, "the oldest entry was evicted");
		controller.dispose();
	});

	test("Should say nothing is previewed when the document closes", async () => {
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const { controller } = makeController(compiler);
		const document = await plainDocument();

		await nextResultFor(controller, document);
		assert.ok(controller.current());

		const cleared = nextResult(controller);
		// Closing a document is what the editor reports; the test asks for it by
		// showing the document and then closing its editor.
		await vscode.window.showTextDocument(document, { preview: true });
		await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
		assert.strictEqual(await cleared, undefined);
		assert.strictEqual(controller.current(), undefined);
		controller.dispose();
	});
});

/** Ask for one preview and wait for the result it publishes. */
async function nextResultFor(
	controller: TypstPreviewController,
	document: vscode.TextDocument,
	position: vscode.Position = INSIDE_BLOCK,
): Promise<TypstPreviewResult | undefined> {
	const published = nextResult(controller);
	controller.request(document, position);
	return published;
}
