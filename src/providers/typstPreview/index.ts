import * as vscode from "vscode";
import * as path from "node:path";
import { typstBlockAt, type TypstBlock } from "../../utils/typst/typstBlocks";
import { parseTypstStderr } from "../../utils/typst/typstDiagnostics";
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

/** How many lines {@link PAGE_SETUP} adds above the block body. */
const INJECTED_LINES = 1;

/** Read the source from stdin, write the image to stdout. */
const ARGV = ["compile", "--format", "svg", "-", "-"];

/** The first line of a failure, as it is shown inside the panel. */
function errorText(stderr: string): string {
	const diagnostics = parseTypstStderr(stderr, INJECTED_LINES);
	if (diagnostics.length === 0) {
		return "Typst produced no image and reported nothing.";
	}
	const first = diagnostics[0];
	return `${first.severity} at line ${first.line + 1}, column ${first.column + 1}: ${first.message}`;
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
	let compiling: vscode.CancellationTokenSource | undefined;
	// One message per session, so a machine that cannot run the preview at all
	// does not report the same thing on every request.
	let reportedUnavailable = false;

	/** The one panel, adopting a restored one when the window was reloaded. */
	const usePanel = (restored?: TypstPreviewPanel): TypstPreviewPanel => {
		if (panel === undefined) {
			panel = restored ?? TypstPreviewPanel.create(context.extensionUri);
			panel.onDidDispose(() => {
				panel = undefined;
			});
		} else if (restored !== undefined && restored !== panel) {
			restored.dispose();
		}
		return panel;
	};

	/**
	 * Say why there is nothing to show.
	 *
	 * An open panel takes the message itself, which is both quieter and closer to
	 * the thing the reader is looking at than a notification would be.
	 */
	const report = (message: string): void => {
		logMessage(`Typst preview: ${message}`, "debug");
		if (panel) {
			panel.showError(message);
			return;
		}
		void showMessageWithLogs(message, "warning");
	};

	/** Say once that the feature cannot run here at all. */
	const reportUnavailable = (message: string): void => {
		logMessage(`Typst preview: ${message}`, "debug");
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

		compiling?.cancel();
		compiling?.dispose();
		const cancellation = new vscode.CancellationTokenSource();
		compiling = cancellation;

		try {
			const result = await compiler.compile(`${PAGE_SETUP}\n${block.body}`, ARGV, cancellation.token);
			if (result.svg === undefined) {
				logMessage(`Typst preview: the compiler reported:\n${result.stderr}`, "debug");
				surface.showError(errorText(result.stderr));
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
			const message = error instanceof Error ? error.message : String(error);
			logMessage(`Typst preview: ${message}`, "error");
			surface.showError(message);
		} finally {
			if (compiling === cancellation) {
				compiling = undefined;
			}
			cancellation.dispose();
		}
	};

	context.subscriptions.push(vscode.commands.registerCommand("quartoWizard.previewTypstBlock", () => preview()));

	// A window reload restores the panel. Recompile into it rather than restoring
	// a serialised image, which would be stale the moment the document changed.
	context.subscriptions.push(
		vscode.window.registerWebviewPanelSerializer(TypstPreviewPanel.viewType, {
			deserializeWebviewPanel: async (restored: vscode.WebviewPanel) => {
				usePanel(new TypstPreviewPanel(restored, context.extensionUri));
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
			compiling?.cancel();
			compiling?.dispose();
			compiler?.dispose();
			panel?.dispose();
		},
	});

	logMessage("Typst preview registered.", "debug");
}
