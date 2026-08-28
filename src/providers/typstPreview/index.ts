import * as vscode from "vscode";
import * as path from "node:path";
import { getErrorMessage } from "@quarto-wizard/core";
import { blockAtOffset, findTypstBlocks, type TypstBlock } from "../../utils/typst/typstBlocks";
import { buildPlainSource, buildRawSource } from "../../utils/typst/typstSource";
import { parseTypstStderr, typstMessages } from "../../utils/typst/typstDiagnostics";
import { logMessage, showMessageWithLogs } from "../../utils/log";
import { TypstCompiler, invalidateTypstBinary, resolveTypstBinary } from "./typstCompiler";
import { TypstPreviewPanel } from "./typstPreviewPanel";

/**
 * The page setup every preview compiles with.
 *
 * A block is a fragment and not a document, so the page has to shrink to it.
 * The margin is not decoration: on a `width: auto` page the glyphs of the
 * outermost characters clip at the edge of the viewBox without it.
 */
const PAGE_SETUP = "#set page(width: auto, height: auto, margin: 0.5em)";

/** Read the source from stdin, write the image to stdout. */
const ARGV = ["compile", "--format", "svg", "-", "-"];

/**
 * The one line a failure shows inside the panel.
 *
 * Exported for its tests. The choice of which diagnostic to show carries most
 * of the behaviour, and it is not reachable through the command.
 */
export function errorText(stderr: string, injectedLines: number): string {
	const diagnostics = parseTypstStderr(stderr, injectedLines);
	// A warning can sit above the error that stopped the compile, so the first
	// diagnostic is not the one to show. Headlining a failure as a warning
	// misstates why there is no image.
	const mapped = diagnostics.find((diagnostic) => diagnostic.severity === "error") ?? diagnostics[0];
	if (mapped) {
		if (mapped.line === undefined) {
			// A package that would not download, or an input Typst could not read.
			// Naming a position here would point at a character that has nothing to
			// do with the failure.
			return `${mapped.severity}: ${mapped.message}`;
		}
		// The line is counted inside the block, while the panel header counts
		// document lines, so it says which of the two it means.
		const column = (mapped.column ?? 0) + 1;
		return `${mapped.severity} at line ${mapped.line + 1}, column ${column} of the block: ${mapped.message}`;
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
function headerText(document: vscode.TextDocument, block: TypstBlock): string {
	const place = `${path.basename(document.fileName)} · line ${block.fenceLine + 1}`;
	// A raw block reaches Typst through the document template, which contributes
	// imports, show rules and set directives the preview cannot apply. Saying so
	// beside the image is what stops a divergence being read as a defect.
	return block.kind === "raw" ? `${place} · raw passthrough, document template not applied` : place;
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
		});
		return held;
	};

	const usePanel = (): TypstPreviewPanel => panel ?? holdPanel(TypstPreviewPanel.create(context.extensionUri));

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
		// The whole list is kept, because a raw block compiles with the raw blocks
		// above it and scanning the document a second time to find them would say
		// the same thing twice.
		const blocks = findTypstBlocks(document.getText());
		const block = blockAtOffset(blocks, document.offsetAt(editor.selection.active));
		if (block === undefined) {
			explain("Put the cursor inside a Typst block to preview it.");
			return;
		}
		if (block.kind === "cell") {
			// A cell needs its options resolved and its extension present.
			// Compiling it alone would show an image that the render does not
			// produce.
			explain("A `{typst}` cell cannot be previewed yet.");
			return;
		}

		const binary = await resolveTypstBinary();
		if (binary === undefined) {
			reportUnavailable("The Typst preview needs the Typst binary that ships inside Quarto, and it was not found.");
			return;
		}
		compiler ??= new TypstCompiler(binary);

		const surface = usePanel();
		surface.reveal();

		const assembled =
			block.kind === "raw" ? buildRawSource(blocks, block, PAGE_SETUP) : buildPlainSource(block, PAGE_SETUP);
		try {
			const result = await compiler.compile(assembled.source, ARGV, uncancelled.token);
			if (result.svg === undefined) {
				logMessage(`Typst preview: the compiler reported:\n${result.stderr}`, "debug");
				surface.showError(errorText(result.stderr, assembled.injectedLines));
				return;
			}
			if (result.stderr.length > 0) {
				logMessage(`Typst preview: the compiler warned:\n${result.stderr}`, "debug");
			}
			surface.show(result.svg, headerText(document, block));
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

	// Installing or removing the Quarto extension changes where the binary is, or
	// whether there is one at all.
	context.subscriptions.push(
		vscode.extensions.onDidChange(() => {
			invalidateTypstBinary();
			compiler?.dispose();
			compiler = undefined;
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
