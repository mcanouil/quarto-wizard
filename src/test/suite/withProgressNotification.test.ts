import * as assert from "assert";
import * as vscode from "vscode";
import { withProgressNotification } from "../../utils/withProgressNotification";

type ProgressTask = (
	progress: vscode.Progress<{ increment: number }>,
	token: vscode.CancellationToken,
) => Thenable<unknown>;

suite("With Progress Notification Test Suite", () => {
	const windowApi = vscode.window as unknown as Record<string, unknown>;
	const original = {
		withProgress: windowApi.withProgress,
		showInformationMessage: windowApi.showInformationMessage,
	};
	let options: vscode.ProgressOptions | undefined;
	let source: vscode.CancellationTokenSource;
	let messages: string[];

	setup(() => {
		options = undefined;
		messages = [];
		source = new vscode.CancellationTokenSource();
		windowApi.withProgress = (given: vscode.ProgressOptions, task: ProgressTask) => {
			options = given;
			return task({ report: () => undefined }, source.token);
		};
		windowApi.showInformationMessage = (message: string) => {
			messages.push(message);
			return Promise.resolve(undefined);
		};
	});

	teardown(() => {
		windowApi.withProgress = original.withProgress;
		windowApi.showInformationMessage = original.showInformationMessage;
		source.dispose();
	});

	test("Should open a cancellable notification titled with a log link", async () => {
		await withProgressNotification("Installing", async () => undefined);
		assert.strictEqual(options?.location, vscode.ProgressLocation.Notification);
		assert.strictEqual(options?.cancellable, true);
		assert.strictEqual(options?.title, "Installing ([Show logs](command:quartoWizard.showOutput))");
	});

	test("Should resolve to the value of the expression", async () => {
		assert.strictEqual(await withProgressNotification("Work", async () => 42), 42);
	});

	test("Should hand the cancellation token to the expression", async () => {
		let received: vscode.CancellationToken | undefined;
		await withProgressNotification("Work", async (token) => {
			received = token;
		});
		assert.strictEqual(received, source.token);
	});

	test("Should reject with the error of the expression", async () => {
		await assert.rejects(
			withProgressNotification("Work", async () => {
				throw new Error("failed");
			}),
			/failed/,
		);
	});

	test("Should tell the user when the operation is cancelled while it runs", async () => {
		await withProgressNotification("Work", async (token) => {
			assert.strictEqual(token.isCancellationRequested, false);
			source.cancel();
		});
		assert.deepStrictEqual(messages, ["Operation cancelled by the user."]);
	});

	test("Should say nothing about a cancellation that arrives after the work ended", async () => {
		await withProgressNotification("Work", async () => undefined);
		source.cancel();
		assert.deepStrictEqual(messages, []);
	});

	test("Should still reject when the work fails after a cancellation", async () => {
		await assert.rejects(
			withProgressNotification("Work", async () => {
				source.cancel();
				throw new Error("aborted");
			}),
			/aborted/,
		);
		assert.deepStrictEqual(messages, ["Operation cancelled by the user."]);
	});
});
