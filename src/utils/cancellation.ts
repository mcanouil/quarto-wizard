import type * as vscode from "vscode";

/**
 * Runs an operation with an abort signal that follows a cancellation token.
 * A token that is already cancelled gives a signal that is already aborted.
 *
 * @param token - Cancellation token to follow, if any.
 * @param run - Operation that receives the signal.
 * @returns The result of the operation.
 */
export async function withAbortSignal<T>(
	token: vscode.CancellationToken | undefined,
	run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
	const controller = new AbortController();
	if (token?.isCancellationRequested) {
		controller.abort();
	}
	const cancellation = token?.onCancellationRequested(() => controller.abort());
	try {
		return await run(controller.signal);
	} finally {
		cancellation?.dispose();
	}
}
