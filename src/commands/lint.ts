import * as vscode from "vscode";
import { QW_LOG } from "../constants";

const kMarkDownLintExtension = "DavidAnson.vscode-markdownlint";

/**
 * Lints the currently active text editor if the document language is "quarto".
 *
 * This function performs the following steps:
 * 1. Checks if there is an active text editor and if the document language is "quarto".
 * 2. Activates the "DavidAnson.vscode-markdownlint" extension.
 * 3. Changes the document language to "markdown".
 * 4. Toggles markdown linting twice to ensure it is enabled.
 * 5. Changes the document language back to "quarto".
 */
function lint() {
	if (!vscode.extensions.getExtension(kMarkDownLintExtension)) {
		QW_LOG.appendLine(`The '${kMarkDownLintExtension}' extension is not installed.`);
		return;
	}
	const editor = vscode.window.activeTextEditor;
	if (editor && editor.document.languageId === "quarto") {
		vscode.languages
			.setTextDocumentLanguage(editor.document, "markdown")
			.then(() => {
				vscode.commands.executeCommand("markdownlint.toggleLinting");
				vscode.commands.executeCommand("markdownlint.toggleLinting"); // Toggle twice to ensure linting is enabled
			})
			.then(() => {
				vscode.languages.setTextDocumentLanguage(editor.document, "quarto");
			});
	}
}

/**
 * Registers event listeners to trigger the linting process based on the user's configuration.
 *
 * The function reads the `quartoWizard.lint.trigger` configuration setting to determine when to trigger linting.
 * It supports two triggers:
 * - "save": Linting is triggered when a Quarto document is saved.
 * - "type": Linting is triggered when a Quarto document is modified.
 *
 * Depending on the trigger setting, the appropriate event listener is registered:
 * - For "save", it listens to the `onDidSaveTextDocument` event.
 * - For "type", it listens to the `onDidChangeTextDocument` event.
 *
 * When the specified event occurs, and the document's language ID is "quarto", the `quartoWizard.lint` command is executed.
 */
export function lintOnEvent() {
	if (!vscode.extensions.getExtension(kMarkDownLintExtension)) {
		QW_LOG.appendLine(`The '${kMarkDownLintExtension}' extension is not installed.`);
		return;
	}
	const config = vscode.workspace.getConfiguration("quartoWizard.lint", null);
	const lintOn = config.get<string>("trigger");
	if (lintOn === "save") {
		vscode.workspace.onDidSaveTextDocument((document) => {
			if (document.languageId === "quarto") {
				lint();
			}
		});
	}
	if (lintOn === "type") {
		vscode.workspace.onDidChangeTextDocument((event) => {
			if (event.document.languageId === "quarto") {
				lint();
			}
		});
	}
}
