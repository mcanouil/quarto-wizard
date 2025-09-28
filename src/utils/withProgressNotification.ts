import * as vscode from "vscode";
import { showLogsCommand, logMessage } from "./log";

/**
 * Show a cancellable progress notification and run an async expression.
 *
 * @template T The return type of the async expression.
 * @param {string} title - The title for the progress notification.
 * @param {() => Promise<T>} expression - The async function to execute (no arguments).
 * @returns {Promise<T>} A promise that resolves to the result of the expression.
 */
export async function withProgressNotification<T>(title: string, expression: () => Promise<T>): Promise<T> {
	return await vscode.window.withProgress<T>(
		{
			location: vscode.ProgressLocation.Notification,
			title: `${title} (${showLogsCommand()})`,
			cancellable: true,
		},
		async (_progress: vscode.Progress<{ increment: number }>, token: vscode.CancellationToken): Promise<T> => {
			token.onCancellationRequested((): void => {
				const message = "Operation cancelled by the user.";
				logMessage(message, "info");
				vscode.window.showInformationMessage(`${message} ${showLogsCommand()}.`);
			});
			// progress.report({ increment: 0 });
			return await expression();
		}
	);
}
