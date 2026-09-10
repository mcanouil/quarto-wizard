import * as assert from "assert";
import * as vscode from "vscode";
import { TypstPreviewController, type TypstCompilerLike } from "../../providers/typstPreview/typstPreviewController";
import type { TypstCompileResult } from "../../providers/typstPreview/typstCompiler";
import type { TypstCommand } from "../../utils/typst/typstCli";
import { pngHeader } from "./pngFixtures";
import { TypstPreviewCodeLens } from "../../providers/typstPreview/typstPreviewCodeLens";
import { TypstPreviewHover } from "../../providers/typstPreview/typstPreviewHover";
import {
	previewCodeLens,
	previewMaxHeight,
	previewSurfaces,
	type TypstPreviewSurface,
	type TypstSurfaceSettings,
} from "../../providers/typstPreview/typstPreviewSettings";

/** An image that is never compiled, so nothing here spawns Typst. */
const SVG = '<svg viewBox="0 0 10 10" width="10pt" height="10pt"></svg>';

/** A raster of a page that fits the hover whole, at twice the height shown. */
const PNG = pngHeader(20, 20);

/**
 * A compiler that answers every compile with the same image.
 *
 * Answers in the format the command asks for, the way Typst does, so a hover
 * asking for a raster is not handed a vector it cannot read.
 */
class StubCompiler implements TypstCompilerLike {
	readonly sources: string[] = [];
	readonly commands: TypstCommand[] = [];

	/** What the next compile answers with, so one test can make a block fail. */
	next: TypstCompileResult | undefined;

	private readonly raster: TypstCompileResult;

	constructor(
		private readonly result: TypstCompileResult,
		raster?: TypstCompileResult,
		private readonly rasterFor?: (ppi: number) => TypstCompileResult,
	) {
		// A compiler that cannot compile a block cannot compile it in either
		// format, so a stub given a failure fails whichever one is asked for.
		this.raster = raster ?? (result.svg === undefined ? { stderr: result.stderr } : { png: PNG, stderr: "" });
	}

	compile(source: string, command: TypstCommand): Promise<TypstCompileResult> {
		this.sources.push(source);
		this.commands.push(command);
		if (this.next !== undefined) {
			return Promise.resolve(this.next);
		}
		if (command.format !== "png") {
			return Promise.resolve(this.result);
		}
		return Promise.resolve(this.rasterFor?.(ppiOf(command)) ?? this.raster);
	}

	dispose(): void {
		/* Nothing is spawned, so there is nothing to kill. */
	}
}

/** The resolution one compile asked for, which decides how sharp it is. */
function ppiOf(command: TypstCommand): number {
	const at = command.argv.indexOf("--ppi");
	return at === -1 ? 0 : Number(command.argv[at + 1]);
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
function fixedSettings(
	surfaces: readonly TypstPreviewSurface[],
	maxHeight = 200,
	codeLens = true,
): () => TypstSurfaceSettings {
	return () => ({ surfaces: new Set(surfaces), maxHeight, codeLens });
}

/** Settings a test can change between hovers, as a reader changes a setting. */
function mutableSettings(surfaces: readonly TypstPreviewSurface[], maxHeight: number) {
	const state = { surfaces: new Set(surfaces), maxHeight, codeLens: true };
	return { read: () => state, set: (height: number) => (state.maxHeight = height) };
}

const NO_CANCEL = new vscode.CancellationTokenSource().token;

/** Let every pending microtask and timer of the current pass run. */
function settle(delayMs = 50): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * The markdown of a hover, which every assertion here reads.
 *
 * Every part, because an image and a compiler message travel as two, so that
 * the one that enables HTML carries nothing a compiler wrote.
 */
function hoverText(hover: vscode.Hover | undefined): string {
	assert.ok(hover, "expected a hover");
	return (hover.contents as vscode.MarkdownString[]).map((part) => part.value).join("\n\n");
}

/** The parts of a hover, for an assertion about which part holds what. */
function hoverParts(hover: vscode.Hover | undefined): vscode.MarkdownString[] {
	assert.ok(hover, "expected a hover");
	return hover.contents as vscode.MarkdownString[];
}

suite("Typst Preview Surfaces Test Suite", () => {
	test("Should hold a surface setting inside the values it declares", () => {
		assert.deepStrictEqual([...previewSurfaces(["panel", "hover"])], ["panel", "hover"]);
		assert.deepStrictEqual([...previewSurfaces(["hover"])], ["hover"]);
		// An empty list is the value that turns the feature off, and it replaces the
		// enum value `off` that the setting held before.
		assert.deepStrictEqual([...previewSurfaces([])], []);
		// A member the extension does not know is dropped, and the rest is kept.
		assert.deepStrictEqual([...previewSurfaces(["hover", "everywhere"])], ["hover"]);
		// A settings file written against an older version holds a string.
		assert.deepStrictEqual([...previewSurfaces("hover")], ["hover"]);
		assert.deepStrictEqual([...previewSurfaces("off")], []);
		// `inline` was a value once and never rendered anything, so it falls back.
		assert.deepStrictEqual([...previewSurfaces("inline")], ["panel"]);
		assert.deepStrictEqual([...previewSurfaces(undefined)], ["panel"]);
		assert.deepStrictEqual([...previewSurfaces(7)], ["panel"]);
		// A non-string member is filtered out the same way an unknown one is, and
		// the fallback applies once that leaves nothing, because the input itself
		// was not empty.
		assert.deepStrictEqual([...previewSurfaces([7])], ["panel"]);
		assert.deepStrictEqual([...previewSurfaces([null])], ["panel"]);
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
		const lens = new TypstPreviewCodeLens(controller, fixedSettings(["panel"]));
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
		const lens = new TypstPreviewCodeLens(controller, fixedSettings(["panel"]));
		const document = await quartoDocument(THREE_KINDS);

		const titles = lens.provideCodeLenses(document, NO_CANCEL).map((one) => one.command?.title);

		assert.strictEqual(new Set(titles).size, 3, `titles are not distinct: ${titles.join(" | ")}`);
		lens.dispose();
		controller.dispose();
	});

	test("Should carry the block it means in the command arguments", async () => {
		// A lens previews its own block and not the one the cursor happens to be in.
		const controller = makeController(new StubCompiler({ svg: SVG, stderr: "" }));
		const lens = new TypstPreviewCodeLens(controller, fixedSettings(["panel"]));
		const document = await quartoDocument(THREE_KINDS);

		const [, raw] = lens.provideCodeLenses(document, NO_CANCEL);

		assert.strictEqual(raw.command?.command, "quartoWizard.previewTypstBlock");
		const [uri, position] = raw.command?.arguments as [vscode.Uri, vscode.Position];
		assert.strictEqual(uri.toString(), document.uri.toString());
		assert.strictEqual(position.line, 6);
		lens.dispose();
		controller.dispose();
	});

	test("Should offer no code lens above an inline span", async () => {
		// A lens sits above a line of its own, and an inline span shares its line
		// with prose, so there is no line a lens could take. The document holds the
		// three fences the lens already covers, plus one inline cell, and the lens
		// list must not grow past the three.
		const controller = makeController(new StubCompiler({ svg: SVG, stderr: "" }));
		const lens = new TypstPreviewCodeLens(controller, fixedSettings(["panel"]));
		const document = await quartoDocument(THREE_KINDS + "\nValue: `{typst} #calc.pi`.\n");

		const lenses = lens.provideCodeLenses(document, NO_CANCEL);

		assert.strictEqual(lenses.length, 3);
		lens.dispose();
		controller.dispose();
	});

	test("Should offer no code lens when the setting turns it off", async () => {
		const controller = makeController(new StubCompiler({ svg: SVG, stderr: "" }));
		const off = new TypstPreviewCodeLens(controller, fixedSettings(["panel"], 200, false));
		const surfaceOff = new TypstPreviewCodeLens(controller, fixedSettings([]));
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
		const hover = new TypstPreviewHover(controller, fixedSettings(["hover"]));
		const document = await quartoDocument(THREE_KINDS);

		const shown = await hover.provideHover(document, INSIDE_RAW, NO_CANCEL);

		assert.ok(hoverText(shown).includes("data:image/png;base64,"), `no image in the first hover: ${hoverText(shown)}`);
		assert.strictEqual(compiler.sources.length, 1);
		controller.dispose();
	});

	test("Should centre the image inside the hover", async () => {
		// The widget is wider than the image, because it reserves room for its copy
		// button and because VS Code merges the hovers of several providers into
		// one. An image left where it falls sits against the left edge of all that.
		const controller = makeController(new StubCompiler({ svg: SVG, stderr: "" }));
		const hover = new TypstPreviewHover(controller, fixedSettings(["hover"]));
		const document = await quartoDocument(THREE_KINDS);

		const shown = await hover.provideHover(document, INSIDE_PLAIN, NO_CANCEL);

		const [image] = hoverParts(shown);
		assert.ok(image.value.includes('<div align="center">'), `the image is not centred: ${image.value}`);
		assert.strictEqual(image.supportHtml, true, "a centred image needs the markdown string to allow HTML");
		controller.dispose();
	});

	test("Should keep a failure out of the HTML part when both reach one hover", async () => {
		// A failure keeps the last good image of the same block behind it, so a
		// hover can carry an image and a message at once. That is the case the
		// split exists for, and the one where merging them would be a defect. It is
		// also the ordinary one: a working block edited into a broken one.
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const controller = makeController(compiler);
		const hover = new TypstPreviewHover(controller, fixedSettings(["hover"]));
		const document = await quartoDocument(THREE_KINDS);

		await hover.provideHover(document, INSIDE_PLAIN, NO_CANCEL);
		compiler.next = { stderr: "error: unexpected <script>alert(1)</script>\n" };
		// The body of the block, so the source changes and the compile is not
		// answered out of the cache. The line is inserted above the one the
		// position names, which leaves the position inside the same block.
		const edit = new vscode.WorkspaceEdit();
		edit.insert(document.uri, new vscode.Position(INSIDE_PLAIN.line, 0), "#line()\n");
		assert.ok(await vscode.workspace.applyEdit(edit), "the fixture edit must apply");

		const shown = await hover.provideHover(document, INSIDE_PLAIN, NO_CANCEL);

		const parts = hoverParts(shown);
		assert.strictEqual(parts.length, 2, `an image and a message are two parts: ${hoverText(shown)}`);
		assert.ok(parts[0].value.includes("data:image/"), `no image in the first part: ${parts[0].value}`);
		assert.strictEqual(parts[0].supportHtml, true, "the image part allows HTML");
		assert.ok(!parts[0].value.includes("script"), "the message reached the part that allows HTML");
		assert.ok(parts[1].value.includes("script"), `no message in the second part: ${parts[1].value}`);
		assert.notStrictEqual(parts[1].supportHtml, true, "the message allows HTML");
		controller.dispose();
	});

	test("Should show a raster, sized to the height the hover shows", async () => {
		// A raster carries a fixed number of pixels and markdown cannot scale one,
		// so the height comes from the markup. Twice the height is compiled and
		// half of it asked for back, which is what keeps it sharp on a dense
		// display.
		const compiler = new StubCompiler({ svg: SVG, stderr: "" }, { png: pngHeader(40, 20), stderr: "" });
		const controller = makeController(compiler);
		const hover = new TypstPreviewHover(controller, fixedSettings(["hover"], 200));
		const document = await quartoDocument(THREE_KINDS);

		const shown = await hover.provideHover(document, INSIDE_PLAIN, NO_CANCEL);

		assert.ok(hoverText(shown).includes("data:image/png;base64,"), `no raster: ${hoverText(shown)}`);
		assert.ok(hoverText(shown).includes('height="10"'), `no height on the image: ${hoverText(shown)}`);
		assert.strictEqual(compiler.commands.length, 1, "a page the hover shows whole compiles once");
		assert.strictEqual(ppiOf(compiler.commands[0]), 144);
		controller.dispose();
	});

	test("Should compile a tall page again, at the resolution the hover shows it at", async () => {
		// Twice the height shown, and never twice the page. A page taller than the
		// hover shows is scaled down before a reader sees it, and every pixel above
		// that ratio is length in the URI that buys nothing.
		const tall = new StubCompiler({ svg: SVG, stderr: "" }, { png: pngHeader(100, 800), stderr: "" });
		const controller = makeController(tall);
		const hover = new TypstPreviewHover(controller, fixedSettings(["hover"], 100));
		const document = await quartoDocument(THREE_KINDS);

		const shown = await hover.provideHover(document, INSIDE_PLAIN, NO_CANCEL);

		assert.strictEqual(tall.commands.length, 2, "a page taller than the hover shows is compiled again");
		assert.strictEqual(ppiOf(tall.commands[0]), 144);
		// The first pass reported 800 pixels at 144, which is a page 400 points
		// tall, shown at 100. The resolution falls by that same ratio.
		assert.strictEqual(ppiOf(tall.commands[1]), 36);
		assert.ok(hoverText(shown).includes('height="100"'), `no clamped height: ${hoverText(shown)}`);
		controller.dispose();
	});

	test("Should show a raster for an inline span as well as a fence", async () => {
		// A span is a surface of its own, and it reached the compiler asking for a
		// vector while every fence asked for a raster, so a hover over one showed
		// nothing at all. The raw form is used here because it needs no extension
		// installed in the workspace.
		const controller = makeController(new StubCompiler({ svg: SVG, stderr: "" }));
		const hover = new TypstPreviewHover(controller, fixedSettings(["hover"]));
		const document = await quartoDocument(THREE_KINDS + "\nValue: `#calc.pi`{=typst}\n");
		const inline = new vscode.Position(14, 10);

		const shown = await hover.provideHover(document, inline, NO_CANCEL);

		assert.ok(hoverText(shown).includes("data:image/png;base64,"), `no image for a span: ${hoverText(shown)}`);
		controller.dispose();
	});

	test("Should offer no hover for a raster it cannot read", async () => {
		// Bytes that are not a raster carry no size, so there is nothing to show
		// and nothing to say. An empty hover is a widget with no content in it.
		const unreadable = { png: Buffer.from("not a raster", "utf-8"), stderr: "" };
		const controller = makeController(new StubCompiler({ svg: SVG, stderr: "" }, unreadable));
		const hover = new TypstPreviewHover(controller, fixedSettings(["hover"]));
		const document = await quartoDocument(THREE_KINDS);

		const shown = await hover.provideHover(document, INSIDE_PLAIN, NO_CANCEL);

		assert.strictEqual(shown, undefined, "a raster with no size is not a hover");
		controller.dispose();
	});

	test("Should size a held raster by the resolution it was compiled at", async () => {
		// A held raster can be the scaled one from a taller page, so its height is
		// not the page at the plain resolution. Reading the page size from the
		// pixels alone would report the height of the hover that scaled it.
		const compiler = new StubCompiler({ svg: SVG, stderr: "" }, { png: pngHeader(100, 800), stderr: "" }, (ppi) => ({
			png: pngHeader(100, Math.round((800 * ppi) / 144)),
			stderr: "",
		}));
		const controller = makeController(compiler);
		const settings = mutableSettings(["hover"], 100);
		const hover = new TypstPreviewHover(controller, () => settings.read());
		const document = await quartoDocument(THREE_KINDS);

		// A page of 400 points, shown at 100, so the second pass renders 200 pixels.
		await hover.provideHover(document, INSIDE_PLAIN, NO_CANCEL);
		settings.set(400);
		const shown = await hover.provideHover(document, INSIDE_PLAIN, NO_CANCEL);

		assert.ok(hoverText(shown).includes('height="400"'), `the page was mis-sized: ${hoverText(shown)}`);
		// The room the reader made is room for pixels as well. A held raster of 200
		// pixels stretched over 400 points is a quarter of the density asked for,
		// so the page is read again at the resolution it is now shown at. The image
		// served says which one that is, where a count of compiles would not: the
		// page was already compiled at this resolution once and is answered from
		// the cache rather than by a second process.
		assert.ok(
			hoverText(shown).includes(pngHeader(100, 800).toString("base64")),
			"the hover kept the raster of the smaller height",
		);
		controller.dispose();
	});

	test("Should keep the raster it has when the compile of a scaled one answers nothing", async () => {
		// A newer request supersedes a compile, and the page still has to be shown.
		const compiler = new StubCompiler({ svg: SVG, stderr: "" }, { png: pngHeader(100, 800), stderr: "" }, (ppi) =>
			ppi === 144 ? { png: pngHeader(100, 800), stderr: "" } : { png: Buffer.from("superseded", "utf-8"), stderr: "" },
		);
		const controller = makeController(compiler);
		const hover = new TypstPreviewHover(controller, fixedSettings(["hover"], 100));
		const document = await quartoDocument(THREE_KINDS);

		const shown = await hover.provideHover(document, INSIDE_PLAIN, NO_CANCEL);

		assert.ok(hoverText(shown).includes("data:image/png;base64,"), `no image: ${hoverText(shown)}`);
		assert.ok(hoverText(shown).includes('height="100"'), `the page was mis-sized: ${hoverText(shown)}`);
		controller.dispose();
	});

	test("Should keep a compile failure out of a part that allows HTML", async () => {
		// A Typst message is arbitrary text. Carrying it in a string that allows
		// HTML would let angle brackets in a message reach the reader as markup.
		const stderr = "error: unexpected <script>alert(1)</script>\n";
		const controller = makeController(new StubCompiler({ stderr }));
		const hover = new TypstPreviewHover(controller, fixedSettings(["hover"]));
		const document = await quartoDocument(THREE_KINDS);

		const shown = await hover.provideHover(document, INSIDE_PLAIN, NO_CANCEL);

		for (const part of hoverParts(shown)) {
			if (part.value.includes("script")) {
				assert.notStrictEqual(part.supportHtml, true, "the message allows HTML");
			}
		}
		assert.ok(hoverText(shown).includes("script"), `no message in the hover: ${hoverText(shown)}`);
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
		const hover = new TypstPreviewHover(controller, fixedSettings(["hover"]));
		const document = await quartoDocument(THREE_KINDS);

		const shown = await hover.provideHover(document, INSIDE_PLAIN, NO_CANCEL);

		assert.ok(hoverText(shown).includes("data:image/png;base64,"));
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
		const hover = new TypstPreviewHover(controller, fixedSettings(["hover"]));
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
		const hover = new TypstPreviewHover(controller, fixedSettings(["hover"]));
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
		const hover = new TypstPreviewHover(controller, fixedSettings(["hover"]));
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
		const hover = new TypstPreviewHover(controller, fixedSettings(["hover"]));
		const document = await quartoDocument(THREE_KINDS);
		const updates: string[] = [];
		const subscription = controller.onDidChangeResult((update) => updates.push(update.reason));

		await hover.provideHover(document, INSIDE_RAW, NO_CANCEL);

		assert.deepStrictEqual(updates, ["surface"], "a hover says it is the one that asked");
		subscription.dispose();
		controller.dispose();
	});

	test("Should answer a second hover of one block without compiling again", async () => {
		// The panel compiles a vector and the hover shows a raster, so the panel
		// cannot answer for the hover. One hover of a block still answers the next,
		// which is what keeps a pointer moving over the same block free.
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const controller = makeController(compiler);
		const hover = new TypstPreviewHover(controller, fixedSettings(["hover"]));
		const document = await quartoDocument(THREE_KINDS);

		await hover.provideHover(document, INSIDE_PLAIN, NO_CANCEL);
		const compiledOnce = compiler.sources.length;
		const shown = await hover.provideHover(document, INSIDE_PLAIN, NO_CANCEL);

		assert.ok(hoverText(shown).includes("data:image/png;base64,"));
		assert.strictEqual(compiledOnce, 1, "the first hover compiles the block once");
		assert.strictEqual(compiler.sources.length, 1, "a second hover of one block compiles nothing");
		controller.dispose();
	});

	test("Should give up a hover the pointer has already left", async () => {
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const controller = makeController(compiler);
		const hover = new TypstPreviewHover(controller, fixedSettings(["hover"]));
		const document = await quartoDocument(THREE_KINDS);
		const cancelled = new vscode.CancellationTokenSource();
		cancelled.cancel();

		const shown = await hover.provideHover(document, INSIDE_PLAIN, cancelled.token);

		assert.strictEqual(shown, undefined);
		assert.strictEqual(compiler.sources.length, 0, "a hover nobody is waiting for compiles nothing");
		controller.dispose();
	});

	test("Should point at the panel for an image too large to hover", async () => {
		// A raster of the size shown is shorter than the vector for all but the
		// simplest drawing, and a page dense enough still outruns what a data URI
		// can carry. The reader is sent to the panel rather than shown markup.
		const huge = Buffer.concat([pngHeader(20, 20), Buffer.alloc(400_000)]);
		const controller = makeController(new StubCompiler({ svg: SVG, stderr: "" }, { png: huge, stderr: "" }));
		const hover = new TypstPreviewHover(controller, fixedSettings(["hover"]));
		const document = await quartoDocument(THREE_KINDS);

		const shown = await hover.provideHover(document, INSIDE_PLAIN, NO_CANCEL);

		assert.ok(!hoverText(shown).includes("base64"), "an oversized image is not encoded into the hover");
		assert.ok(hoverText(shown).includes("panel"), `unexpected hover: ${hoverText(shown)}`);
		controller.dispose();
	});

	test("Should point at the panel for an image whose data URI alone is too large", async () => {
		// The guard measures the URI and not the image, because the URI is what the
		// markdown carries. An image in the gap between the two passed the guard and
		// reached VS Code as a literal `![...](data:...)` string.
		const raw = 200_000;
		const padded = Buffer.concat([pngHeader(20, 20), Buffer.alloc(raw - 24)]);
		assert.ok(padded.length < 256 * 1024, "the raw image must be under the raw limit");
		assert.ok(padded.toString("base64").length > 256 * 1024, "the encoded image must be over the limit");
		const controller = makeController(new StubCompiler({ svg: SVG, stderr: "" }, { png: padded, stderr: "" }));
		const hover = new TypstPreviewHover(controller, fixedSettings(["hover"]));
		const document = await quartoDocument(THREE_KINDS);

		const shown = await hover.provideHover(document, INSIDE_PLAIN, NO_CANCEL);

		assert.ok(hoverText(shown).includes("panel"), `unexpected hover: ${hoverText(shown)}`);
		assert.ok(!hoverText(shown).includes("data:image/png"), `the oversized URI reached the hover: ${hoverText(shown)}`);
		controller.dispose();
	});

	test("Should still show an image well under the data URI limit", async () => {
		// The guard above must not be simply always on.
		const controller = makeController(new StubCompiler({ svg: SVG, stderr: "" }));
		const hover = new TypstPreviewHover(controller, fixedSettings(["hover"]));
		const document = await quartoDocument(THREE_KINDS);

		const shown = await hover.provideHover(document, INSIDE_PLAIN, NO_CANCEL);

		assert.ok(hoverText(shown).includes("data:image/png"), `no image in the hover: ${hoverText(shown)}`);
		controller.dispose();
	});

	test("Should offer no hover when the document asks for another surface", async () => {
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const controller = makeController(compiler);
		const hover = new TypstPreviewHover(controller, fixedSettings(["panel"]));
		const document = await quartoDocument(THREE_KINDS);

		await nextResultFor(controller, document, INSIDE_PLAIN);

		assert.strictEqual(await hover.provideHover(document, INSIDE_PLAIN, NO_CANCEL), undefined);
		controller.dispose();
	});

	test("Should offer no hover outside a Typst block", async () => {
		const controller = makeController(new StubCompiler({ svg: SVG, stderr: "" }));
		const hover = new TypstPreviewHover(controller, fixedSettings(["hover"]));
		const document = await quartoDocument(THREE_KINDS);

		assert.strictEqual(await hover.provideHover(document, new vscode.Position(0, 0), NO_CANCEL), undefined);
		controller.dispose();
	});

	test("Should keep the panel off the pointer while both surfaces are on", async () => {
		const compiler = new StubCompiler({ svg: SVG, stderr: "" });
		const controller = makeController(compiler);
		const document = await quartoDocument(THREE_KINDS);
		const hover = new TypstPreviewHover(controller, fixedSettings(["panel", "hover"]));

		// The panel is following the plain block, which is what a cursor move does.
		await nextResultFor(controller, document, INSIDE_PLAIN);
		const followed = controller.shown();

		// A pointer resting on another block compiles for the hover alone.
		assert.ok(await hover.provideHover(document, INSIDE_RAW, NO_CANCEL));
		await settle();

		// `shown()` is what the panel renders, and it has not moved to the raw block.
		assert.strictEqual(controller.shown()?.blockIndex, followed?.blockIndex);
		controller.dispose();
	});
});
