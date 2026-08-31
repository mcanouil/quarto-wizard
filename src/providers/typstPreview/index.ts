import * as vscode from "vscode";
import { logMessage, showMessageWithLogs } from "../../utils/log";
import { TypstPreviewController, type TypstPreviewResult } from "./typstPreviewController";
import { TypstPreviewPanel } from "./typstPreviewPanel";

/**
 * Register the Typst block preview.
 *
 * The controller owns the state and every event, and this owns the one surface
 * that renders it. The feature is inert unless the workspace is trusted and
 * Quarto ships a Typst binary. Neither condition is worth a prompt: the
 * extension does many other things, and a user who never writes a Typst block
 * should never hear about it.
 */
export function registerTypstPreview(context: vscode.ExtensionContext): void {
	let panel: TypstPreviewPanel | undefined;

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

	const controller = new TypstPreviewController({ hasSurface: () => panel !== undefined, show });
	context.subscriptions.push(controller);

	/** Render one result, opening the panel when there is none yet. */
	const render = (result: TypstPreviewResult | undefined): void => {
		if (result === undefined) {
			// The document went away, so there is no block left to describe.
			panel?.clear();
			return;
		}
		const surface = usePanel();
		if (result.asked) {
			// Only a request the user made brings the panel forward. Doing it on an
			// edit would pull the tab back over whatever they moved to.
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

	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.previewTypstBlock", () => {
			const editor = vscode.window.activeTextEditor;
			if (editor === undefined) {
				show("Open a Quarto document to preview a Typst block.");
				return;
			}
			controller.request(editor.document, editor.selection.active);
		}),
	);

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
