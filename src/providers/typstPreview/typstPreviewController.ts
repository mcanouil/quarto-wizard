import * as vscode from "vscode";
import * as path from "node:path";
import { getErrorMessage } from "@quarto-wizard/core";
import { invalidatesPreview, type TypstBlock } from "../../utils/typst/typstBlocks";
import { isUnavailable, themeHeader, type TypstThemeKind } from "../../utils/typst/typstSource";
import { parseTypstStderr, typstMessages } from "../../utils/typst/typstDiagnostics";
import { debounce, type DebouncedFunction } from "../../utils/debounce";
import { generateHashKey } from "../../utils/hash";
import { logMessage } from "../../utils/log";
import { buildCompileRequest, TypstContextCache, type CompileRequest } from "./typstContext";
import { DEFAULT_TIMEOUT_MS, TypstCompiler, resolveTypstBinary, type TypstCompileResult } from "./typstCompiler";

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
 * bound. An entry is one image, which is tens of kilobytes.
 */
const CACHE_LIMIT = 32;

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
	/** Whether the user asked for this preview, rather than an edit driving it. */
	asked: boolean;
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

/** What the settings say about previewing one document. */
interface TypstPreviewSettings {
	foreground: string;
	background: string;
	timeoutMs: number;
	debounceMs: number;
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
		debounceMs: previewDebounceMs(config.get<number>("debounceMs", DEFAULT_DEBOUNCE_MS)),
	};
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
	return document.languageId === "quarto" || document.fileName.endsWith(".qmd");
}

/**
 * Whether a document is one a preview reads beside the block.
 *
 * These are the files the metadata chain, the brand and a `preamble:` come
 * from. An unsaved edit to one of them drives the preview the way an unsaved
 * edit to the document itself already does, because the chain prefers the copy
 * open in the editor.
 */
function isContextDocument(document: vscode.TextDocument): boolean {
	const name = path.basename(document.fileName);
	return /^_(quarto|metadata|brand)\.ya?ml$/.test(name) || name.endsWith(".typ") || /^_extension\.ya?ml$/.test(name);
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
	private readonly resultEmitter = new vscode.EventEmitter<TypstPreviewResult | undefined>();
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
	private documentDelayMs: number | undefined;
	private compiler: TypstCompilerLike | undefined;
	private compilerBinary: string | undefined;
	private compilerTimeoutMs: number | undefined;
	/** Rises with every request, so a result that arrives out of order is dropped. */
	private requestVersion = 0;
	private result: TypstPreviewResult | undefined;
	/** Said once per session, because an unavailable machine stays unavailable. */
	private reportedUnavailable = false;
	private disposed = false;

	/** Fires when the preview changes, with nothing when there is none any more. */
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

	/** Forget every compiled image, so the next request compiles again. */
	clearCache(): void {
		this.cache.clear();
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
		this.cache.clear();
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
		/** Say why there is nothing to show, and only to a reader who asked. */
		const explain = (message: string): void => {
			logMessage(`Typst preview: ${message}`, "debug");
			if (asked) {
				this.options.show(message);
			}
		};

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
			explain(request.unavailable);
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
		const header = headerText(document, request);
		if (compiled.svg !== undefined) {
			if (compiled.stderr.length > 0) {
				logMessage(`Typst preview: the compiler warned:\n${compiled.stderr}`, "debug");
			}
			this.result = {
				uri: document.uri,
				block: request.block,
				blockIndex: request.blockIndex,
				svg: compiled.svg,
				header,
				asked,
			};
			this.resultEmitter.fire(this.result);
			return;
		}

		if (failure === undefined) {
			logMessage(`Typst preview: the compiler reported:\n${compiled.stderr}`, "debug");
		}
		// The last good image of this block stays behind the error, because a parse
		// error is the normal state of a block halfway through an edit and clearing
		// the image would make the surface flash empty on almost every keystroke.
		// The image of another block is not kept: an error of one block over the
		// image of another says nothing true about either of them.
		const same =
			this.result !== undefined &&
			this.result.uri.toString() === document.uri.toString() &&
			this.result.blockIndex === request.blockIndex;
		this.result = {
			uri: document.uri,
			block: request.block,
			blockIndex: request.blockIndex,
			svg: same ? this.result?.svg : undefined,
			header,
			error: failure ?? errorText(compiled.stderr, request),
			asked,
		};
		this.resultEmitter.fire(this.result);
	}

	/** Remember one compile, and forget the one used longest ago. */
	private remember(key: string, compiled: TypstCompileResult): void {
		this.cache.set(key, compiled);
		if (this.cache.size <= CACHE_LIMIT) {
			return;
		}
		// A `Map` iterates in insertion order and every hit is re-inserted, so the
		// first key is the one used longest ago.
		const oldest = this.cache.keys().next();
		if (!oldest.done) {
			this.cache.delete(oldest.value);
		}
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
		if (this.compiler === undefined || this.compilerBinary !== binary || this.compilerTimeoutMs !== timeoutMs) {
			this.compiler?.dispose();
			this.compiler = this.options.createCompiler?.(binary, timeoutMs) ?? new TypstCompiler(binary, { timeoutMs });
			this.compilerBinary = binary;
			this.compilerTimeoutMs = timeoutMs;
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

	/** Forget the compiler, so the next request builds one from a fresh probe. */
	private forgetCompiler(): void {
		this.compiler?.dispose();
		this.compiler = undefined;
		this.compilerBinary = undefined;
		this.compilerTimeoutMs = undefined;
		this.reportedUnavailable = false;
	}

	/** Rebuild the preview after an edit, at the delay the settings ask for. */
	private scheduleDocument(document: vscode.TextDocument): void {
		const delayMs = previewSettings(document).debounceMs;
		// The delay is fixed when a debouncer is built and the setting is resource
		// scoped, so the debouncer is rebuilt when the value it holds no longer
		// applies. A pending rebuild is not lost: it is asked for again below.
		if (this.documentDebounce === undefined || this.documentDelayMs !== delayMs) {
			this.documentDebounce?.cancel();
			this.documentDelayMs = delayMs;
			this.documentDebounce = debounce(() => this.refresh(), delayMs);
		}
		this.documentDebounce();
	}

	private wireEvents(): void {
		this.disposables.push(
			// The cursor moving is what says which block is being looked at, and it
			// moves on every keystroke as well, so this is what keeps the block under
			// an edit current.
			vscode.window.onDidChangeTextEditorSelection((event) => {
				if (isRelevantDocument(event.textEditor.document)) {
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
					this.resultEmitter.fire(undefined);
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
					this.recompile();
				}
			}),
		);

		this.disposables.push(
			// Installing or removing the Quarto extension changes where the binary is,
			// or whether there is one at all.
			vscode.extensions.onDidChange(() => this.forgetCompiler()),
		);

		this.watch("**/_{quarto,metadata,brand}.{yml,yaml}");
		this.watch("**/_brand/_brand.{yml,yaml}");
		this.watch("**/*.typ");
		// The gate answer is held with the rest of the context, so a project that
		// installs the extension while the preview is open stops reporting a cell as
		// unpreviewable without waiting for a cache to expire.
		this.watch("**/_extensions/**/_extension.{yml,yaml}");
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

	private handleDocumentChange(event: vscode.TextDocumentChangeEvent): void {
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
