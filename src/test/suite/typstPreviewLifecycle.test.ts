import * as assert from "assert";
import * as vscode from "vscode";
import {
	TypstPreviewController,
	type TypstCompilerLike,
	type TypstPreviewResult,
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

	dispose(): void {
		this.disposed = true;
	}
}

/** A document holding one plain Typst block, which needs nothing from disk. */
async function plainDocument(body = "#circle()"): Promise<vscode.TextDocument> {
	return vscode.workspace.openTextDocument({
		language: "quarto",
		content: `# Title\n\n\`\`\`typst\n${body}\n\`\`\`\n`,
	});
}

/** The position inside the one block of `plainDocument`. */
const INSIDE_BLOCK = new vscode.Position(3, 1);

/** A controller wired to a stub, with no surface unless the test says otherwise. */
function makeController(
	compiler: TypstCompilerLike,
	overrides: { hasSurface?: () => boolean; binary?: string | undefined } = {},
): { controller: TypstPreviewController; messages: string[] } {
	const messages: string[] = [];
	const controller = new TypstPreviewController({
		hasSurface: overrides.hasSurface ?? (() => true),
		show: (message) => messages.push(message),
		resolveBinary: () => Promise.resolve("binary" in overrides ? overrides.binary : "/typst"),
		createCompiler: () => compiler,
	});
	return { controller, messages };
}

/** The next result the controller publishes, or a rejection when none arrives. */
function nextResult(controller: TypstPreviewController, timeoutMs = 2000): Promise<TypstPreviewResult | undefined> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			subscription.dispose();
			reject(new Error("no result was published"));
		}, timeoutMs);
		const subscription = controller.onDidChangeResult((result) => {
			clearTimeout(timer);
			subscription.dispose();
			resolve(result);
		});
	});
}

/** Let every pending microtask and timer of the current pass run. */
function settle(delayMs = 50): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

suite("Typst Preview Lifecycle Test Suite", () => {
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
		const subscription = controller.onDidChangeResult((value) => {
			if (value) {
				later.push(value);
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
		const edit = new vscode.WorkspaceEdit();
		edit.insert(document.uri, new vscode.Position(3, 0), "#");
		assert.ok(await vscode.workspace.applyEdit(edit));

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
		const { controller } = makeController(compiler, { hasSurface: () => false });
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
		controller.clearCache();
		const again = nextResult(controller);
		controller.recompile();
		const result = await again;

		assert.strictEqual(result?.blockIndex, 0);
		assert.strictEqual(result?.asked, false);
		assert.strictEqual(compiler.sources.length, 2);
		controller.dispose();
	});

	test("Should compile again for a source the cache no longer holds", async () => {
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const { controller } = makeController(compiler);
		const document = await plainDocument();

		await nextResultFor(controller, document);
		controller.clearCache();
		await nextResultFor(controller, document);

		assert.strictEqual(compiler.sources.length, 2);
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
