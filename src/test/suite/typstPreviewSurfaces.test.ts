import * as assert from "assert";
import * as vscode from "vscode";
import { TypstPreviewController, type TypstCompilerLike } from "../../providers/typstPreview/typstPreviewController";
import type { TypstCompileResult } from "../../providers/typstPreview/typstCompiler";
import { TypstPreviewCodeLens } from "../../providers/typstPreview/typstPreviewCodeLens";
import { TypstPreviewHover } from "../../providers/typstPreview/typstPreviewHover";
import { TypstPreviewDecoration } from "../../providers/typstPreview/typstPreviewDecoration";
import {
	previewMaxHeight,
	previewSurface,
	type TypstPreviewSurface,
} from "../../providers/typstPreview/typstPreviewSettings";

/** An image that is never compiled, so nothing here spawns Typst. */
const SVG = '<svg viewBox="0 0 10 10" width="10pt" height="10pt"></svg>';

/** An image taller than the height the surfaces clamp to. */
const TALL_SVG = '<svg viewBox="0 0 10 1000" width="10pt" height="1000pt"></svg>';

/** A compiler that answers every compile with the same image. */
class StubCompiler implements TypstCompilerLike {
	readonly sources: string[] = [];

	constructor(private readonly result: TypstCompileResult) {}

	compile(source: string): Promise<TypstCompileResult> {
		this.sources.push(source);
		return Promise.resolve(this.result);
	}

	dispose(): void {
		/* Nothing is spawned, so there is nothing to kill. */
	}
}

/**
 * A decoration type that remembers whether it was disposed.
 *
 * Leaking decoration types is the classic bug in this pattern, and the only way
 * to see it is to hold the types the surface built. The real type is kept
 * inside, because `setDecorations` reads its key.
 */
class RecordedType implements vscode.TextEditorDecorationType {
	disposed = false;

	constructor(
		private readonly real: vscode.TextEditorDecorationType,
		readonly options: vscode.DecorationRenderOptions,
	) {}

	get key(): string {
		return this.real.key;
	}

	dispose(): void {
		this.disposed = true;
		this.real.dispose();
	}
}

/** A document holding one plain block, one raw block and one cell. */
const THREE_KINDS = [
	"# Title",
	"",
	"```typst",
	"#circle()",
	"```",
	"",
	"```{=typst}",
	"#let a = 1",
	"```",
	"",
	"```{typst}",
	"#square()",
	"```",
	"",
].join("\n");

/** The position inside the plain block of `THREE_KINDS`. */
const INSIDE_PLAIN = new vscode.Position(3, 1);

/** The position inside the raw block of `THREE_KINDS`. */
const INSIDE_RAW = new vscode.Position(7, 1);

async function quartoDocument(content: string): Promise<vscode.TextDocument> {
	return vscode.workspace.openTextDocument({ language: "quarto", content });
}

/** A controller wired to a stub, with one surface holding it open. */
function makeController(compiler: TypstCompilerLike): TypstPreviewController {
	const controller = new TypstPreviewController({
		show: () => {
			/* Nothing here asks a question, so nothing answers one. */
		},
		resolveBinary: () => Promise.resolve("/typst"),
		createCompiler: () => compiler,
	});
	controller.registerSurface();
	return controller;
}

/** Ask for one preview and wait for the result it publishes. */
function nextResultFor(
	controller: TypstPreviewController,
	document: vscode.TextDocument,
	position: vscode.Position,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			subscription.dispose();
			reject(new Error("no result was published"));
		}, 2000);
		const subscription = controller.onDidChangeResult(() => {
			clearTimeout(timer);
			subscription.dispose();
			resolve();
		});
		controller.request(document, position);
	});
}

/** Settings that answer the same way for every document. */
function fixedSettings(surface: TypstPreviewSurface, maxHeight = 200, codeLens = true) {
	return {
		surfaceOf: () => surface,
		maxHeightOf: () => maxHeight,
		codeLensOf: () => codeLens,
	};
}

const NO_CANCEL = new vscode.CancellationTokenSource().token;

suite("Typst Preview Surfaces Test Suite", () => {
	test("Should hold a surface setting inside the values it declares", () => {
		assert.strictEqual(previewSurface("inline"), "inline");
		assert.strictEqual(previewSurface("everywhere"), "panel");
		assert.strictEqual(previewSurface(undefined), "panel");
		assert.strictEqual(previewMaxHeight(0), 20);
		assert.strictEqual(previewMaxHeight("tall"), 200);
		assert.strictEqual(previewMaxHeight(500), 500);
	});

	test("Should offer one code lens per block, on its opening fence line", async () => {
		const controller = makeController(new StubCompiler({ svg: SVG, stderr: "" }));
		const lens = new TypstPreviewCodeLens(controller, fixedSettings("panel"));
		const document = await quartoDocument(THREE_KINDS);

		const lenses = lens.provideCodeLenses(document, NO_CANCEL);

		assert.strictEqual(lenses.length, 3);
		assert.deepStrictEqual(
			lenses.map((one) => one.range.start.line),
			[2, 6, 10],
		);
		lens.dispose();
		controller.dispose();
	});

	test("Should name an executable cell differently from a plain block", async () => {
		// The three fences look nearly identical and behave differently, so a title
		// that reads the same on all of them would hide the difference that matters.
		const controller = makeController(new StubCompiler({ svg: SVG, stderr: "" }));
		const lens = new TypstPreviewCodeLens(controller, fixedSettings("panel"));
		const document = await quartoDocument(THREE_KINDS);

		const titles = lens.provideCodeLenses(document, NO_CANCEL).map((one) => one.command?.title);

		assert.strictEqual(new Set(titles).size, 3, `titles are not distinct: ${titles.join(" | ")}`);
		lens.dispose();
		controller.dispose();
	});

	test("Should carry the block it means in the command arguments", async () => {
		// A lens previews its own block and not the one the cursor happens to be in.
		const controller = makeController(new StubCompiler({ svg: SVG, stderr: "" }));
		const lens = new TypstPreviewCodeLens(controller, fixedSettings("panel"));
		const document = await quartoDocument(THREE_KINDS);

		const [, raw] = lens.provideCodeLenses(document, NO_CANCEL);

		assert.strictEqual(raw.command?.command, "quartoWizard.previewTypstBlock");
		const [uri, position] = raw.command?.arguments as [vscode.Uri, vscode.Position];
		assert.strictEqual(uri.toString(), document.uri.toString());
		assert.strictEqual(position.line, 6);
		lens.dispose();
		controller.dispose();
	});

	test("Should offer no code lens when the setting turns it off", async () => {
		const controller = makeController(new StubCompiler({ svg: SVG, stderr: "" }));
		const off = new TypstPreviewCodeLens(controller, fixedSettings("panel", 200, false));
		const surfaceOff = new TypstPreviewCodeLens(controller, fixedSettings("off"));
		const document = await quartoDocument(THREE_KINDS);

		assert.deepStrictEqual(off.provideCodeLenses(document, NO_CANCEL), []);
		assert.deepStrictEqual(surfaceOff.provideCodeLenses(document, NO_CANCEL), []);
		off.dispose();
		surfaceOff.dispose();
		controller.dispose();
	});

	test("Should show the compiled image in a hover without awaiting a compile", async () => {
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const controller = makeController(compiler);
		const hover = new TypstPreviewHover(controller, fixedSettings("hover"));
		const document = await quartoDocument(THREE_KINDS);

		await nextResultFor(controller, document, INSIDE_PLAIN);
		const shown = hover.provideHover(document, INSIDE_PLAIN, NO_CANCEL);

		assert.ok(shown, "the compiled block has a hover");
		const markdown = shown.contents[0] as vscode.MarkdownString;
		assert.ok(markdown.value.includes("data:image/svg+xml;base64,"), `the hover carries no image: ${markdown.value}`);
		controller.dispose();
	});

	test("Should say a hover is compiling rather than waiting for the compile", async () => {
		// VS Code cancels a hover that takes around 500 milliseconds, and the reader
		// then sees nothing at all, so the answer is given before the image exists.
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const controller = makeController(compiler);
		const hover = new TypstPreviewHover(controller, fixedSettings("hover"));
		const document = await quartoDocument(THREE_KINDS);

		const shown = hover.provideHover(document, INSIDE_RAW, NO_CANCEL);

		assert.ok(shown, "a block with no image yet still has a hover");
		assert.ok(!(shown instanceof Promise), "the hover is answered without awaiting anything");
		const markdown = shown.contents[0] as vscode.MarkdownString;
		assert.ok(markdown.value.includes("Compiling"), `unexpected hover: ${markdown.value}`);

		// The compile it started is what makes the next hover instant.
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.strictEqual(compiler.sources.length, 1);
		controller.dispose();
	});

	test("Should point at the panel for an image too large to hover", async () => {
		const huge = `<svg width="10pt" height="10pt">${"x".repeat(400_000)}</svg>`;
		const controller = makeController(new StubCompiler({ svg: huge, stderr: "" }));
		const hover = new TypstPreviewHover(controller, fixedSettings("hover"));
		const document = await quartoDocument(THREE_KINDS);

		await nextResultFor(controller, document, INSIDE_PLAIN);
		const shown = hover.provideHover(document, INSIDE_PLAIN, NO_CANCEL);

		const markdown = (shown as vscode.Hover).contents[0] as vscode.MarkdownString;
		assert.ok(!markdown.value.includes("base64"), "an oversized image is not encoded into the hover");
		assert.ok(markdown.value.includes("panel"), `unexpected hover: ${markdown.value}`);
		controller.dispose();
	});

	test("Should offer no hover when the document asks for another surface", async () => {
		const controller = makeController(new StubCompiler({ svg: SVG, stderr: "" }));
		const hover = new TypstPreviewHover(controller, fixedSettings("panel"));
		const document = await quartoDocument(THREE_KINDS);

		await nextResultFor(controller, document, INSIDE_PLAIN);

		assert.strictEqual(hover.provideHover(document, INSIDE_PLAIN, NO_CANCEL), undefined);
		controller.dispose();
	});

	test("Should dispose the decoration type it replaces", async () => {
		// `createTextEditorDecorationType` bakes the image into the type, so a new
		// one is needed per image. Keeping the old one alive leaks a type per
		// keystroke, and every leaked type still paints.
		const types: RecordedType[] = [];
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const controller = makeController(compiler);
		const document = await quartoDocument(THREE_KINDS);
		await vscode.window.showTextDocument(document);
		const decoration = new TypstPreviewDecoration(controller, {
			...fixedSettings("inline"),
			createType: (options) => {
				const recorded = new RecordedType(vscode.window.createTextEditorDecorationType(options), options);
				types.push(recorded);
				return recorded;
			},
		});

		await nextResultFor(controller, document, INSIDE_PLAIN);
		await nextResultFor(controller, document, INSIDE_RAW);

		assert.strictEqual(types.length, 2, "one type per image");
		assert.ok(types[0].disposed, "the type it replaced is disposed");
		assert.ok(!types[1].disposed, "the type on screen is not");
		decoration.dispose();
		assert.ok(types[1].disposed, "disposing the surface takes the last type with it");
		controller.dispose();
	});

	test("Should clamp a tall image to the height the setting allows", async () => {
		const types: RecordedType[] = [];
		const controller = makeController(new StubCompiler({ svg: TALL_SVG, stderr: "" }));
		const document = await quartoDocument(THREE_KINDS);
		await vscode.window.showTextDocument(document);
		const decoration = new TypstPreviewDecoration(controller, {
			...fixedSettings("inline", 50),
			createType: (options) => {
				const recorded = new RecordedType(vscode.window.createTextEditorDecorationType(options), options);
				types.push(recorded);
				return recorded;
			},
		});

		await nextResultFor(controller, document, INSIDE_PLAIN);

		assert.strictEqual(types.length, 1);
		assert.strictEqual(types[0].options.after?.height, "50pt");
		decoration.dispose();
		controller.dispose();
	});

	test("Should render no decoration when the document asks for another surface", async () => {
		const types: RecordedType[] = [];
		const controller = makeController(new StubCompiler({ svg: SVG, stderr: "" }));
		const document = await quartoDocument(THREE_KINDS);
		await vscode.window.showTextDocument(document);
		const decoration = new TypstPreviewDecoration(controller, {
			...fixedSettings("panel"),
			createType: (options) => {
				const recorded = new RecordedType(vscode.window.createTextEditorDecorationType(options), options);
				types.push(recorded);
				return recorded;
			},
		});

		await nextResultFor(controller, document, INSIDE_PLAIN);

		assert.deepStrictEqual(types, []);
		decoration.dispose();
		controller.dispose();
	});
});
