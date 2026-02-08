import * as vscode from "vscode";
import { getShowLogsLink, logMessage } from "./log";

/**
 * Show a cancellable progress notification and run an async expression.
 *
 * @template T The return type of the async expression.
 * @param {string} title - The title for the progress notification.
 * @param {(token: vscode.CancellationToken) => Promise<T>} expression - The async function to execute with cancellation token.
 * @returns {Promise<T>} A promise that resolves to the result of the expression.
 */
export async function withProgressNotification<T>(
	title: string,
	expression: (token: vscode.CancellationToken) => Promise<T>,
): Promise<T> {
	return await vscode.window.withProgress<T>(
		{
			location: vscode.ProgressLocation.Notification,
			title: `${title} (${getShowLogsLink()})`,
			cancellable: true,
		},
		async (_progress: vscode.Progress<{ increment: number }>, token: vscode.CancellationToken): Promise<T> => {
			let completed = false;
			token.onCancellationRequested((): void => {
				if (completed) {
					return;
				}
				const message = "Operation cancelled by the user.";
				logMessage(message, "info");
				vscode.window.showInformationMessage(`${message} ${getShowLogsLink()}.`);
			});
			try {
				return await expression(token);
			} finally {
				completed = true;
			}
		},
	);
}
