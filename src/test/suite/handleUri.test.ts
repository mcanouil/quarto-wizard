import * as assert from "assert";
import * as vscode from "vscode";
import { confirmUriAction } from "../../utils/handleUri";

suite("Handle URI Test Suite", () => {
	let originalShowWarningMessage: typeof vscode.window.showWarningMessage;

	let dialogResult: string | undefined;
	let dialogCalls: { message: string; options: vscode.MessageOptions; items: string[] }[];

	setup(() => {
		originalShowWarningMessage = vscode.window.showWarningMessage;

		dialogResult = undefined;
		dialogCalls = [];

		Object.defineProperty(vscode.window, "showWarningMessage", {
			value: async (message: string, options: vscode.MessageOptions, ...items: string[]) => {
				dialogCalls.push({ message, options, items });
				return dialogResult;
			},
			writable: true,
			configurable: true,
		});
	});

	teardown(() => {
		Object.defineProperty(vscode.window, "showWarningMessage", {
			value: originalShowWarningMessage,
			writable: true,
			configurable: true,
		});
	});

	suite("confirmUriAction", () => {
		test("Should return true when the user selects 'Yes'", async () => {
			dialogResult = "Yes";

			const result = await confirmUriAction("Do you confirm?", "/workspace");

			assert.strictEqual(result, true);
		});

		test("Should return false when the user dismisses the dialog with Cancel or Esc", async () => {
			dialogResult = undefined;

			const result = await confirmUriAction("Do you confirm?", "/workspace");

			assert.strictEqual(result, false);
		});

		test("Should return false for any other response", async () => {
			dialogResult = "No";

			const result = await confirmUriAction("Do you confirm?", "/workspace");

			assert.strictEqual(result, false);
		});

		test("Should show a modal dialog with a single 'Yes' item", async () => {
			dialogResult = "Yes";

			await confirmUriAction("Do you confirm?", "/workspace");

			assert.strictEqual(dialogCalls.length, 1);
			assert.strictEqual(dialogCalls[0].message, "Do you confirm?");
			assert.strictEqual(dialogCalls[0].options.modal, true);
			assert.deepStrictEqual(dialogCalls[0].items, ["Yes"]);
		});

		test("Should show the destination folder in the dialog detail", async () => {
			dialogResult = "Yes";

			await confirmUriAction("Do you confirm?", "/home/user/my-project");

			assert.strictEqual(dialogCalls[0].options.detail, "Destination: /home/user/my-project");
		});
	});
});
