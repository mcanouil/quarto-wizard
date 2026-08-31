import * as assert from "assert";
import * as vscode from "vscode";
import { TypstPreviewPanel } from "../../providers/typstPreview/typstPreviewPanel";

/** The installed copy of this extension, which owns the webview assets. */
function extensionUri(): vscode.Uri {
	const extension = vscode.extensions.getExtension("mcanouil.quarto-wizard");
	assert.ok(extension, "the extension under test must be present");
	return extension.extensionUri;
}

/** A panel whose posted messages the test can read. */
function fakePanel(): { panel: TypstPreviewPanel; posted: { type: string }[]; ready: () => void } {
	const posted: { type: string }[] = [];
	const received = new vscode.EventEmitter<{ type?: string }>();
	const disposed = new vscode.EventEmitter<void>();
	const host = {
		webview: {
			options: {},
			html: "",
			cspSource: "vscode-webview:",
			asWebviewUri: (uri: vscode.Uri) => uri,
			onDidReceiveMessage: received.event,
			postMessage: (message: { type: string }) => {
				posted.push(message);
				return Promise.resolve(true);
			},
		},
		onDidDispose: disposed.event,
		reveal: () => undefined,
		dispose: () => disposed.fire(),
	} as unknown as vscode.WebviewPanel;
	return {
		panel: new TypstPreviewPanel(host, extensionUri()),
		posted,
		ready: () => received.fire({ type: "initialized" }),
	};
}

suite("Typst Preview Panel Test Suite", () => {
	test("Should take the error away when the same image compiles again", () => {
		// Typing breaks a block and undoing it restores the source, so the image is
		// the one already on screen and is not sent again. The page hides its error
		// when an image arrives, so skipping that message would leave a failure
		// reported over a block that compiles.
		const { panel, posted, ready } = fakePanel();
		ready();
		panel.show("<svg id='a'/>", "doc.qmd · line 3");
		panel.showError("error at line 1, column 1 of the block: expected expression");
		panel.show("<svg id='a'/>", "doc.qmd · line 3");

		assert.deepStrictEqual(
			posted.map((message) => message.type),
			["image", "error", "image"],
		);
		panel.dispose();
	});

	test("Should not send an image the page is already showing", () => {
		const { panel, posted, ready } = fakePanel();
		ready();
		panel.show("<svg id='a'/>", "doc.qmd · line 3");
		panel.show("<svg id='a'/>", "doc.qmd · line 3");

		assert.deepStrictEqual(
			posted.map((message) => message.type),
			["image"],
		);
		panel.dispose();
	});

	test("Should report that it was closed, once", () => {
		const panel = TypstPreviewPanel.create(extensionUri());
		let closed = 0;
		panel.onDidDispose(() => {
			closed++;
		});
		panel.dispose();
		panel.dispose();
		assert.strictEqual(closed, 1);
	});

	test("Should ignore an update that arrives after it was closed", () => {
		// A compile runs for up to the timeout and the user can close the tab
		// meanwhile. Posting to a disposed webview throws, and the throw would
		// travel out of the command as a rejected promise rather than being the
		// stale result it is.
		const panel = TypstPreviewPanel.create(extensionUri());
		panel.dispose();
		assert.doesNotThrow(() => panel.show("<svg/>", "header"));
		assert.doesNotThrow(() => panel.showError("error at line 1"));
		assert.doesNotThrow(() => panel.reveal());
	});
});
