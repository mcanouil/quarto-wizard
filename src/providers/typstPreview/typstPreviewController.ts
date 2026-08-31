import * as vscode from "vscode";
import * as path from "node:path";
import { getErrorMessage } from "@quarto-wizard/core";
import { invalidatesPreview, type TypstBlock } from "../../utils/typst/typstBlocks";
import { isUnavailable, themeHeader, type TypstThemeKind } from "../../utils/typst/typstSource";
import { parseTypstStderr, typstMessages } from "../../utils/typst/typstDiagnostics";
import { debounce, type DebouncedFunction } from "../../utils/debounce";
import { generateHashKey } from "../../utils/hash";
import { logMessage } from "../../utils/log";
import { isQmdFile } from "../../utils/metadataFilesRegistry";
import { EXTENSION_MANIFEST_GLOB } from "../../utils/quartoProjectDiscovery";
import { buildCompileRequest, TypstContextCache, type CompileRequest } from "./typstContext";
import {
	DEFAULT_TIMEOUT_MS,
	TypstCompiler,
	invalidateTypstBinary,
	resolveTypstBinary,
	type TypstCompileResult,
} from "./typstCompiler";

/**
 * The one owner of the preview state.
 *
 * The surfaces are thin renderers of whatever it publishes, so there is one
 * answer to what is being previewed rather than one per surface, and one place
 * that decides when a compile is worth running.
 */

/** Read the source from stdin, write the image to stdout. */
const ARGV = ["compile", "--format", "svg", "-", "-"];

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
const CACHE_LIMIT = 32;

/**
 * How many bytes of image the remembered results may hold together.
 *
 * The count alone is not a bound. One compile may produce up to the compiler's
 * own output limit, which is measured in megabytes, so a cache of a few dense
 * pages would hold far more of the extension host than the count suggests.
 */
const CACHE_LIMIT_BYTES = 16 * 1024 * 1024;

/** The bounds `package.json` declares, repeated here because it cannot enforce them. */
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 300000;
const MIN_DEBOUNCE_MS = 0;
const MAX_DEBOUNCE_MS = 5000;

/** The document change delay `package.json` declares. */
export const DEFAULT_DEBOUNCE_MS = 300;

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
 * `asked` describes the request and not the block, so it is not part of the
 * result: a surface reading `current()` later would find it describing a
 * request that is long over.
 */
export interface TypstPreviewUpdate {
	/** What is being previewed, absent when there is nothing any more. */
	result?: TypstPreviewResult;
	/** Whether the user asked for this, rather than an edit driving it. */
	asked: boolean;
}

/** What a surface needs to render the current preview. */
export interface TypstPreviewResult {
	/** The document the block belongs to. */
	uri: vscode.Uri;
	/** The block that was previewed. */
	block: TypstBlock;
	/** Where that block sits in the document, which is its identity across an edit. */
	blockIndex: number;
	/** The image on screen, which is the last one this block compiled to. */
	svg?: string;
	/** What the surface says about the block beside the image. */
	header: string;
	/** The one line a failure shows, absent when the compile produced an image. */
	error?: string;
}

/** What the controller needs of a compiler, which is what makes it stubbable. */
export interface TypstCompilerLike {
	compile(source: string, argv: string[], token: vscode.CancellationToken): Promise<TypstCompileResult>;
	dispose(): void;
}

/** How the controller reaches the parts of the world it does not own. */
export interface TypstPreviewControllerOptions {
	/**
	 * Whether a surface is showing a preview now.
	 *
	 * A background edit is only worth a compile when something is displaying the
	 * result. A request the user asked for compiles either way, because the
	 * surface it opens is the answer.
	 */
	hasSurface: () => boolean;
	/** Put a message in front of the reader. */
	show: (message: string) => void;
	/** The Typst binary. Injected so that no test spawns Typst. */
	resolveBinary?: () => Promise<string | undefined>;
	/** The compiler for one binary and one timeout. Injected for the same reason. */
	createCompiler?: (binary: string, timeoutMs: number) => TypstCompilerLike;
}

/** What the settings say about compiling one document. */
interface TypstPreviewSettings {
	foreground: string;
	background: string;
	timeoutMs: number;
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
 * A usable colour setting, whatever the setting holds.
 *
 * Exported for its tests. `package.json` declares the type, and a hand-edited
 * `settings.json` ignores it, so a value that is not a string reaches the
 * header and is trimmed there.
 */
export function previewColour(value: unknown): string {
	// The header trims the value, so a value that is not a string throws where
	// nothing catches it, and the panel opens and then stays empty.
	return typeof value === "string" ? value : "auto";
}

/** A number setting held inside its bounds, whatever the setting holds. */
function boundedNumber(value: unknown, fallback: number, lowest: number, highest: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.min(highest, Math.max(lowest, value));
}

/**
 * A usable compile timeout, whatever the setting holds.
 *
 * Exported for its tests. The bounds in `package.json` only guide the settings
 * user interface, so a hand-edited `settings.json` reaches `setTimeout`
 * unchecked, and `0` there fails every preview before Typst has read anything.
 */
export function previewTimeoutMs(value: unknown): number {
	return boundedNumber(value, DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
}

/**
 * A usable document change delay, whatever the setting holds.
 *
 * Exported for its tests. Zero is allowed and means a compile per keystroke,
 * which a fast machine can carry, and the upper bound stops a mistyped value
 * from looking like a preview that never updates.
 */
export function previewDebounceMs(value: unknown): number {
	return boundedNumber(value, DEFAULT_DEBOUNCE_MS, MIN_DEBOUNCE_MS, MAX_DEBOUNCE_MS);
}

/**
 * The settings in force for one document.
 *
 * They are resource scoped, so a multi-root workspace can hold a different
 * answer per folder, and the document is what says which folder that is.
 */
function previewSettings(document: vscode.TextDocument): TypstPreviewSettings {
	const config = vscode.workspace.getConfiguration("quartoWizard.typstPreview", document.uri);
	return {
		foreground: previewColour(config.get("foreground")),
		background: previewColour(config.get("background")),
		timeoutMs: previewTimeoutMs(config.get<number>("timeoutMs", DEFAULT_TIMEOUT_MS)),
	};
}

/** How long an edit waits before the preview follows it. */
function documentDelayOf(document: vscode.TextDocument): number {
	const config = vscode.workspace.getConfiguration("quartoWizard.typstPreview", document.uri);
	return previewDebounceMs(config.get<number>("debounceMs", DEFAULT_DEBOUNCE_MS));
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
	private compiler: TypstCompilerLike | undefined;
	/** What the compiler was built for, so it is replaced when that changes. */
	private compilerKey: string | undefined;
	/** How many bytes of image the cache is holding. */
	private cacheBytes = 0;
	/** Whether the file watchers are up, which the first published result raises. */
	private watching = false;
	/** Rises with every request, so a result that arrives out of order is dropped. */
	private requestVersion = 0;
	private result: TypstPreviewResult | undefined;
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

	/** What is being previewed, which is what a surface renders. */
	current(): TypstPreviewResult | undefined {
		return this.result;
	}

	/** Preview the block under a position, because the user asked for it. */
	request(document: vscode.TextDocument, position: vscode.Position): void {
		void this.run(document, position, true);
	}

	/** Preview the block under the cursor again, because something changed. */
	refresh(): void {
		const editor = vscode.window.activeTextEditor;
		if (editor === undefined || !isRelevantDocument(editor.document)) {
			return;
		}
		void this.run(editor.document, editor.selection.active, false);
	}

	/**
	 * Compile the block that is on screen again, wherever the cursor is now.
	 *
	 * This is what a theme, a setting or a file the preview reads changing asks
	 * for. Those change the image of the block being looked at, and the cursor
	 * may have moved on to a document with no block in it at all, so following the
	 * cursor here would leave the panel showing an image nothing recompiled.
	 *
	 * The block is found again by its place in the document rather than by the
	 * offsets it carried, which move under every edit above it.
	 */
	recompile(): void {
		const shown = this.result;
		if (shown === undefined) {
			return;
		}
		const document = vscode.workspace.textDocuments.find((open) => open.uri.toString() === shown.uri.toString());
		if (document === undefined) {
			return;
		}
		const block = this.contexts.blocksOf(document, document.getText())[shown.blockIndex];
		if (block === undefined) {
			return;
		}
		void this.run(document, document.positionAt(block.fenceStart), false);
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
	}

	/** One preview, from a position to a published result. */
	private async run(document: vscode.TextDocument, position: vscode.Position, asked: boolean): Promise<void> {
		if (this.disposed || (!asked && !this.options.hasSurface())) {
			return;
		}

		const version = ++this.requestVersion;
		// A newer request has started, or the controller has gone, or the document
		// has. A closed document raised its own event already, so publishing a
		// result for it here would bring back a preview that was taken away.
		const stale = (): boolean => this.disposed || version !== this.requestVersion || document.isClosed;

		if (!vscode.workspace.isTrusted) {
			this.reportUnavailable("The Typst preview needs a trusted workspace, because it runs the Typst compiler.");
			return;
		}

		const settings = previewSettings(document);
		// The header applies to a plain block and a raw block. A cell keeps the
		// colour contract of the filter instead, and drops it.
		const { header } = themeHeader(
			themeKindOf(vscode.window.activeColorTheme.kind),
			settings.foreground,
			settings.background,
		);
		const request = await buildCompileRequest(document, position, header, this.contexts);
		if (stale()) {
			return;
		}
		if (isUnavailable(request)) {
			// Said only to a reader who asked. An edit or a cursor move that lands
			// outside every block is not a question, so answering it would put a
			// message in front of someone who did nothing.
			logMessage(`Typst preview: ${request.unavailable}`, "debug");
			if (asked) {
				this.options.show(request.unavailable);
			}
			return;
		}

		const binary = await this.resolveBinary();
		if (binary === undefined) {
			this.reportUnavailable(
				"The Typst preview needs the Typst binary that ships inside Quarto, and it was not found.",
			);
			return;
		}
		if (stale()) {
			return;
		}

		// The image is decided by the source, the arguments and the binary, and by
		// nothing else. Two documents that assemble to the same source share the
		// entry, which is what makes an undone keystroke free.
		// Joined on a character no argument and no Typst source carries, so two
		// different triples cannot be spelled the same way.
		const key = generateHashKey([binary, ...ARGV, request.source].join("\u0000"));
		const held = this.cache.get(key);
		if (held !== undefined) {
			// Re-inserted so the least recently used entry is the first one, which is
			// what the eviction below removes.
			this.cache.delete(key);
			this.cache.set(key, held);
			this.publish(document, request, held, asked);
			return;
		}

		try {
			const compiled = await this.useCompiler(binary, settings.timeoutMs).compile(
				request.source,
				ARGV,
				this.uncancelled.token,
			);
			if (stale()) {
				return;
			}
			this.remember(key, compiled);
			this.publish(document, request, compiled, asked);
		} catch (error) {
			if (stale() || error instanceof vscode.CancellationError) {
				return;
			}
			const message = getErrorMessage(error);
			logMessage(`Typst preview: ${message}`, "error");
			this.publish(document, request, { stderr: "" }, asked, message);
		}
	}

	/** Publish what one compile means for the surfaces. */
	private publish(
		document: vscode.TextDocument,
		request: CompileRequest,
		compiled: TypstCompileResult,
		asked: boolean,
		failure?: string,
	): void {
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
		const sameBlock =
			this.result?.uri.toString() === document.uri.toString() && this.result?.blockIndex === request.blockIndex;
		this.result = {
			uri: document.uri,
			block: request.block,
			blockIndex: request.blockIndex,
			svg: compiled.svg ?? (sameBlock ? this.result?.svg : undefined),
			header: headerText(document, request),
			error: compiled.svg === undefined ? (failure ?? errorText(compiled.stderr, request)) : undefined,
		};
		this.watchFiles();
		this.resultEmitter.fire({ result: this.result, asked });
	}

	/** Remember one compile, and forget those used longest ago to make room. */
	private remember(key: string, compiled: TypstCompileResult): void {
		this.cache.set(key, compiled);
		this.cacheBytes += compiled.svg?.length ?? 0;
		// A `Map` iterates in insertion order and every hit is re-inserted, so the
		// first key is the one used longest ago. Both bounds matter: the count keeps
		// a session of small blocks from growing without end, and the byte total
		// keeps a handful of dense pages from holding the extension host.
		while (this.cache.size > CACHE_LIMIT || (this.cacheBytes > CACHE_LIMIT_BYTES && this.cache.size > 1)) {
			const oldest = this.cache.keys().next();
			if (oldest.done) {
				return;
			}
			this.cacheBytes -= this.cache.get(oldest.value)?.svg?.length ?? 0;
			this.cache.delete(oldest.value);
		}
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
		const key = `${binary} ${timeoutMs}`;
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
		// The delay is fixed when a debouncer is built, so it is read once and kept
		// rather than on every keystroke. A configuration change forgets it, which
		// is the only event that can move it.
		if (this.documentDebounce === undefined) {
			this.documentDebounce = debounce(() => this.refresh(), documentDelayOf(document));
		}
		this.documentDebounce();
	}

	/** Drop the debouncer, so the next edit reads the delay again. */
	private forgetDocumentDelay(): void {
		this.documentDebounce?.cancel();
		this.documentDebounce = undefined;
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
				if (this.result?.uri.toString() === document.uri.toString()) {
					this.result = undefined;
					this.resultEmitter.fire({ asked: false });
				}
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
	 * Raised by the first published result rather than at registration. These are
	 * workspace-wide watchers, and until something is being previewed every event
	 * they deliver reaches a `recompile` that has nothing to recompile, so a
	 * session that never opens the preview should not pay for them.
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
		const shown = this.result;
		if (shown === undefined || shown.uri.toString() !== event.textEditor.document.uri.toString()) {
			return true;
		}
		const offset = event.textEditor.document.offsetAt(event.selections[0].active);
		return offset < shown.block.fenceStart || offset > shown.block.bodyEnd;
	}

	private handleDocumentChange(event: vscode.TextDocumentChangeEvent): void {
		if (!this.options.hasSurface()) {
			// Nothing is showing a preview, so nothing would render the result. The
			// document change events of a whole session arrive here, so this is the
			// one place where the cost of a keystroke is worth naming.
			return;
		}
		if (isContextDocument(event.document)) {
			// The chain prefers the copy open in the editor, so an unsaved edit to one
			// of these files is what the next request would read.
			this.contextDebounce();
			return;
		}
		if (!isRelevantDocument(event.document) || event.contentChanges.length === 0) {
			return;
		}
		const shown = this.result;
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
