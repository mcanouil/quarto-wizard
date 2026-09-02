import * as vscode from "vscode";
import * as path from "node:path";
import { getErrorMessage } from "@quarto-wizard/core";
import { blockAtOffset, invalidatesPreview, type TypstBlock } from "../../utils/typst/typstBlocks";
import { isUnavailable, themeHeader, type TypstThemeKind } from "../../utils/typst/typstSource";
import { parseTypstStderr, typstMessages } from "../../utils/typst/typstDiagnostics";
import { debounce, type DebouncedFunction } from "../../utils/debounce";
import { generateHashKey } from "../../utils/hash";
import { logMessage } from "../../utils/log";
import { isQmdFile } from "../../utils/metadataFilesRegistry";
import { otherBrandMode, type TypstBrandMode } from "../../utils/typst/typstOptions";
import { EXTENSION_MANIFEST_GLOB } from "../../utils/quartoProjectDiscovery";
import { buildCompileRequest, NO_BLOCK_MESSAGE, TypstContextCache, type CompileRequest } from "./typstContext";
import { TypstCompiler, invalidateTypstBinary, resolveTypstBinary, type TypstCompileResult } from "./typstCompiler";
import { compileSettings, documentDelayOf, surfaceOf } from "./typstPreviewSettings";

/**
 * The one owner of the preview state.
 *
 * The surfaces are thin renderers of whatever it publishes, so there is one
 * answer to what is being previewed rather than one per surface, and one place
 * that decides when a compile is worth running.
 */

/**
 * How long after the cursor moves the preview follows it.
 *
 * Shorter than the document delay on purpose: moving the cursor between blocks
 * is a deliberate act and usually answers from the cache, while typing is not.
 */
const SELECTION_DEBOUNCE_MS = 250;

/** How long after a file the preview reads changes it is rebuilt. */
const CONTEXT_DEBOUNCE_MS = 300;

/**
 * How many compiled results are remembered.
 *
 * Enough to hold every block of a document under an edit and its undo history,
 * and small enough that a session of many documents does not grow without
 * bound.
 */
export const CACHE_LIMIT = 32;

/**
 * How many bytes of image the remembered results may hold together.
 *
 * The count alone is not a bound. One compile may produce up to the compiler's
 * own output limit, which is measured in megabytes, so a cache of a few dense
 * pages would hold far more of the extension host than the count suggests.
 */
const CACHE_LIMIT_BYTES = 16 * 1024 * 1024;

/** Where the lines of a compile live, so a diagnostic can be placed. */
export interface ErrorPlace {
	/** How many lines sit above the compiled code in the assembled source. */
	injectedLines: number;
	/** How many lines of the block body sit above the first compiled line. */
	bodyLineOffset?: number;
	/** The file whose contents were compiled instead of the block body. */
	externalFile?: string;
}

/**
 * One change of the preview, as the surfaces hear about it.
 *
 * The reason describes the request and not the block, so it is not part of the
 * result: a surface reading `current()` later would find it describing a
 * request that is long over.
 */
export interface TypstPreviewUpdate {
	/** What is being previewed, absent when there is nothing any more. */
	result?: TypstPreviewResult;
	/**
	 * Why this was compiled, which decides who should render it.
	 *
	 * A surface that compiled for itself is already showing the answer, so
	 * another surface rendering it too would follow the pointer to a block the
	 * reader never asked it to show.
	 */
	reason: PreviewReason;
}

/** What a surface needs to render the current preview. */
export interface TypstPreviewResult {
	/** The document the block belongs to. */
	uri: vscode.Uri;
	/** The block that was previewed. */
	block: TypstBlock;
	/** Where that block sits in the document, which is its identity across an edit. */
	blockIndex: number;
	/**
	 * The document version this describes.
	 *
	 * A surface that reads the held result rather than compiling has to know that
	 * the text has not moved under it. With the hover as the only surface nothing
	 * recompiles in the background, so the result outlives the text it describes,
	 * and the place of the block alone cannot say that.
	 */
	version: number;
	/**
	 * The whole source that was sent to the compiler.
	 *
	 * Carried so that the copy command can hand a reader the exact text Typst
	 * read, which is what turns a preview failure into something reproducible
	 * outside the editor.
	 */
	source: string;
	/** The side of the brand a cell resolved with, absent for the other two kinds. */
	brandMode?: TypstBrandMode;
	/** The image on screen, which is the last one this block compiled to. */
	svg?: string;
	/** What the surface says about the block beside the image. */
	header: string;
	/** The one line a failure shows, absent when the compile produced an image. */
	error?: string;
}

/** What the controller needs of a compiler, which is what makes it stubbable. */
export interface TypstCompilerLike {
	compile(source: string, argv: string[], token: vscode.CancellationToken, cwd?: string): Promise<TypstCompileResult>;
	dispose(): void;
}

/**
 * Why one preview is being compiled.
 *
 * The three differ in two ways that are not derivable from each other: whether
 * a panel may open for it, and whether it is worth compiling when nothing is
 * showing a preview.
 *
 * - `asked`, the command. A panel opens, and it compiles whatever is on screen,
 *   because the panel it opens is the answer.
 * - `surface`, a hover over a block the preview is not following. Opens nothing,
 *   and still compiles: the surface asking is itself on screen and waiting.
 * - `background`, an edit, a cursor move, a theme or a watched file. Opens
 *   nothing, and compiles only while something would render the result.
 */
export type PreviewReason = "asked" | "surface" | "background";

/** How the controller reaches the parts of the world it does not own. */
export interface TypstPreviewControllerOptions {
	/**
	 * Whether a surface is showing a preview now.
	 *
	 * Only a background compile asks. A panel renders every result it is given,
	 * so it answers this; a hover renders nothing until the pointer rests, so it
	 * does not, and it drives its own compile through `preview` instead. Making
	 * a hover answer yes would spawn Typst on every edit and every cursor move
	 * for a reader who may never point at a block.
	 */
	hasSurface: () => boolean;
	/** Put a message in front of the reader. */
	show: (message: string) => void;
	/** The Typst binary. Injected so that no test spawns Typst. */
	resolveBinary?: () => Promise<string | undefined>;
	/** The compiler for one binary and one timeout. Injected for the same reason. */
	createCompiler?: (binary: string, timeoutMs: number) => TypstCompilerLike;
	/** How many bytes of image to hold. Lowered by the test that bounds it. */
	cacheLimitBytes?: number;
}

/**
 * The active colour theme as the pure modules name it.
 *
 * Exported for its tests. `HighContrast` is the dark one and `HighContrastLight`
 * the light one, which is the pairing a mapping written from the names alone
 * gets wrong.
 */
export function themeKindOf(kind: vscode.ColorThemeKind): TypstThemeKind {
	switch (kind) {
		case vscode.ColorThemeKind.Light:
			return "light";
		case vscode.ColorThemeKind.HighContrast:
			return "high-contrast";
		case vscode.ColorThemeKind.HighContrastLight:
			return "high-contrast-light";
		default:
			return "dark";
	}
}

/**
 * The one line a failure shows inside the surface.
 *
 * Exported for its tests. The choice of which diagnostic to show carries most
 * of the behaviour, and it is not reachable through the command.
 */
export function errorText(stderr: string, place: ErrorPlace): string {
	const diagnostics = parseTypstStderr(stderr, place.injectedLines);
	// A warning can sit above the error that stopped the compile, so the first
	// diagnostic is not the one to show. Headlining a failure as a warning
	// misstates why there is no image.
	//
	// Among the errors it is the first that is shown, which is the earliest in
	// the compiled source. A block compiled under a broken one reports errors of
	// its own, and those are consequences: showing one of them would send the
	// reader to a line that is only wrong because the source above it is.
	const mapped = diagnostics.find((diagnostic) => diagnostic.severity === "error") ?? diagnostics[0];
	if (mapped) {
		if (mapped.aboveBody) {
			// A raw block compiles under every raw block before it, so the failure
			// can belong to one of those. There is no line of this block to name,
			// but saying nothing about where it is would leave the reader looking
			// at a block that compiles.
			return `${mapped.severity} above this block: ${mapped.message}`;
		}
		if (mapped.line === undefined) {
			// A package that would not download, or an input Typst could not read.
			// Naming a position here would point at a character that has nothing to
			// do with the failure.
			return `${mapped.severity}: ${mapped.message}`;
		}
		const column = (mapped.column ?? 0) + 1;
		if (place.externalFile !== undefined) {
			// The body was replaced by that file, so no line of the block corresponds
			// to the failure at all. Naming the block would send the reader to a line
			// that has nothing to do with it.
			return `${mapped.severity} at line ${mapped.line + 1}, column ${column} of ${place.externalFile}: ${mapped.message}`;
		}
		// The line is counted inside the block, while the panel header counts
		// document lines, so it says which of the two it means. A cell compiles its
		// code and not its body, so the leading option run is added back: without it
		// every position in a cell with options is short by the length of that run.
		const line = mapped.line + (place.bodyLineOffset ?? 0) + 1;
		return `${mapped.severity} at line ${line}, column ${column} of the block: ${mapped.message}`;
	}

	// Nothing mapped, which means every diagnostic pointed at another file, such
	// as an imported one. There is no position to show, but there is still a
	// message, and reporting none would contradict the missing image.
	const messages = typstMessages(stderr);
	const outside = messages.find((message) => message.severity === "error") ?? messages[0];
	return outside === undefined
		? "Typst produced no image and reported nothing."
		: `${outside.severity} outside this block: ${outside.message}`;
}

/** What the surface says about the block it is displaying. */
export function headerText(document: vscode.TextDocument, request: CompileRequest): string {
	const parts = [`${path.basename(document.fileName)} · line ${request.block.fenceLine + 1}`];
	if (request.brandMode !== undefined) {
		// A cell resolves its `auto` colours against one side of the brand, and
		// which side it took is not visible in the image when the two are close.
		parts.push(`${request.brandMode} brand`);
	}
	// Everything the preview does not reproduce about this block. Saying so beside
	// the image is what stops a divergence being read as a defect.
	parts.push(...request.notes);
	return parts.join(" · ");
}

/** Whether a document is one this feature previews at all. */
function isRelevantDocument(document: vscode.TextDocument): boolean {
	return document.languageId === "quarto" || isQmdFile(document.fileName);
}

/** One place a preview can be compiled from. */
export interface PreviewTarget {
	document: vscode.TextDocument;
	position: vscode.Position;
}

/** Where the cursor is, when it is in a document this feature previews. */
function cursorTarget(): PreviewTarget | undefined {
	const editor = vscode.window.activeTextEditor;
	if (editor === undefined || !isRelevantDocument(editor.document)) {
		return undefined;
	}
	return { document: editor.document, position: editor.selection.active };
}

/**
 * The metadata files a preview reads beside the block.
 *
 * `_quarto` and `_metadata` are the chain, and `_brand` is where an `auto`
 * colour resolves from. The glob and the name test below are both built from
 * this, because two hand-kept lists of one set drift apart in silence.
 */
const CONTEXT_FILE_NAMES = ["quarto", "metadata", "brand"] as const;

/** Every metadata file of the chain, at any depth, including `_brand/_brand.yml`. */
const CONTEXT_FILE_GLOB = `**/_{${CONTEXT_FILE_NAMES.join(",")}}.{yml,yaml}`;

/** A `preamble:` or a `file:`, which a cell compiles in place of its own body. */
const TYPST_FILE_GLOB = "**/*.typ";

/**
 * Whether a document is one a preview reads beside the block.
 *
 * An unsaved edit to one of these drives the preview the way an unsaved edit to
 * the document itself already does, because the chain prefers the copy open in
 * the editor. An extension manifest is not among them: nothing reads one from
 * the editor, so the watcher over the installed manifests is what covers it.
 */
function isContextDocument(document: vscode.TextDocument): boolean {
	const name = path.basename(document.fileName).toLowerCase();
	return (
		CONTEXT_FILE_NAMES.some((stem) => name === `_${stem}.yml` || name === `_${stem}.yaml`) || name.endsWith(".typ")
	);
}

/**
 * The state of the Typst preview, and every event that changes it.
 *
 * Nothing here spawns Typst until a surface is showing a preview or the user
 * asks for one, so a session that never opens the preview pays for the event
 * subscriptions alone.
 */
export class TypstPreviewController implements vscode.Disposable {
	private readonly disposables: vscode.Disposable[] = [];
	private readonly contexts = new TypstContextCache();
	private readonly resultEmitter = new vscode.EventEmitter<TypstPreviewUpdate>();
	/**
	 * The compiled results, most recently used last.
	 *
	 * Keyed by what decides the image: the source, the arguments and the binary.
	 * A failure is remembered as well, because an unchanged broken block is the
	 * normal state halfway through an edit and recompiling it says the same thing
	 * at the cost of a process.
	 */
	private readonly cache = new Map<string, TypstCompileResult>();
	/**
	 * The token every compile is given.
	 *
	 * The compiler supersedes its own running child, so the caller has nothing to
	 * cancel. This exists only because `compile` takes a token and the API has no
	 * ready-made one that never fires.
	 */
	private readonly uncancelled = new vscode.CancellationTokenSource();
	private readonly selectionDebounce: DebouncedFunction<() => void>;
	private readonly contextDebounce: DebouncedFunction<() => void>;
	private documentDebounce: DebouncedFunction<() => void> | undefined;
	/** The delay the document debouncer was built with, which the setting can move. */
	private documentDelayMs: number | undefined;
	private compiler: TypstCompilerLike | undefined;
	/** What the compiler was built for, so it is replaced when that changes. */
	private compilerKey: string | undefined;
	/** How many bytes of image the cache is holding. */
	private cacheBytes = 0;
	/** Whether the file watchers are up, which the first request raises. */
	private watching = false;
	/** Rises with every request, so a result that arrives out of order is dropped. */
	private requestVersion = 0;
	private result: TypstPreviewResult | undefined;
	/**
	 * The preview the reader is following, which is not always the last compile.
	 *
	 * A hover compiles the block under the pointer and publishes it, and the panel
	 * deliberately ignores that: a pointer rest is not a request to move the panel.
	 * The panel therefore goes on showing the block it was given, and a command
	 * that acted on the last compile would act on the block the pointer passed
	 * over instead of the one on screen.
	 *
	 * It is absent until something other than a surface publishes, which is the
	 * state of a session where the hover is the only surface. `shown()` falls back
	 * to the last compile there, because that hover is the image the reader saw.
	 */
	private tracked: TypstPreviewResult | undefined;
	/**
	 * The side of the brand the reader asked to see, when they asked for one.
	 *
	 * It outranks both the document and the theme, and it holds until the reader
	 * asks for the other side, so moving between the cells of a document keeps
	 * showing the side they are reading. Nothing else writes it, and the header
	 * names the side in force, so the preview never differs from the render
	 * without saying so.
	 */
	private brandModeOverride: TypstBrandMode | undefined;
	/** Said once per session, because an unavailable machine stays unavailable. */
	private reportedUnavailable = false;
	private disposed = false;

	/** Fires when the preview changes, carrying nothing when there is none. */
	readonly onDidChangeResult = this.resultEmitter.event;

	constructor(private readonly options: TypstPreviewControllerOptions) {
		this.selectionDebounce = debounce(() => this.refresh(), SELECTION_DEBOUNCE_MS);
		this.contextDebounce = debounce(() => {
			this.contexts.forgetFiles();
			this.recompile();
		}, CONTEXT_DEBOUNCE_MS);
		this.wireEvents();
	}

	/** The last compile, which is what a surface that asked for one renders. */
	current(): TypstPreviewResult | undefined {
		return this.result;
	}

	/**
	 * The preview the reader is looking at, which is what a command acts on.
	 *
	 * Not the same question as `current()`. A hover over another block is the last
	 * compile without being what is on screen, and the three preview commands mean
	 * the image the reader can see.
	 */
	shown(): TypstPreviewResult | undefined {
		return this.tracked ?? this.result;
	}

	/**
	 * The Typst blocks of a document, as the preview reads them.
	 *
	 * The surfaces need the same list the compile was built from, and the cache
	 * is keyed on the document version, so asking here costs one scan per edit
	 * however many surfaces ask.
	 */
	blocksOf(document: vscode.TextDocument): TypstBlock[] {
		return this.contexts.blocksOf(document, () => document.getText());
	}

	/** Preview the block under a position, because the user asked for it. */
	request(document: vscode.TextDocument, position: vscode.Position): void {
		void this.attempt(document, position, "asked");
	}

	/**
	 * Preview the block under a position, and wait for the image.
	 *
	 * This is a hover over a block the preview is not following. It publishes
	 * like an edit does and opens nothing, because nobody asked for a panel: the
	 * surface that asked is already on screen.
	 *
	 * The result is awaited rather than left to the next call. A hover cannot ask
	 * to be shown again, so answering before the image exists would leave every
	 * block needing two passes to read. Nothing is lost by waiting: the hover
	 * widget has no timeout, and shows a loading message of its own meanwhile.
	 *
	 * Resolves to nothing when a newer request superseded this one, when the
	 * block cannot be previewed, or when the compile failed on the way.
	 */
	preview(document: vscode.TextDocument, position: vscode.Position): Promise<TypstPreviewResult | undefined> {
		return this.attempt(document, position, "surface");
	}

	/** Preview the block under the cursor again, because something changed. */
	refresh(): void {
		this.compile(cursorTarget(), "background");
	}

	/**
	 * Compile the block that is on screen again, wherever the cursor is now.
	 *
	 * This is what a theme, a setting or a file the preview reads changing asks
	 * for. Those change the image of the block being looked at, and the cursor
	 * may have moved on to a document with no block in it at all, so following the
	 * cursor here would leave the panel showing an image nothing recompiled.
	 */
	recompile(): void {
		this.compile(this.shownTarget(), "background");
	}

	/**
	 * Compile the preview again, forgetting everything remembered about it.
	 *
	 * This is the command a reader runs when the image and the document disagree,
	 * so it outranks everything that would answer without compiling: the image
	 * held for this source, the metadata files, which are read from disk and can
	 * be changed by something the watchers do not see, such as a checkout or a
	 * build step, and the brand mode the reader switched to by hand. It is
	 * therefore also the way back to a preview that follows the theme again.
	 *
	 * Nothing is forgotten until there is something to compile, so a command run
	 * with the cursor outside every block costs nothing.
	 */
	reload(): void {
		const target = this.shownTarget() ?? cursorTarget();
		// The block is what makes the command mean something, and the cursor can sit
		// in a document that has none. Asking here rather than leaving it to the
		// compile is what keeps the promise above true.
		if (
			target === undefined ||
			blockAtOffset(this.blocksOf(target.document), target.document.offsetAt(target.position)) === undefined
		) {
			this.options.show(NO_BLOCK_MESSAGE);
			return;
		}
		this.brandModeOverride = undefined;
		this.contexts.forgetFiles();
		this.compile(target, "asked", true);
	}

	/**
	 * Show the other side of the brand of the cell being previewed.
	 *
	 * Only a cell resolves a colour from a brand. A plain block and a raw block
	 * carry the preview's own theme header, so there is no second image to show
	 * and saying so is better than a command that silently does nothing.
	 *
	 * The kind is what is asked, and not the presence of a mode: a result carries
	 * a mode because it is a cell, and reading the answer off the optional field
	 * would make this quietly wrong the day another kind gains one.
	 */
	toggleBrandMode(): void {
		const shown = this.shown();
		if (shown?.block.kind !== "cell" || shown.brandMode === undefined) {
			this.options.show("The brand mode applies to a `{typst}` cell. Preview one to switch the side it resolves.");
			return;
		}
		const target = this.shownTarget();
		if (target === undefined) {
			return;
		}
		// Written only once the block to recompile is known, or the stored side
		// would disagree with the image on screen until something else compiled.
		this.brandModeOverride = otherBrandMode(shown.brandMode);
		this.compile(target, "asked");
	}

	/**
	 * Compile one target, when there is one.
	 *
	 * Every entry point differs in which block it means and why, and in nothing
	 * else, so the tail they share lives here.
	 */
	private compile(target: PreviewTarget | undefined, reason: PreviewReason, fresh = false): void {
		if (target === undefined) {
			return;
		}
		void this.attempt(target.document, target.position, reason, fresh);
	}

	/**
	 * The block on screen, as a position in the document holding it.
	 *
	 * The block is found again by its place in the document rather than by the
	 * offsets it carried, which move under every edit above it.
	 */
	private shownTarget(): PreviewTarget | undefined {
		const shown = this.shown();
		if (shown === undefined) {
			return undefined;
		}
		const document = vscode.workspace.textDocuments.find((open) => open.uri.toString() === shown.uri.toString());
		if (document === undefined) {
			return undefined;
		}
		const block = this.blocksOf(document)[shown.blockIndex];
		return block === undefined ? undefined : { document, position: document.positionAt(block.fenceStart) };
	}

	/**
	 * One preview, with nothing escaping as a rejection.
	 *
	 * A caller that starts a preview and walks away would otherwise turn a throw
	 * on the way to the compiler into an unhandled rejection: no log line, no
	 * message, and a preview that looks inert. A metadata file or a brand file
	 * that cannot be read is exactly that case, because the context cache
	 * rethrows rather than remembering a failure.
	 */
	private attempt(
		document: vscode.TextDocument,
		position: vscode.Position,
		reason: PreviewReason,
		fresh = false,
	): Promise<TypstPreviewResult | undefined> {
		return this.run(document, position, reason, fresh).catch((error: unknown) => {
			const message = getErrorMessage(error);
			logMessage(`Typst preview: ${message}`, "error");
			if (reason === "asked") {
				this.options.show(message);
			}
			return undefined;
		});
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.selectionDebounce.cancel();
		this.contextDebounce.cancel();
		this.documentDebounce?.cancel();
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		this.disposables.length = 0;
		// Disposing the compiler kills whatever child it has in flight, which is
		// what stops a shutdown leaving a Typst process behind.
		this.compiler?.dispose();
		this.compiler = undefined;
		this.uncancelled.dispose();
		this.resultEmitter.dispose();
		this.forgetImages();
		this.contexts.clear();
		this.result = undefined;
		this.tracked = undefined;
	}

	/**
	 * One preview, from a position to a published result.
	 *
	 * Reports what it published, so a surface that is waiting for the image can
	 * render it directly. Nothing published means nothing to render: a newer
	 * request took over, the block cannot be previewed, or the machine cannot
	 * compile at all.
	 *
	 * @param fresh - Compile even when this source has an image already. Only a
	 *   reader asking for a refresh does, and it costs one process rather than
	 *   the whole cache.
	 */
	private async run(
		document: vscode.TextDocument,
		position: vscode.Position,
		reason: PreviewReason,
		fresh: boolean,
	): Promise<TypstPreviewResult | undefined> {
		if (this.disposed || (reason === "background" && !this.options.hasSurface())) {
			return undefined;
		}

		if (surfaceOf(document) === "off") {
			// Asked here rather than in each surface, because a surface that renders
			// nothing is not the same as a document that wants nothing compiled: with
			// the gate in the surfaces alone, an open panel went on spawning Typst for
			// every edit in a folder that had turned the feature off.
			//
			// Naming the setting is what makes it recoverable, and only a reader who
			// asked hears it: an edit in such a folder is not a question.
			const message = "The Typst preview is off. Set `quartoWizard.typstPreview.surface` to show a preview.";
			logMessage(`Typst preview: ${message}`, "debug");
			// A surface open when the setting changed would otherwise hold the last
			// image for good: nothing recompiles it, and nothing said it had stopped
			// tracking the document, so it looks live and is frozen.
			this.forgetDocument(document.uri);
			if (reason === "asked") {
				this.options.show(message);
			}
			return undefined;
		}

		const version = ++this.requestVersion;
		// A newer request has started, or the controller has gone, or the document
		// has. A closed document raised its own event already, so publishing a
		// result for it here would bring back a preview that was taken away.
		const stale = (): boolean => this.disposed || version !== this.requestVersion || document.isClosed;

		if (!vscode.workspace.isTrusted) {
			this.reportUnavailable("The Typst preview needs a trusted workspace, because it runs the Typst compiler.");
			return undefined;
		}

		// Raised by the first request and not by the first result. A cell in a
		// project that has not installed the extension never produces a result, and
		// the manifest watcher is what lets it start working once the extension is
		// installed, so waiting for a result would keep that case broken for good.
		this.watchFiles();

		const settings = compileSettings(document);
		// The header applies to a plain block and a raw block. A cell keeps the
		// colour contract of the filter instead, and drops it.
		const { header } = themeHeader(
			themeKindOf(vscode.window.activeColorTheme.kind),
			settings.foreground,
			settings.background,
		);
		// Read where the text is read, and carried through the compile. Taken at
		// publish time it would describe the document as it is when Typst finishes,
		// so an edit landing during a compile would stamp the new version onto the
		// old image, and a surface trusting the stamp would serve it as current.
		const compiledVersion = document.version;
		const request = await buildCompileRequest(document, position, header, this.contexts, this.brandModeOverride);
		if (stale()) {
			return undefined;
		}
		if (isUnavailable(request)) {
			// Said only to a reader who asked. An edit or a cursor move that lands
			// outside every block is not a question, so answering it would put a
			// message in front of someone who did nothing.
			logMessage(`Typst preview: ${request.unavailable}`, "debug");
			if (reason === "asked") {
				this.options.show(request.unavailable);
			}
			return undefined;
		}

		const binary = await this.resolveBinary();
		if (binary === undefined) {
			this.reportUnavailable(
				"The Typst preview needs the Typst binary that ships inside Quarto, and it was not found.",
			);
			return undefined;
		}
		// The image is decided by the source, the command line, the directory the
		// compile runs from and the binary, and by nothing else. Two documents that
		// assemble to the same source under the same command line share the entry,
		// which is what makes an undone keystroke free.
		// Joined on a character no argument and no Typst source carries, so two
		// different requests cannot be spelled the same way.
		const key = generateHashKey([binary, request.cwd ?? "", ...request.argv, request.source].join("\u0000"));
		if (fresh) {
			// Dropped now and not merely stepped over, and before this request is
			// asked whether it is still wanted. A compile that another request
			// supersedes never reaches `remember`, so an entry left here would be the
			// image the reader asked to stop trusting, served back to them by the
			// request that superseded the refresh.
			this.forget(key);
		}
		if (stale()) {
			return undefined;
		}

		const held = this.cache.get(key);
		if (held !== undefined) {
			// Re-inserted so the least recently used entry is the first one, which is
			// what the eviction below removes.
			this.cache.delete(key);
			this.cache.set(key, held);
			return this.publish(document, request, held, reason, compiledVersion);
		}

		try {
			const compiled = await this.useCompiler(binary, settings.timeoutMs).compile(
				request.source,
				request.argv,
				this.uncancelled.token,
				request.cwd,
			);
			if (stale()) {
				return undefined;
			}
			this.remember(key, compiled);
			return this.publish(document, request, compiled, reason, compiledVersion);
		} catch (error) {
			if (stale() || error instanceof vscode.CancellationError) {
				return undefined;
			}
			const message = getErrorMessage(error);
			logMessage(`Typst preview: ${message}`, "error");
			return this.publish(document, request, { stderr: "" }, reason, compiledVersion, message);
		}
	}

	/**
	 * Publish what one compile means for the surfaces.
	 *
	 * Reports the result it published, or nothing when it dropped it, so a caller
	 * awaiting one preview learns which of the two happened.
	 */
	private publish(
		document: vscode.TextDocument,
		request: CompileRequest,
		compiled: TypstCompileResult,
		reason: PreviewReason,
		compiledVersion: number,
		failure?: string,
	): TypstPreviewResult | undefined {
		if (reason === "background" && !this.options.hasSurface()) {
			// A compile runs for up to the timeout and the reader can close the last
			// surface meanwhile. The result is nobody's, and publishing it would have
			// a surface build itself to render it, which reopens what was just closed.
			return undefined;
		}

		if (compiled.svg === undefined) {
			if (failure === undefined) {
				logMessage(`Typst preview: the compiler reported:\n${compiled.stderr}`, "debug");
			}
		} else if (compiled.stderr.length > 0) {
			logMessage(`Typst preview: the compiler warned:\n${compiled.stderr}`, "debug");
		}

		// A failure keeps the last good image of this same block behind it, because
		// a parse error is the normal state of a block halfway through an edit and
		// clearing the image would make the surface flash empty on almost every
		// keystroke. The image of another block is not kept: an error of one block
		// over the image of another says nothing true about either of them.
		//
		// The image kept is the one the reader can see, which is the tracked preview
		// for everything but a hover. Comparing against the last compile instead
		// would lose the image of the block on screen as soon as a pointer had
		// rested on another one.
		const previous = reason === "surface" ? this.result : this.shown();
		const sameBlock =
			previous?.uri.toString() === document.uri.toString() && previous?.blockIndex === request.blockIndex;
		this.result = {
			uri: document.uri,
			block: request.block,
			blockIndex: request.blockIndex,
			version: compiledVersion,
			source: request.source,
			brandMode: request.brandMode,
			svg: compiled.svg ?? (sameBlock ? previous?.svg : undefined),
			header: headerText(document, request),
			error: compiled.svg === undefined ? (failure ?? errorText(compiled.stderr, request)) : undefined,
		};
		if (reason !== "surface") {
			// Every other reason is a block a surface will render, so it is what the
			// reader ends up looking at.
			this.tracked = this.result;
		}
		this.resultEmitter.fire({ result: this.result, reason });
		return this.result;
	}

	/** Forget one compiled image, and the bytes it was counted for. */
	private forget(key: string): void {
		this.cacheBytes -= this.cache.get(key)?.svg?.length ?? 0;
		this.cache.delete(key);
	}

	/** Remember one compile, and forget those used longest ago to make room. */
	private remember(key: string, compiled: TypstCompileResult): void {
		// Anything held for this source is dropped first. Without this the budget
		// would count the same image twice, and the replacement would keep the
		// insertion place of the entry it replaced rather than becoming the most
		// recently used one.
		this.forget(key);
		this.cache.set(key, compiled);
		this.cacheBytes += compiled.svg?.length ?? 0;
		// A `Map` iterates in insertion order and every hit is re-inserted, so the
		// first key is the one used longest ago. Both bounds matter: the count keeps
		// a session of small blocks from growing without end, and the byte total
		// keeps a handful of dense pages from holding the extension host.
		const limitBytes = this.options.cacheLimitBytes ?? CACHE_LIMIT_BYTES;
		while (this.cache.size > CACHE_LIMIT || (this.cacheBytes > limitBytes && this.cache.size > 1)) {
			const oldest = this.cache.keys().next();
			if (oldest.done) {
				return;
			}
			this.cacheBytes -= this.cache.get(oldest.value)?.svg?.length ?? 0;
			this.cache.delete(oldest.value);
		}
	}

	/**
	 * Stop describing one document, and say so when something changed.
	 *
	 * The two held previews are asked separately. A hover moves the last compile
	 * without moving the tracked one, so a document can be the subject of one and
	 * not of the other, and testing only one of them would leave a surface showing
	 * a document that is gone while looking live.
	 */
	private forgetDocument(uri: vscode.Uri): void {
		const key = uri.toString();
		const forgotten = this.result?.uri.toString() === key || this.tracked?.uri.toString() === key;
		if (!forgotten) {
			return;
		}
		if (this.result?.uri.toString() === key) {
			this.result = undefined;
		}
		if (this.tracked?.uri.toString() === key) {
			this.tracked = undefined;
		}
		// The tracked preview and nothing else. Falling back to the last compile
		// here would hand a surface the block a pointer rested on, which is how the
		// panel would move to a document the reader never asked it to show.
		this.resultEmitter.fire({ result: this.tracked, reason: "background" });
	}

	/** Forget every compiled image, so the next request compiles again. */
	private forgetImages(): void {
		this.cache.clear();
		this.cacheBytes = 0;
	}

	private resolveBinary(): Promise<string | undefined> {
		return (this.options.resolveBinary ?? resolveTypstBinary)();
	}

	/**
	 * The compiler for one binary and one timeout.
	 *
	 * Both are read once at construction, and both can change while the session
	 * runs, so the compiler is replaced when the values it was built with no
	 * longer apply. Nothing is lost by replacing it mid-run, because the next
	 * compile supersedes whatever is running anyway.
	 */
	private useCompiler(binary: string, timeoutMs: number): TypstCompilerLike {
		const key = `${binary}\u0000${timeoutMs}`;
		if (this.compiler === undefined || this.compilerKey !== key) {
			this.compiler?.dispose();
			this.compiler = this.options.createCompiler?.(binary, timeoutMs) ?? new TypstCompiler(binary, { timeoutMs });
			this.compilerKey = key;
		}
		return this.compiler;
	}

	/**
	 * Say once that the feature cannot run here at all.
	 *
	 * The log line is not part of what is said once. The binary probe caches its
	 * result and logs only on the first attempt, so without this every later
	 * attempt on an unavailable machine would leave no trace at all, and the log
	 * would stop being enough to diagnose an inert preview.
	 */
	private reportUnavailable(message: string): void {
		logMessage(`Typst preview: ${message}`, "debug");
		if (this.reportedUnavailable) {
			return;
		}
		this.reportedUnavailable = true;
		this.options.show(message);
	}

	/**
	 * Forget the compiler and where its binary was, so the next request probes.
	 *
	 * The probe memoises its answer for the session, so forgetting the compiler
	 * alone would rebuild it around the path Quarto had before it was installed,
	 * removed or moved.
	 */
	private forgetCompiler(): void {
		invalidateTypstBinary();
		this.compiler?.dispose();
		this.compiler = undefined;
		this.compilerKey = undefined;
		this.reportedUnavailable = false;
	}

	/** Rebuild the preview after an edit, at the delay the settings ask for. */
	private scheduleDocument(document: vscode.TextDocument): void {
		// The delay is fixed when a debouncer is built and the setting is resource
		// scoped, so the debouncer is rebuilt when the document being edited asks
		// for a different one. A multi-root workspace can hold one delay per folder,
		// and keeping the first would give the second folder the wrong one.
		const delayMs = documentDelayOf(document);
		if (this.documentDebounce === undefined || this.documentDelayMs !== delayMs) {
			this.documentDebounce?.cancel();
			this.documentDelayMs = delayMs;
			this.documentDebounce = debounce(() => this.refresh(), delayMs);
		}
		this.documentDebounce();
	}

	/** Drop the debouncer, so the next edit reads the delay again. */
	private forgetDocumentDelay(): void {
		this.documentDebounce?.cancel();
		this.documentDebounce = undefined;
		this.documentDelayMs = undefined;
	}

	private wireEvents(): void {
		this.disposables.push(
			// The cursor moving is what says which block is being looked at. A cursor
			// still inside the block on screen has nothing to say: it moves on every
			// keystroke as well, and typing is what the document delay is for, so
			// following it here would make that setting mean nothing below 250 ms.
			vscode.window.onDidChangeTextEditorSelection((event) => {
				if (this.options.hasSurface() && isRelevantDocument(event.textEditor.document) && this.movedBlock(event)) {
					this.selectionDebounce();
				}
			}),
		);

		this.disposables.push(
			// A new editor usually answers from the cache, so it is not debounced.
			vscode.window.onDidChangeActiveTextEditor(() => this.refresh()),
		);

		this.disposables.push(vscode.workspace.onDidChangeTextDocument((event) => this.handleDocumentChange(event)));

		this.disposables.push(
			// A save is a deliberate act and the reader is waiting for the result, so
			// the pending rebuild happens now rather than after its delay.
			vscode.workspace.onDidSaveTextDocument((document) => {
				if (isContextDocument(document)) {
					this.contextDebounce.flush();
					return;
				}
				if (isRelevantDocument(document)) {
					this.selectionDebounce.cancel();
					this.documentDebounce?.flush();
				}
			}),
		);

		this.disposables.push(
			vscode.workspace.onDidCloseTextDocument((document) => {
				this.contexts.forget(document.uri);
				this.forgetDocument(document.uri);
			}),
		);

		this.disposables.push(
			// The injected colour of a plain or raw block and the brand mode of a cell
			// both follow the theme, so the source changes and the cache decides
			// whether that is worth a compile: a theme that resolves to the same
			// source is a hit and spawns nothing. That covers all three kinds without
			// asking what the theme means for each of them.
			vscode.window.onDidChangeActiveColorTheme(() => this.recompile()),
		);

		this.disposables.push(
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration("quartoWizard.typstPreview")) {
					this.forgetDocumentDelay();
					this.recompile();
				}
			}),
		);

		this.disposables.push(
			// Installing or removing the Quarto extension changes where the binary is,
			// or whether there is one at all.
			vscode.extensions.onDidChange(() => this.forgetCompiler()),
		);
	}

	/**
	 * Watch the files a preview reads beside the block.
	 *
	 * Raised by the first request rather than at registration. These are
	 * workspace-wide watchers, and until a preview is asked for every event they
	 * deliver reaches a `recompile` that has nothing to recompile, so a session
	 * that never opens the preview should not pay for them.
	 *
	 * A request and not a result, because a cell in a project that has not
	 * installed the extension produces no result, and the manifest watcher is
	 * what lets it start working once the extension is installed.
	 */
	private watchFiles(): void {
		if (this.watching) {
			return;
		}
		this.watching = true;
		// One glob covers `_brand/_brand.yml` as well, because a leading `**/`
		// matches the directory as readily as any other.
		this.watch(CONTEXT_FILE_GLOB);
		this.watch(TYPST_FILE_GLOB);
		// The gate answer is held with the rest of the context, so a project that
		// installs the extension while the preview is open stops reporting a cell as
		// unpreviewable without waiting for a cache to expire.
		this.watch(EXTENSION_MANIFEST_GLOB);
	}

	/** Rebuild the preview when a file it reads beside the block changes. */
	private watch(glob: string): void {
		const watcher = vscode.workspace.createFileSystemWatcher(glob);
		const changed = (): void => this.contextDebounce();
		this.disposables.push(watcher.onDidCreate(changed));
		this.disposables.push(watcher.onDidChange(changed));
		this.disposables.push(watcher.onDidDelete(changed));
		this.disposables.push(watcher);
	}

	/**
	 * Whether a selection change asks a question the result does not answer.
	 *
	 * The cursor is compared against the block on screen. Its offsets are those
	 * of the version it was read from, which is enough here: an edit inside the
	 * block moves its end by what was typed, and the cursor moves with it.
	 */
	private movedBlock(event: vscode.TextEditorSelectionChangeEvent): boolean {
		const shown = this.shown();
		if (shown === undefined || shown.uri.toString() !== event.textEditor.document.uri.toString()) {
			return true;
		}
		const offset = event.textEditor.document.offsetAt(event.selections[0].active);
		return offset < shown.block.fenceStart || offset > shown.block.bodyEnd;
	}

	private handleDocumentChange(event: vscode.TextDocumentChangeEvent): void {
		if (isContextDocument(event.document)) {
			// The chain prefers the copy open in the editor, so an unsaved edit to one
			// of these files is what the next request would read. This is asked ahead
			// of the surface, because what it forgets outlives the surface: an edit
			// made while the panel is closed is still what the next request reads, and
			// the recompile behind it does nothing until there is something to show.
			this.contextDebounce();
			return;
		}
		if (!this.options.hasSurface()) {
			// Nothing is showing a preview, so nothing would render the result. The
			// document change events of a whole session arrive here, so this is the
			// one place where the cost of a keystroke is worth naming.
			return;
		}
		if (!isRelevantDocument(event.document) || event.contentChanges.length === 0) {
			return;
		}
		// The block on screen, and not the last compile: a hover moves the last
		// compile to another block, and asking about that one would read an edit
		// inside the block the reader is looking at as an edit that changes nothing.
		const shown = this.shown();
		if (shown !== undefined && shown.uri.toString() === event.document.uri.toString()) {
			// A raw block compiles under every raw block above it, so it is sensitive
			// to a change at any lower offset and not only to one inside it. An edit
			// that reaches neither compiles to the image already on screen.
			if (!event.contentChanges.some((change) => invalidatesPreview(shown.block, change))) {
				return;
			}
		}
		this.scheduleDocument(event.document);
	}
}
