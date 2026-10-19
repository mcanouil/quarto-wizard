import * as assert from "assert";
import * as vscode from "vscode";
import { useBrandCommand } from "../../commands/useBrand";
import * as extensionsQuickPick from "../../ui/extensionsQuickPick";
import * as ask from "../../utils/ask";
import * as auth from "../../utils/auth";
import * as network from "../../utils/network";
import * as quarto from "../../utils/coreOperations";
import * as sourcePrompts from "../../utils/sourcePrompts";
import * as workspace from "../../utils/workspace";
import { Stubs } from "./stubs";

const WORKSPACE = "/projects/site";
const AUTH = { token: "stub" };

type BrandResult = { created: string[]; overwritten: string[]; skipped: string[] } | null;

suite("Use Brand Command Test Suite", () => {
	const stubs = new Stubs();
	const context = {} as vscode.ExtensionContext;
	let calls: string[];
	let brandCalls: { source: string; folder: string; options: quarto.BrandOptions }[];
	let brandResult: BrandResult;
	let information: string[];
	let warnings: string[];
	let progress: vscode.ProgressOptions | undefined;
	let tokenSource: vscode.CancellationTokenSource;
	let sourceChoice: extensionsQuickPick.SourcePickerResult;
	let connected: boolean;
	let reference: string | undefined;
	let trusted: boolean;
	let installConfirmed: boolean;
	let folder: string | undefined;

	setup(() => {
		calls = [];
		brandCalls = [];
		brandResult = { created: ["a", "b"], overwritten: ["c"], skipped: [] };
		information = [];
		warnings = [];
		progress = undefined;
		tokenSource = new vscode.CancellationTokenSource();
		sourceChoice = { type: "github" };
		connected = true;
		reference = "acme/brand";
		trusted = true;
		installConfirmed = true;
		folder = WORKSPACE;

		stubs.replace(workspace, "selectWorkspaceFolder", async () => {
			calls.push("workspace");
			return folder;
		});
		stubs.replace(extensionsQuickPick, "showSourcePicker", async () => {
			calls.push("picker");
			return sourceChoice;
		});
		stubs.replace(network, "checkInternetConnection", async () => {
			calls.push("network");
			return connected;
		});
		stubs.replace(sourcePrompts, "promptForGitHubReference", async () => reference);
		stubs.replace(sourcePrompts, "promptForURL", async () => reference);
		stubs.replace(sourcePrompts, "promptForLocalPath", async () => reference);
		stubs.replace(ask, "confirmTrustAuthors", async () => trusted);
		stubs.replace(ask, "confirmInstall", async () => installConfirmed);
		stubs.replace(auth, "getAuthConfig", async () => AUTH);
		stubs.replace(quarto, "useQuartoBrand", async (source: string, folderArg: string, options: quarto.BrandOptions) => {
			brandCalls.push({ source, folder: folderArg, options });
			return brandResult;
		});
		stubs.replace(
			vscode.window,
			"withProgress",
			(options: vscode.ProgressOptions, task: (p: unknown, t: vscode.CancellationToken) => Thenable<unknown>) => {
				progress = options;
				return task({ report: () => undefined }, tokenSource.token);
			},
		);
		stubs.replace(vscode.window, "showInformationMessage", async (message: string) => {
			information.push(message);
			return undefined;
		});
		stubs.replace(vscode.window, "showWarningMessage", async (message: string) => {
			warnings.push(message);
			return undefined;
		});
	});

	teardown(() => {
		stubs.restore();
		tokenSource.dispose();
	});

	test("Should apply a brand from a GitHub reference and report the file count", async () => {
		await useBrandCommand(context);
		assert.strictEqual(brandCalls.length, 1);
		assert.strictEqual(brandCalls[0].source, "acme/brand");
		assert.strictEqual(brandCalls[0].folder, WORKSPACE);
		assert.strictEqual(brandCalls[0].options.auth, AUTH);
		assert.strictEqual(brandCalls[0].options.cancellationToken, tokenSource.token);
		assert.deepStrictEqual(information, ["Brand applied successfully (3 file(s) in _brand/)."]);
		assert.deepStrictEqual(warnings, []);
	});

	test("Should show a cancellable notification titled with the source", async () => {
		await useBrandCommand(context);
		assert.strictEqual(progress?.location, vscode.ProgressLocation.Notification);
		assert.strictEqual(progress?.cancellable, true);
		assert.ok(String(progress?.title).startsWith("Applying brand from acme/brand ("));
	});

	test("Should check the connection before a remote source", async () => {
		await useBrandCommand(context);
		assert.deepStrictEqual(calls, ["workspace", "picker", "network"]);
	});

	test("Should skip the connection check for a local source and resolve it against the folder", async () => {
		sourceChoice = { type: "local" };
		reference = "./brands/mine";
		await useBrandCommand(context);
		assert.ok(!calls.includes("network"));
		assert.strictEqual(brandCalls[0].source, vscode.Uri.joinPath(vscode.Uri.file(WORKSPACE), "./brands/mine").fsPath);
		assert.strictEqual(brandCalls[0].options.sourceDisplay, "./brands/mine");
	});

	test("Should accept a URL source", async () => {
		sourceChoice = { type: "url" };
		reference = "https://example.com/brand.zip";
		await useBrandCommand(context);
		assert.strictEqual(brandCalls[0].source, "https://example.com/brand.zip");
	});

	test("Should say that files were skipped when every overwrite was declined", async () => {
		brandResult = { created: [], overwritten: [], skipped: ["x", "y"] };
		await useBrandCommand(context);
		assert.deepStrictEqual(information, ["Brand files skipped, overwrite declined (2 existing file(s) in _brand/)."]);
	});

	test("Should warn, and point to the logs, when the operation fails", async () => {
		brandResult = null;
		await useBrandCommand(context);
		assert.deepStrictEqual(warnings, ["Brand operation did not complete. See logs for details."]);
		assert.deepStrictEqual(information, []);
	});

	test("Should stay quiet when the operation fails after the user cancelled", async () => {
		brandResult = null;
		stubs.replace(quarto, "useQuartoBrand", async () => {
			tokenSource.cancel();
			return null;
		});
		await useBrandCommand(context);
		assert.deepStrictEqual(warnings, []);
		assert.deepStrictEqual(information, []);
	});

	test("Should not start when the notification opens already cancelled", async () => {
		tokenSource.cancel();
		await useBrandCommand(context);
		assert.strictEqual(brandCalls.length, 0);
		assert.deepStrictEqual(information, []);
	});

	test("Should do nothing without a workspace folder", async () => {
		folder = undefined;
		await useBrandCommand(context);
		assert.deepStrictEqual(calls, ["workspace"]);
		assert.strictEqual(brandCalls.length, 0);
	});

	test("Should do nothing when the source picker is dismissed", async () => {
		sourceChoice = { type: "cancelled" };
		await useBrandCommand(context);
		assert.deepStrictEqual(calls, ["workspace", "picker"]);
		assert.strictEqual(brandCalls.length, 0);
	});

	test("Should do nothing when the connection check fails", async () => {
		connected = false;
		await useBrandCommand(context);
		assert.strictEqual(brandCalls.length, 0);
	});

	test("Should do nothing when the source prompt is dismissed", async () => {
		reference = undefined;
		await useBrandCommand(context);
		assert.strictEqual(brandCalls.length, 0);
	});

	test("Should do nothing when the user does not trust the authors", async () => {
		trusted = false;
		await useBrandCommand(context);
		assert.strictEqual(brandCalls.length, 0);
		assert.strictEqual(progress, undefined);
	});

	test("Should do nothing when the user declines the confirmation", async () => {
		installConfirmed = false;
		await useBrandCommand(context);
		assert.strictEqual(brandCalls.length, 0);
		assert.strictEqual(progress, undefined);
	});
});
