import * as assert from "assert";
import * as vscode from "vscode";
import { TypstPreviewPanel } from "../../providers/typstPreview/typstPreviewPanel";

/** The installed copy of this extension, which owns the webview assets. */
function extensionUri(): vscode.Uri {
	const extension = vscode.extensions.getExtension("mcanouil.quarto-wizard");
	assert.ok(extension, "the extension under test must be present");
	return extension.extensionUri;
}

suite("Typst Preview Panel Test Suite", () => {
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
