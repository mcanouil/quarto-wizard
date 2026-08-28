import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { svgDataUri } from "../../utils/typst/typstSvg";

/** What the host sends to the page. */
type PreviewMessage = { type: "image"; uri: string; header: string } | { type: "error"; message: string };

/**
 * The webview options, which a restored panel needs set again.
 *
 * Panel options such as `retainContextWhenHidden` are not webview options and
 * cannot be set here, so they are passed where the panel itself is created.
 */
function webviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
	return {
		enableScripts: true,
		localResourceRoots: [vscode.Uri.joinPath(extensionUri, "assets", "webview")],
	};
}

/**
 * The panel that shows one compiled Typst block.
 *
 * The page is set once and every update travels by `postMessage`, so the image
 * is replaced without rebuilding the document and losing the scroll position.
 */
export class TypstPreviewPanel {
	static readonly viewType = "quartoWizard.typstPreview";

	/** Whether the page has reported that it is listening. */
	private ready = false;
	/**
	 * The update that arrived before the page was listening.
	 *
	 * The page is loaded asynchronously, and the first compile usually finishes
	 * first, so without this queue the first image is posted into nothing.
	 */
	private pending: PreviewMessage | undefined;
	private readonly disposables: vscode.Disposable[] = [];
	private readonly onDidDisposeEmitter = new vscode.EventEmitter<void>();

	/** Fires when the user closes the panel. */
	readonly onDidDispose = this.onDidDisposeEmitter.event;

	/** A new panel, beside the editor and without taking the focus. */
	static create(extensionUri: vscode.Uri): TypstPreviewPanel {
		const panel = vscode.window.createWebviewPanel(
			TypstPreviewPanel.viewType,
			"Typst Preview",
			{ viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
			{
				...webviewOptions(extensionUri),
				// The panel keeps its image while it is in a background tab, so
				// returning to it does not need a recompile.
				retainContextWhenHidden: true,
			},
		);
		return new TypstPreviewPanel(panel, extensionUri);
	}

	constructor(
		private readonly panel: vscode.WebviewPanel,
		extensionUri: vscode.Uri,
	) {
		// A restored panel arrives with the options it was serialised with, which
		// do not include the resource roots, so they are set again here.
		panel.webview.options = webviewOptions(extensionUri);
		panel.webview.html = this.html(panel.webview, extensionUri);

		this.disposables.push(
			panel.webview.onDidReceiveMessage((message: { type?: string }) => {
				if (message?.type === "initialized") {
					this.ready = true;
					if (this.pending) {
						void panel.webview.postMessage(this.pending);
						this.pending = undefined;
					}
				}
			}),
		);

		this.disposables.push(panel.onDidDispose(() => this.onDidDisposeEmitter.fire()));
	}

	/** Show a compiled image, and describe where it came from. */
	show(svg: string, header: string): void {
		this.post({ type: "image", uri: svgDataUri(svg), header });
	}

	/**
	 * Report a failure, keeping the last image behind it.
	 *
	 * A parse error is the normal state of a block halfway through an edit, so
	 * clearing the image would make the panel flash empty on almost every
	 * keystroke.
	 */
	showError(message: string): void {
		this.post({ type: "error", message });
	}

	/** Bring the panel back to the front. */
	reveal(): void {
		this.panel.reveal(vscode.ViewColumn.Beside, true);
	}

	dispose(): void {
		this.panel.dispose();
		this.onDidDisposeEmitter.dispose();
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}

	private post(message: PreviewMessage): void {
		if (!this.ready) {
			this.pending = message;
			return;
		}
		void this.panel.webview.postMessage(message);
	}

	private html(webview: vscode.Webview, extensionUri: vscode.Uri): string {
		// A fresh nonce per page, so the one inline script is the only script the
		// policy admits.
		const nonce = randomBytes(16).toString("base64");
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "assets", "webview", "typstPreview.css"));
		const policy = [
			"default-src 'none'",
			`img-src ${webview.cspSource} data:`,
			`style-src ${webview.cspSource}`,
			`script-src 'nonce-${nonce}'`,
		].join("; ");

		// The image is rendered into an `img` element and never into the document.
		// An image is an inert, script-disabled context, and the source of this one
		// is workspace controlled.
		return `<!DOCTYPE html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta http-equiv="Content-Security-Policy" content="${policy}" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<link href="${styleUri}" rel="stylesheet" />
		<title>Typst Preview</title>
	</head>
	<body>
		<div id="header"></div>
		<pre id="error" hidden></pre>
		<div id="figure"><img id="image" alt="The compiled Typst block." hidden /></div>
		<script nonce="${nonce}">
			const host = acquireVsCodeApi();
			const header = document.getElementById("header");
			const error = document.getElementById("error");
			const image = document.getElementById("image");

			window.addEventListener("message", (event) => {
				const message = event.data;
				if (message.type === "image") {
					image.src = message.uri;
					image.hidden = false;
					header.textContent = message.header;
					error.hidden = true;
				} else if (message.type === "error") {
					error.textContent = message.message;
					error.hidden = false;
				}
			});

			host.postMessage({ type: "initialized" });
		</script>
	</body>
</html>`;
	}
}
