import * as vscode from "vscode";
import { logMessage, showMessageWithLogs } from "../../utils/log";
import { TypstPreviewController, type TypstPreviewUpdate } from "./typstPreviewController";
import { TypstPreviewPanel } from "./typstPreviewPanel";
import { TypstPreviewCodeLens } from "./typstPreviewCodeLens";
import { TypstPreviewHover } from "./typstPreviewHover";

/** The documents every surface is offered on. */
const SELECTOR: vscode.DocumentSelector = { language: "quarto" };

/**
 * Register the Typst block preview.
 *
 * The controller owns the state and every event, and this owns the surfaces
 * that render it. The feature is inert unless the workspace is trusted
 * and Quarto ships a Typst binary. Neither condition is worth a prompt: the
 * extension does many other things, and a user who never writes a Typst block
 * should never hear about it.
 */
export function registerTypstPreview(context: vscode.ExtensionContext): void {
	let panel: TypstPreviewPanel | undefined;

	/**
	 * Put a message in front of the reader.
	 *
	 * An open panel takes the message itself, which is both quieter and closer to
	 * the thing the reader is looking at than a notification would be. It is
	 * revealed as well: a message written into a background tab is a command that
	 * appears to do nothing. With no panel open there is nothing to write into,
	 * and a notification is the only place left.
	 */
	const show = (message: string): void => {
		if (panel) {
			panel.reveal();
			panel.showError(message);
			return;
		}
		void showMessageWithLogs(message, "warning");
	};

	// The panel is the only surface that renders every result it is given, so it
	// is the only one that makes a background edit worth a compile. A hover shows
	// nothing until the pointer rests, and drives its own compile when it does.
	const controller = new TypstPreviewController({ hasSurface: () => panel !== undefined, show });
	context.subscriptions.push(controller);

	/** Keep a panel, and forget it when the user closes it. */
	const holdPanel = (held: TypstPreviewPanel): TypstPreviewPanel => {
		panel = held;
		held.onDidDispose(() => {
			panel = undefined;
		});
		return held;
	};

	const usePanel = (): TypstPreviewPanel => panel ?? holdPanel(TypstPreviewPanel.create(context.extensionUri));

	/** Render one update, opening the panel when there is none yet. */
	const render = ({ result, reason }: TypstPreviewUpdate): void => {
		if (result === undefined) {
			// The document went away, or the feature was turned off for it, so there
			// is no block left to describe.
			panel?.clear();
			return;
		}
		if (reason === "surface") {
			// A hover compiled this for itself and is already showing it. The panel
			// follows the cursor, and a pointer rest is not a cursor move, so taking
			// this would move the panel to a block the reader never asked it to show.
			return;
		}
		const asked = reason === "asked";
		// Only a request the user made opens a panel. An edit renders into the one
		// already there, and never builds one, so a result that outlived the panel
		// it was compiled for does not reopen it.
		const surface = asked ? usePanel() : panel;
		if (surface === undefined) {
			return;
		}
		if (asked) {
			// The user asked, so the panel comes forward. Doing it on an edit would
			// pull the tab back over whatever they moved to.
			surface.reveal();
		}
		if (result.svg === undefined) {
			surface.clear();
		} else {
			surface.show(result.svg, result.header);
		}
		if (result.error !== undefined) {
			// Posted after the image, so it lands on top of it rather than underneath.
			surface.showError(result.error);
		}
	};

	context.subscriptions.push(controller.onDidChangeResult(render));

	/**
	 * The block a request means.
	 *
	 * A code lens names the block it sits above, which is not the block the
	 * cursor is in, so it passes both. Every other caller means the cursor.
	 */
	const resolveTarget = (
		uri?: vscode.Uri,
		at?: vscode.Position,
	): { document: vscode.TextDocument; position: vscode.Position } | undefined => {
		if (uri !== undefined && at !== undefined) {
			const named = vscode.workspace.textDocuments.find((open) => open.uri.toString() === uri.toString());
			return named === undefined ? undefined : { document: named, position: at };
		}
		const editor = vscode.window.activeTextEditor;
		return editor === undefined ? undefined : { document: editor.document, position: editor.selection.active };
	};

	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.previewTypstBlock", (uri?: vscode.Uri, at?: vscode.Position) => {
			const target = resolveTarget(uri, at);
			if (target === undefined) {
				show("Open a Quarto document to preview a Typst block.");
				return;
			}
			// Whether the document wants a preview at all is the controller's to
			// answer, because it is what spawns the process, and it says so itself.
			controller.request(target.document, target.position);
		}),
	);

	const codeLens = new TypstPreviewCodeLens(controller);
	context.subscriptions.push(codeLens);
	context.subscriptions.push(vscode.languages.registerCodeLensProvider(SELECTOR, codeLens));
	context.subscriptions.push(vscode.languages.registerHoverProvider(SELECTOR, new TypstPreviewHover(controller)));

	// A window reload restores the panel. Recompile into it rather than restoring
	// a serialised image, which would be stale the moment the document changed.
	// The restore is not something the user asked for, and at that moment the
	// editors are often not back yet, so a missing block says nothing.
	context.subscriptions.push(
		vscode.window.registerWebviewPanelSerializer(TypstPreviewPanel.viewType, {
			deserializeWebviewPanel: (restored: vscode.WebviewPanel) => {
				if (panel) {
					restored.dispose();
					return Promise.resolve();
				}
				holdPanel(new TypstPreviewPanel(restored, context.extensionUri));
				controller.refresh();
				return Promise.resolve();
			},
		}),
	);

	context.subscriptions.push({ dispose: () => panel?.dispose() });

	logMessage("Typst preview registered.", "debug");
}
