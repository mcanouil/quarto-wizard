import * as vscode from "vscode";
import { QW_LOG, kMarkDownLintExtension } from "../constants";

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
function triggerLint() {
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
function lintOnEvent(lintOn: string) {
	if (!vscode.extensions.getExtension(kMarkDownLintExtension)) {
		QW_LOG.appendLine(`The '${kMarkDownLintExtension}' extension is not installed.`);
		return;
	}
	switch (lintOn) {
		case "save":
			vscode.workspace.onDidSaveTextDocument((document) => {
				if (document.languageId === "quarto") {
					triggerLint();
				}
			});
			break;
		case "type":
			vscode.workspace.onDidChangeTextDocument((event) => {
				if (event.document.languageId === "quarto") {
					triggerLint();
				}
			});
			break;
		default:
			QW_LOG.appendLine(`Unsupported lint trigger: ${lintOn}`);
	}
}

/**
 * Lints the current Quarto document based on the user's configuration.
 *
 * @param context - The extension context provided by VS Code.
 */
export function lint() {
	const config = vscode.workspace.getConfiguration("quartoWizard.lint", null);
	const lintOn = config.get<string>("trigger") || "never";
	if (vscode.window.activeTextEditor?.document.languageId === "quarto" && lintOn !== "never") {
		lintOnEvent(lintOn);
	}
}
