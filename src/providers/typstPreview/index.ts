import * as vscode from "vscode";
import * as path from "node:path";
import { getErrorMessage } from "@quarto-wizard/core";
import { typstBlockAt, type TypstBlock } from "../../utils/typst/typstBlocks";
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

/** One compile request. */
interface AssembledSource {
	/** The whole source to send to the compiler. */
	source: string;
	/**
	 * How many lines sit above the block body.
	 *
	 * A diagnostic reports a position in the assembled source, so it has to lose
	 * these before it means anything in the document.
	 */
	injectedLines: number;
}

/**
 * The source for one block.
 *
 * The count travels with the source rather than beside it, because it stops
 * being a constant as soon as a raw block prepends the blocks before it, or a
 * cell prepends its resolved options.
 */
function assembleSource(block: TypstBlock): AssembledSource {
	return { source: `${PAGE_SETUP}\n${block.body}`, injectedLines: 1 };
}

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
		// The line is counted inside the block, while the panel header counts
		// document lines, so it says which of the two it means.
		return `${mapped.severity} at line ${mapped.line + 1}, column ${mapped.column + 1} of the block: ${mapped.message}`;
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
	return `${path.basename(document.fileName)} · line ${block.fenceLine + 1}`;
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
	 * Say why there is nothing to show.
	 *
	 * An open panel takes the message itself, which is both quieter and closer to
	 * the thing the reader is looking at than a notification would be.
	 */
	const report = (message: string): void => {
		logMessage(`Typst preview: ${message}`, "debug");
		if (panel) {
			// Reveal it as well. A message written into a panel sitting in a
			// background tab is a command that appears to do nothing.
			panel.reveal();
			panel.showError(message);
			return;
		}
		void showMessageWithLogs(message, "warning");
	};

	/** Say once that the feature cannot run here at all. */
	const reportUnavailable = (message: string): void => {
		if (reportedUnavailable) {
			return;
		}
		reportedUnavailable = true;
		report(message);
	};

	const preview = async (): Promise<void> => {
		if (!vscode.workspace.isTrusted) {
			reportUnavailable("The Typst preview needs a trusted workspace, because it runs the Typst compiler.");
			return;
		}

		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			report("Open a Quarto document to preview a Typst block.");
			return;
		}

		const document = editor.document;
		const block = typstBlockAt(document.getText(), document.offsetAt(editor.selection.active));
		if (block === undefined) {
			report("Put the cursor inside a Typst block to preview it.");
			return;
		}
		if (block.kind !== "plain") {
			// A raw block needs the ones before it, and a cell needs its options
			// resolved. Compiling either one alone would show an image that the
			// render does not produce.
			report(`A \`${block.kind}\` Typst block cannot be previewed yet.`);
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

		const assembled = assembleSource(block);
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

	context.subscriptions.push(vscode.commands.registerCommand("quartoWizard.previewTypstBlock", () => preview()));

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
				await preview();
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
