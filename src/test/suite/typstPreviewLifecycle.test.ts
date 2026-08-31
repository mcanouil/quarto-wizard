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

/** The position inside the one block of `plainDocument`. */
const INSIDE_BLOCK = new vscode.Position(3, 1);

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
			controller.refresh();
			await settle();
			assert.strictEqual(messages.length, 1);
		} finally {
			await config.update("surface", undefined, vscode.ConfigurationTarget.Global);
			controller.dispose();
		}
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
): Promise<TypstPreviewResult | undefined> {
	const published = nextResult(controller);
	controller.request(document, INSIDE_BLOCK);
	return published;
}
