import * as vscode from "vscode";
import * as path from "node:path";
import { getErrorMessage } from "@quarto-wizard/core";
import { isUnavailable, themeHeader, type TypstThemeKind } from "../../utils/typst/typstSource";
import { parseTypstStderr, typstMessages } from "../../utils/typst/typstDiagnostics";
import { logMessage, showMessageWithLogs } from "../../utils/log";
import { buildCompileRequest, type CompileRequest } from "./typstContext";
import { DEFAULT_TIMEOUT_MS, TypstCompiler, invalidateTypstBinary, resolveTypstBinary } from "./typstCompiler";
import { TypstPreviewPanel } from "./typstPreviewPanel";

/** Read the source from stdin, write the image to stdout. */
const ARGV = ["compile", "--format", "svg", "-", "-"];

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

/** What the settings say about previewing one document. */
interface TypstPreviewSettings {
	foreground: string;
	background: string;
	timeoutMs: number;
}

/** The bounds `package.json` declares, repeated here because it cannot enforce them. */
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 300000;

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

/**
 * A usable compile timeout, whatever the setting holds.
 *
 * Exported for its tests. The bounds in `package.json` only guide the settings
 * user interface, so a hand-edited `settings.json` reaches `setTimeout`
 * unchecked, and `0` there fails every preview before Typst has read anything.
 */
export function previewTimeoutMs(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return DEFAULT_TIMEOUT_MS;
	}
	return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, value));
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

/** The text colour the settings and the active theme resolve to. */
function resolvedForeground(document: vscode.TextDocument): string {
	const settings = previewSettings(document);
	return themeHeader(themeKindOf(vscode.window.activeColorTheme.kind), settings.foreground, settings.background)
		.foreground;
}

/**
 * The one line a failure shows inside the panel.
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

/** What the panel shows about the block it is displaying. */
function headerText(document: vscode.TextDocument, request: CompileRequest): string {
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

/**
 * Register the Typst block preview.
 *
 * The feature is inert unless the workspace is trusted and Quarto ships a Typst
 * binary. Neither condition is worth a prompt: the extension does many other
 * things, and a user who never writes a Typst block should never hear about it.
 */
export function registerTypstPreview(context: vscode.ExtensionContext): void {
	let panel: TypstPreviewPanel | undefined;
	let compiler: TypstCompiler | undefined;
	// The compiler reads its timeout once, and the setting is resource scoped, so
	// the value it was built with is kept to know when it no longer applies.
	let compilerTimeoutMs: number | undefined;
	// The colour the image on screen was compiled with, so a theme change can
	// tell a new colour from a theme that resolves to the same one.
	let shownForeground: string | undefined;
	// One message per session, so a machine that cannot run the preview at all
	// does not report the same thing on every request.
	let reportedUnavailable = false;
	// The compiler supersedes its own running child, so the caller has nothing to
	// cancel. This source is never cancelled, and exists only because `compile`
	// takes a token and the API has no ready-made one that never fires.
	const uncancelled = new vscode.CancellationTokenSource();
	context.subscriptions.push(uncancelled);

	/** Keep a panel, and forget it when the user closes it. */
	const holdPanel = (held: TypstPreviewPanel): TypstPreviewPanel => {
		panel = held;
		held.onDidDispose(() => {
			panel = undefined;
			// There is no image on screen any more, so no colour describes one.
			shownForeground = undefined;
		});
		return held;
	};

	const usePanel = (): TypstPreviewPanel => panel ?? holdPanel(TypstPreviewPanel.create(context.extensionUri));

	/**
	 * The compiler for these settings.
	 *
	 * The timeout is read once at construction and the setting is resource
	 * scoped, so the compiler is replaced when the value it was built with no
	 * longer applies. Nothing is lost by replacing it mid-run, because the next
	 * compile supersedes whatever is running anyway.
	 */
	const useCompiler = (binary: string, timeoutMs: number): TypstCompiler => {
		if (compiler === undefined || compilerTimeoutMs !== timeoutMs) {
			compiler?.dispose();
			compiler = new TypstCompiler(binary, { timeoutMs });
			compilerTimeoutMs = timeoutMs;
		}
		return compiler;
	};

	/**
	 * Put a message in front of the reader.
	 *
	 * An open panel takes the message itself, which is both quieter and closer to
	 * the thing the reader is looking at than a notification would be. It is
	 * revealed as well: a message written into a background tab is a command that
	 * appears to do nothing.
	 */
	const show = (message: string): void => {
		if (panel) {
			panel.reveal();
			panel.showError(message);
			return;
		}
		void showMessageWithLogs(message, "warning");
	};

	/** Say why there is nothing to show. */
	const report = (message: string): void => {
		logMessage(`Typst preview: ${message}`, "debug");
		show(message);
	};

	/**
	 * Say once that the feature cannot run here at all.
	 *
	 * The log line is not part of what is said once. The binary probe caches its
	 * result and logs only on the first attempt, so without this every later
	 * attempt on an unavailable machine would leave no trace at all, and the log
	 * would stop being enough to diagnose an inert preview.
	 */
	const reportUnavailable = (message: string): void => {
		logMessage(`Typst preview: ${message}`, "debug");
		if (reportedUnavailable) {
			return;
		}
		reportedUnavailable = true;
		show(message);
	};

	/**
	 * Compile the block under the cursor into the panel.
	 *
	 * @param asked - Whether the user asked for this. A restore did not, and at
	 *   that moment the editors are often not back yet, so saying that no block
	 *   is under the cursor would be an error message on most window reloads.
	 */
	const preview = async (asked: boolean): Promise<void> => {
		const explain = (message: string): void => {
			if (asked) {
				report(message);
			}
		};

		if (!vscode.workspace.isTrusted) {
			reportUnavailable("The Typst preview needs a trusted workspace, because it runs the Typst compiler.");
			return;
		}

		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			explain("Open a Quarto document to preview a Typst block.");
			return;
		}

		const document = editor.document;
		const settings = previewSettings(document);
		// The header applies to a plain block and a raw block. A cell keeps the
		// colour contract of the filter instead, and drops it.
		const { header, foreground } = themeHeader(
			themeKindOf(vscode.window.activeColorTheme.kind),
			settings.foreground,
			settings.background,
		);
		const request = await buildCompileRequest(document, editor.selection.active, header);
		if (isUnavailable(request)) {
			explain(request.unavailable);
			return;
		}

		const binary = await resolveTypstBinary();
		if (binary === undefined) {
			reportUnavailable("The Typst preview needs the Typst binary that ships inside Quarto, and it was not found.");
			return;
		}

		const surface = usePanel();
		surface.reveal();

		try {
			const result = await useCompiler(binary, settings.timeoutMs).compile(request.source, ARGV, uncancelled.token);
			if (result.svg === undefined) {
				logMessage(`Typst preview: the compiler reported:\n${result.stderr}`, "debug");
				surface.showError(errorText(result.stderr, request));
				return;
			}
			if (result.stderr.length > 0) {
				logMessage(`Typst preview: the compiler warned:\n${result.stderr}`, "debug");
			}
			// Recorded here and nowhere else. A failed compile leaves the last good
			// image on screen, so the colour that image was compiled with is still
			// the colour the reader is looking at.
			shownForeground = foreground;
			surface.show(result.svg, headerText(document, request));
		} catch (error) {
			if (error instanceof vscode.CancellationError) {
				return;
			}
			const message = getErrorMessage(error);
			logMessage(`Typst preview: ${message}`, "error");
			surface.showError(message);
		}
	};

	context.subscriptions.push(vscode.commands.registerCommand("quartoWizard.previewTypstBlock", () => preview(true)));

	// A window reload restores the panel. Recompile into it rather than restoring
	// a serialised image, which would be stale the moment the document changed.
	context.subscriptions.push(
		vscode.window.registerWebviewPanelSerializer(TypstPreviewPanel.viewType, {
			deserializeWebviewPanel: async (restored: vscode.WebviewPanel) => {
				if (panel) {
					restored.dispose();
					return;
				}
				holdPanel(new TypstPreviewPanel(restored, context.extensionUri));
				await preview(false);
			},
		}),
	);

	// The text colour is derived from the theme kind and baked into the image, so
	// a theme change leaves the panel showing the wrong one. The panel background
	// is a CSS variable and needs no help, and two themes of the same kind
	// resolve to the same colour, so only a colour that actually changed is worth
	// a compile.
	context.subscriptions.push(
		vscode.window.onDidChangeActiveColorTheme(() => {
			const editor = vscode.window.activeTextEditor;
			if (panel === undefined || editor === undefined || resolvedForeground(editor.document) === shownForeground) {
				return;
			}
			void preview(false);
		}),
	);

	// Installing or removing the Quarto extension changes where the binary is, or
	// whether there is one at all.
	context.subscriptions.push(
		vscode.extensions.onDidChange(() => {
			invalidateTypstBinary();
			compiler?.dispose();
			compiler = undefined;
			compilerTimeoutMs = undefined;
			reportedUnavailable = false;
		}),
	);

	context.subscriptions.push({
		dispose: () => {
			compiler?.dispose();
			panel?.dispose();
		},
	});

	logMessage("Typst preview registered.", "debug");
}
