import * as assert from "assert";
import * as vscode from "vscode";
import { TypstPreviewController, type TypstCompilerLike } from "../../providers/typstPreview/typstPreviewController";
import type { TypstCompileResult } from "../../providers/typstPreview/typstCompiler";
import { TypstPreviewCodeLens } from "../../providers/typstPreview/typstPreviewCodeLens";
import { TypstPreviewHover } from "../../providers/typstPreview/typstPreviewHover";
import {
	previewCodeLens,
	previewMaxHeight,
	previewSurface,
	type TypstPreviewSurface,
	type TypstSurfaceSettings,
} from "../../providers/typstPreview/typstPreviewSettings";

/** An image that is never compiled, so nothing here spawns Typst. */
const SVG = '<svg viewBox="0 0 10 10" width="10pt" height="10pt"></svg>';

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

/** A controller wired to a stub, with a surface showing. */
function makeController(compiler: TypstCompilerLike): TypstPreviewController {
	return new TypstPreviewController({
		hasSurface: () => true,
		show: () => {
			/* Nothing here asks a question, so nothing answers one. */
		},
		resolveBinary: () => Promise.resolve("/typst"),
		createCompiler: () => compiler,
	});
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
function fixedSettings(surface: TypstPreviewSurface, maxHeight = 200, codeLens = true): () => TypstSurfaceSettings {
	return () => ({ surface, maxHeight, codeLens });
}

const NO_CANCEL = new vscode.CancellationTokenSource().token;

/** Let every pending microtask and timer of the current pass run. */
function settle(delayMs = 50): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/** The markdown of a hover, which every assertion here reads. */
function hoverText(hover: vscode.Hover | undefined): string {
	assert.ok(hover, "expected a hover");
	return (hover.contents[0] as vscode.MarkdownString).value;
}

suite("Typst Preview Surfaces Test Suite", () => {
	test("Should hold a surface setting inside the values it declares", () => {
		assert.strictEqual(previewSurface("hover"), "hover");
		assert.strictEqual(previewSurface("off"), "off");
		// `inline` was a value once and cannot render without an editor API that
		// VS Code does not expose, so a settings file still holding it falls back.
		assert.strictEqual(previewSurface("inline"), "panel");
		assert.strictEqual(previewSurface("everywhere"), "panel");
		assert.strictEqual(previewSurface(undefined), "panel");
		assert.strictEqual(previewMaxHeight(0), 20);
		assert.strictEqual(previewMaxHeight("tall"), 200);
		assert.strictEqual(previewMaxHeight(500), 500);
		// A hand-edited `settings.json` reaches this unchecked, and the string
		// "false" is truthy, so a cast alone would turn the lens back on.
		assert.strictEqual(previewCodeLens(false), false);
		assert.strictEqual(previewCodeLens("false"), true);
		assert.strictEqual(previewCodeLens(undefined), true);
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

	test("Should compile and show the image in one hover", async () => {
		// The hover used to answer with a compiling message and leave the image to
		// the next hover, so every block took two passes to read. VS Code has no
		// hover timeout: it shows its own loading message and updates the widget
		// when a late result arrives, so the compile is awaited instead.
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const controller = makeController(compiler);
		const hover = new TypstPreviewHover(controller, fixedSettings("hover"));
		const document = await quartoDocument(THREE_KINDS);

		const shown = await hover.provideHover(document, INSIDE_RAW, NO_CANCEL);

		assert.ok(
			hoverText(shown).includes("data:image/svg+xml;base64,"),
			`no image in the first hover: ${hoverText(shown)}`,
		);
		assert.strictEqual(compiler.sources.length, 1);
		controller.dispose();
	});

	test("Should compile for a hover even when nothing is showing a preview", async () => {
		// A hover renders nothing until the pointer rests, so it is not a surface
		// that makes a background edit worth compiling. It still has to be able to
		// drive a compile of its own, or the surface would never show anything.
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const controller = new TypstPreviewController({
			hasSurface: () => false,
			show: () => {
				/* Nothing here asks a question. */
			},
			resolveBinary: () => Promise.resolve("/typst"),
			createCompiler: () => compiler,
		});
		const hover = new TypstPreviewHover(controller, fixedSettings("hover"));
		const document = await quartoDocument(THREE_KINDS);

		const shown = await hover.provideHover(document, INSIDE_PLAIN, NO_CANCEL);

		assert.ok(hoverText(shown).includes("data:image/svg+xml;base64,"));
		assert.strictEqual(compiler.sources.length, 1);
		controller.dispose();
	});

	test("Should not serve a hover the image of the block before it was edited", async () => {
		// With the hover as the only surface nothing recompiles in the background,
		// so the held result outlives the text it describes. Matching on the block's
		// place alone served the pre-edit image until the pointer visited another
		// block. The compile cache still answers a source it has seen, so asking
		// again costs nothing when the edit is undone.
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const controller = new TypstPreviewController({
			hasSurface: () => false,
			show: () => {
				/* Nothing here asks a question. */
			},
			resolveBinary: () => Promise.resolve("/typst"),
			createCompiler: () => compiler,
		});
		const hover = new TypstPreviewHover(controller, fixedSettings("hover"));
		const document = await quartoDocument(THREE_KINDS);

		await hover.provideHover(document, INSIDE_PLAIN, NO_CANCEL);
		assert.strictEqual(compiler.sources.length, 1);

		const edit = new vscode.WorkspaceEdit();
		edit.insert(document.uri, new vscode.Position(3, 0), "#");
		assert.ok(await vscode.workspace.applyEdit(edit));

		await hover.provideHover(document, INSIDE_PLAIN, NO_CANCEL);

		assert.strictEqual(compiler.sources.length, 2, "the edited block is compiled again");
		assert.ok(compiler.sources[1].includes("##circle()"), `unexpected source: ${compiler.sources[1]}`);
		controller.dispose();
	});

	test("Should stamp a result with the version of the text it compiled", async () => {
		// The version has to be read where the text is read. Taken at publish time
		// it describes the document as it is when Typst finishes, so an edit landing
		// during a compile stamped the new version onto the old image, and the check
		// above then validated that image for every later hover on the block. The
		// window is the whole compile, up to the timeout.
		const sources: string[] = [];
		let answer: ((result: TypstCompileResult) => void) | undefined;
		const compiler: TypstCompilerLike = {
			compile: (source: string) => {
				sources.push(source);
				return new Promise<TypstCompileResult>((resolve) => {
					answer = resolve;
				});
			},
			dispose: () => {
				/* Nothing is spawned. */
			},
		};
		const controller = new TypstPreviewController({
			hasSurface: () => false,
			show: () => {
				/* Nothing here asks a question. */
			},
			resolveBinary: () => Promise.resolve("/typst"),
			createCompiler: () => compiler,
		});
		const hover = new TypstPreviewHover(controller, fixedSettings("hover"));
		const document = await quartoDocument(THREE_KINDS);

		const pending = hover.provideHover(document, INSIDE_PLAIN, NO_CANCEL);
		await settle();
		const edit = new vscode.WorkspaceEdit();
		edit.insert(document.uri, new vscode.Position(3, 0), "#");
		assert.ok(await vscode.workspace.applyEdit(edit));
		answer?.({ svg: SVG, stderr: "" });
		await pending;
		assert.strictEqual(sources.length, 1);

		// Started and not awaited: the point is that it asks Typst at all, and this
		// stub answers only when the test tells it to.
		void hover.provideHover(document, INSIDE_PLAIN, NO_CANCEL);
		await settle();

		assert.strictEqual(sources.length, 2, "the held image is of text that has since changed");
		controller.dispose();
	});

	test("Should carry a compile failure into the hover as plain text", async () => {
		// A Typst message carries backticks, underscores and asterisks, so it is
		// written as text: rendering it as markdown would change what it says.
		const stderr = "error: unknown variable: _x_\n  ┌─ <stdin>:3:1\n  │\n";
		const controller = makeController(new StubCompiler({ stderr }));
		const hover = new TypstPreviewHover(controller, fixedSettings("hover"));
		const document = await quartoDocument(THREE_KINDS);

		const shown = await hover.provideHover(document, INSIDE_PLAIN, NO_CANCEL);

		assert.ok(hoverText(shown).includes("unknown"), `no diagnostic in the hover: ${hoverText(shown)}`);
		// Escaped rather than rendered: `_x_` would otherwise reach the reader as
		// italic `x`, which is not the name Typst could not find.
		assert.ok(hoverText(shown).includes("\\_x\\_"), `the message was rendered as markdown: ${hoverText(shown)}`);
		assert.ok(!hoverText(shown).includes("base64"), "a failed compile carries no image");
		controller.dispose();
	});

	test("Should not retarget an open panel from a pointer rest", async () => {
		// The panel follows the cursor. A hover compiles through the same controller,
		// so without saying why it was compiled the panel would jump to whatever
		// block the pointer touched, which is not a cursor move.
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const controller = makeController(compiler);
		const hover = new TypstPreviewHover(controller, fixedSettings("hover"));
		const document = await quartoDocument(THREE_KINDS);
		const updates: string[] = [];
		const subscription = controller.onDidChangeResult((update) => updates.push(update.reason));

		await hover.provideHover(document, INSIDE_RAW, NO_CANCEL);

		assert.deepStrictEqual(updates, ["surface"], "a hover says it is the one that asked");
		subscription.dispose();
		controller.dispose();
	});

	test("Should answer from the preview on screen without compiling again", async () => {
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const controller = makeController(compiler);
		const hover = new TypstPreviewHover(controller, fixedSettings("hover"));
		const document = await quartoDocument(THREE_KINDS);

		await nextResultFor(controller, document, INSIDE_PLAIN);
		const shown = await hover.provideHover(document, INSIDE_PLAIN, NO_CANCEL);

		assert.ok(hoverText(shown).includes("data:image/svg+xml;base64,"));
		assert.strictEqual(compiler.sources.length, 1, "the block on screen is not compiled a second time");
		controller.dispose();
	});

	test("Should give up a hover the pointer has already left", async () => {
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const controller = makeController(compiler);
		const hover = new TypstPreviewHover(controller, fixedSettings("hover"));
		const document = await quartoDocument(THREE_KINDS);
		const cancelled = new vscode.CancellationTokenSource();
		cancelled.cancel();

		const shown = await hover.provideHover(document, INSIDE_PLAIN, cancelled.token);

		assert.strictEqual(shown, undefined);
		assert.strictEqual(compiler.sources.length, 0, "a hover nobody is waiting for compiles nothing");
		controller.dispose();
	});

	test("Should point at the panel for an image too large to hover", async () => {
		const huge = `<svg width="10pt" height="10pt">${"x".repeat(400_000)}</svg>`;
		const controller = makeController(new StubCompiler({ svg: huge, stderr: "" }));
		const hover = new TypstPreviewHover(controller, fixedSettings("hover"));
		const document = await quartoDocument(THREE_KINDS);

		const shown = await hover.provideHover(document, INSIDE_PLAIN, NO_CANCEL);

		assert.ok(!hoverText(shown).includes("base64"), "an oversized image is not encoded into the hover");
		assert.ok(hoverText(shown).includes("panel"), `unexpected hover: ${hoverText(shown)}`);
		controller.dispose();
	});

	test("Should offer no hover when the document asks for another surface", async () => {
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const controller = makeController(compiler);
		const hover = new TypstPreviewHover(controller, fixedSettings("panel"));
		const document = await quartoDocument(THREE_KINDS);

		await nextResultFor(controller, document, INSIDE_PLAIN);

		assert.strictEqual(await hover.provideHover(document, INSIDE_PLAIN, NO_CANCEL), undefined);
		controller.dispose();
	});

	test("Should offer no hover outside a Typst block", async () => {
		const controller = makeController(new StubCompiler({ svg: SVG, stderr: "" }));
		const hover = new TypstPreviewHover(controller, fixedSettings("hover"));
		const document = await quartoDocument(THREE_KINDS);

		assert.strictEqual(await hover.provideHover(document, new vscode.Position(0, 0), NO_CANCEL), undefined);
		controller.dispose();
	});
});
