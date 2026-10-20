import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { SchemaCache } from "@quarto-wizard/schema";
import { SnippetCache } from "@quarto-wizard/snippets";
import { registerInstallCommands } from "../../commands/installQuartoExtension";
import { ExtensionsInstalled } from "../../ui/extensionsInstalled";
import { QuartoExtensionTreeDataProvider } from "../../ui/extensionTreeDataProvider";
import { ExtensionTreeItem, WorkspaceFolderTreeItem, type FolderCache } from "../../ui/extensionTreeItems";
import { getInstalledExtensionsRecord, type InstalledExtension } from "../../utils/extensions";
import * as quarto from "../../utils/coreOperations";
import { makeFolder, makeRoot } from "./projectFixtures";
import { TREE_COMMANDS_ROOT as FIXTURE_ROOT, stubUpdateBoundary, type UpdateBoundaryOptions } from "./updateFixtures";
const COMMAND_PREFIX = "treeCommandsTest.";
const RATE_LIMITED = { githubStatus: 403, githubHeaders: { "x-ratelimit-remaining": "0" } };

const quartoModule = quarto as {
	installQuartoExtension: typeof quarto.installQuartoExtension;
	removeQuartoExtension: typeof quarto.removeQuartoExtension;
};

interface InstallCall {
	source: string;
	workspaceFolder: string;
	sourceType: string | undefined;
}

interface RemoveCall {
	extension: string;
	workspaceFolder: string;
}

interface ProviderInternals {
	projectRoots: unknown;
	cache: Record<string, FolderCache>;
	pendingRefresh: Promise<void> | null;
}

suite("Extensions Installed Commands Test Suite", () => {
	let originalInstall: typeof quarto.installQuartoExtension;
	let originalRemove: typeof quarto.removeQuartoExtension;
	let originalRegisterCommand: typeof vscode.commands.registerCommand;
	let originalCreateTreeView: typeof vscode.window.createTreeView;
	let originalShowWarningMessage: typeof vscode.window.showWarningMessage;
	let originalShowErrorMessage: typeof vscode.window.showErrorMessage;
	let originalShowInformationMessage: typeof vscode.window.showInformationMessage;
	let originalRefreshAfterAction: typeof QuartoExtensionTreeDataProvider.prototype.refreshAfterAction;
	let originalSetProjectRoots: typeof QuartoExtensionTreeDataProvider.prototype.setProjectRoots;

	let installCalls: InstallCall[];
	let removeCalls: RemoveCall[];
	let messages: string[];
	let warningActions: string[][];
	let restoreBoundary: () => void;
	let subscriptions: vscode.Disposable[];
	let provider: ProviderInternals;
	let extensions: Record<string, InstalledExtension>;

	function createContext(): vscode.ExtensionContext {
		return {
			subscriptions,
			secrets: { get: async () => undefined },
			globalState: { get: () => undefined },
		} as unknown as vscode.ExtensionContext;
	}

	function createItem(id: string): ExtensionTreeItem {
		return new ExtensionTreeItem(id, vscode.TreeItemCollapsibleState.Collapsed, FIXTURE_ROOT, extensions[id]);
	}

	function stubNetwork(options: UpdateBoundaryOptions): void {
		restoreBoundary();
		restoreBoundary = stubUpdateBoundary(options);
	}

	function runCommand(name: string, ...args: unknown[]): Thenable<unknown> {
		const id =
			name === "installExtension" ? "quartoWizard.installExtension" : `quartoWizard.extensionsInstalled.${name}`;
		return vscode.commands.executeCommand(`${COMMAND_PREFIX}${id}`, ...args);
	}

	setup(async () => {
		originalInstall = quarto.installQuartoExtension;
		originalRemove = quarto.removeQuartoExtension;
		originalRegisterCommand = vscode.commands.registerCommand;
		originalCreateTreeView = vscode.window.createTreeView;
		originalShowWarningMessage = vscode.window.showWarningMessage;
		originalShowErrorMessage = vscode.window.showErrorMessage;
		originalShowInformationMessage = vscode.window.showInformationMessage;
		originalRefreshAfterAction = QuartoExtensionTreeDataProvider.prototype.refreshAfterAction;
		originalSetProjectRoots = QuartoExtensionTreeDataProvider.prototype.setProjectRoots;

		installCalls = [];
		removeCalls = [];
		messages = [];
		warningActions = [];
		subscriptions = [];
		restoreBoundary = stubUpdateBoundary({ repositories: {} });

		quartoModule.installQuartoExtension = async (source, workspaceFolder, options = {}) => {
			installCalls.push({ source, workspaceFolder, sourceType: options.sourceType });
			return true;
		};
		quartoModule.removeQuartoExtension = async (extension, workspaceFolder) => {
			removeCalls.push({ extension, workspaceFolder });
			return true;
		};

		// The activated extension already owns these command and view ids, so this instance registers under a prefix.
		vscode.commands.registerCommand = ((command: string, callback: (...args: unknown[]) => unknown) =>
			originalRegisterCommand(`${COMMAND_PREFIX}${command}`, callback)) as typeof vscode.commands.registerCommand;
		vscode.window.createTreeView = (() => ({
			onDidChangeVisibility: () => new vscode.Disposable(() => undefined),
			dispose: () => undefined,
		})) as unknown as typeof vscode.window.createTreeView;
		vscode.window.showWarningMessage = (async (message: string, ...rest: unknown[]) => {
			const options = typeof rest[0] === "object" ? (rest[0] as vscode.MessageOptions) : undefined;
			messages.push(options?.detail ? `${message}\n${options.detail}` : message);
			warningActions.push(rest.filter((item): item is string => typeof item === "string"));
			return "Update All";
		}) as unknown as typeof vscode.window.showWarningMessage;
		vscode.window.showErrorMessage = (async (message: string) => {
			messages.push(message);
			return undefined;
		}) as unknown as typeof vscode.window.showErrorMessage;
		vscode.window.showInformationMessage = (async (message: string) => {
			messages.push(message);
			return undefined;
		}) as unknown as typeof vscode.window.showInformationMessage;

		// Both would reach the registry over the network or replace the roots injected below.
		QuartoExtensionTreeDataProvider.prototype.refreshAfterAction = () => undefined;
		QuartoExtensionTreeDataProvider.prototype.setProjectRoots = () => false;

		registerInstallCommands(createContext(), () => undefined);
		const instance = new ExtensionsInstalled(createContext(), new SchemaCache(), new SnippetCache());
		provider = (instance as unknown as { treeDataProvider: ProviderInternals }).treeDataProvider;
		await provider.pendingRefresh;

		extensions = await getInstalledExtensionsRecord(FIXTURE_ROOT);
		provider.projectRoots = [makeRoot(makeFolder("treeCommands", FIXTURE_ROOT))];
		provider.cache[FIXTURE_ROOT] = {
			extensions,
			updates: {},
			updateCheckFailures: new Set(),
			parseErrors: new Set(),
			compatibility: {},
		};
	});

	teardown(() => {
		for (const subscription of subscriptions) {
			subscription.dispose();
		}
		restoreBoundary();
		quartoModule.installQuartoExtension = originalInstall;
		quartoModule.removeQuartoExtension = originalRemove;
		vscode.commands.registerCommand = originalRegisterCommand;
		vscode.window.createTreeView = originalCreateTreeView;
		vscode.window.showWarningMessage = originalShowWarningMessage;
		vscode.window.showErrorMessage = originalShowErrorMessage;
		vscode.window.showInformationMessage = originalShowInformationMessage;
		QuartoExtensionTreeDataProvider.prototype.refreshAfterAction = originalRefreshAfterAction;
		QuartoExtensionTreeDataProvider.prototype.setProjectRoots = originalSetProjectRoots;
	});

	test("update installs the latest GitHub tag for a registry extension", async () => {
		stubNetwork({ repositories: { "acme/registry-demo": { githubTags: ["v1.3.0", "v1.0.0"], registryTag: "1.2.0" } } });

		await runCommand("update", createItem("acme/registry-demo"));

		assert.deepStrictEqual(installCalls, [
			{ source: "acme/registry-demo@v1.3.0", workspaceFolder: FIXTURE_ROOT, sourceType: "registry" },
		]);
		assert.deepStrictEqual(messages, ['Extension "acme/registry-demo" updated to 1.3.0.']);
	});

	test("update installs the latest GitHub tag for a GitHub extension", async () => {
		stubNetwork({ repositories: { "acme/github-demo": { githubTags: ["v1.3.0"] } } });

		await runCommand("update", createItem("acme/github-demo"));

		assert.deepStrictEqual(installCalls, [
			{ source: "acme/github-demo@v1.3.0", workspaceFolder: FIXTURE_ROOT, sourceType: "github" },
		]);
	});

	test("update refuses a downgrade", async () => {
		stubNetwork({ repositories: { "acme/registry-demo": { githubTags: ["v1.0.0", "v0.9.0"] } } });

		await runCommand("update", createItem("acme/registry-demo"));

		assert.deepStrictEqual(installCalls, []);
		assert.deepStrictEqual(messages, ['Extension "acme/registry-demo" is up to date.']);
	});

	test("update passes the URL unchanged for a URL extension", async () => {
		await runCommand("update", createItem("acme/url-demo"));

		assert.deepStrictEqual(installCalls, [
			{ source: "https://example.com/downloads/url-demo.zip", workspaceFolder: FIXTURE_ROOT, sourceType: "url" },
		]);
	});

	test("update passes the path unchanged for a local extension", async () => {
		await runCommand("update", createItem("acme/local-demo"));

		assert.deepStrictEqual(installCalls, [
			{ source: "../local-demo-source", workspaceFolder: FIXTURE_ROOT, sourceType: "local" },
		]);
	});

	test("reinstall keeps the pinned ref", async () => {
		await runCommand("reinstall", createItem("acme/pinned-demo"));

		assert.deepStrictEqual(installCalls, [
			{
				source: "acme/pinned-demo@4f3c2a1b9d8e7f60514233a4b5c6d7e8f9012345",
				workspaceFolder: FIXTURE_ROOT,
				sourceType: "github",
			},
		]);
	});

	test("update all installs the GitHub tag when the registry lags", async () => {
		stubNetwork({ repositories: { "acme/registry-demo": { githubTags: ["v1.3.0"], registryTag: "1.2.0" } } });

		await runCommand("updateAll");

		assert.deepStrictEqual(installCalls, [
			{ source: "acme/registry-demo@v1.3.0", workspaceFolder: FIXTURE_ROOT, sourceType: "registry" },
		]);
		assert.ok(installCalls[0].source.endsWith("@v1.3.0"));
		assert.ok(messages[0].includes("1.3.0"), `confirmation does not name 1.3.0: ${messages[0]}`);
		assert.ok(!messages[0].includes("1.2.0"), `confirmation names the registry version: ${messages[0]}`);
	});

	test("update all skips extensions without a newer tag", async () => {
		stubNetwork({
			repositories: {
				"acme/registry-demo": { githubTags: ["v1.3.0"] },
				"acme/github-demo": { githubTags: ["v1.0.0"] },
				"acme/pinned-demo": { githubTags: ["v0.5.0"] },
			},
		});

		await runCommand("updateAll");

		assert.deepStrictEqual(installCalls, [
			{ source: "acme/registry-demo@v1.3.0", workspaceFolder: FIXTURE_ROOT, sourceType: "registry" },
		]);
	});

	test("update all installs nothing when every extension is up to date", async () => {
		stubNetwork({ repositories: { "acme/registry-demo": { githubTags: ["v1.0.0"] } } });

		await runCommand("updateAll");

		assert.deepStrictEqual(installCalls, []);
		assert.deepStrictEqual(messages, ["All extensions are up to date."]);
	});

	test("update all reports the repositories it could not check", async () => {
		stubNetwork({
			repositories: { "acme/registry-demo": { githubTags: ["v1.0.0"] }, "acme/github-demo": { githubStatus: 404 } },
		});

		await runCommand("updateAll");

		assert.deepStrictEqual(installCalls, []);
		assert.deepStrictEqual(messages, ["Failed to check updates for 1 repository."]);
		assert.deepStrictEqual(warningActions, [["Show Logs"]]);
	});

	test("update all counts several repositories it could not check", async () => {
		stubNetwork({
			repositories: {
				"acme/registry-demo": { githubTags: ["v1.0.0"] },
				"acme/github-demo": { githubStatus: 404 },
				"acme/pinned-demo": { githubStatus: 404 },
			},
		});

		await runCommand("updateAll");

		assert.deepStrictEqual(messages, ["Failed to check updates for 2 repositories."]);
	});

	test("update all stops without a confirmation when the check is cancelled", async () => {
		stubNetwork({ repositories: { "acme/registry-demo": { githubTags: ["v1.3.0"] } } });
		const originalWithProgress = vscode.window.withProgress;
		const cancelled = {
			isCancellationRequested: true,
			onCancellationRequested: () => new vscode.Disposable(() => undefined),
		} as unknown as vscode.CancellationToken;
		vscode.window.withProgress = ((_options, task) =>
			task({ report: () => undefined }, cancelled)) as typeof vscode.window.withProgress;

		try {
			await runCommand("updateAll");
		} finally {
			vscode.window.withProgress = originalWithProgress;
		}

		assert.deepStrictEqual(installCalls, []);
		assert.deepStrictEqual(messages, []);
	});

	test("update all counts the repositories it could not check in its summary", async () => {
		stubNetwork({
			repositories: { "acme/registry-demo": { githubTags: ["v1.3.0"] }, "acme/github-demo": { githubStatus: 404 } },
		});

		await runCommand("updateAll");

		assert.deepStrictEqual(installCalls, [
			{ source: "acme/registry-demo@v1.3.0", workspaceFolder: FIXTURE_ROOT, sourceType: "registry" },
		]);
		assert.strictEqual(
			messages[messages.length - 1],
			"Updated acme/registry-demo to 1.3.0; 1 repository could not be checked.",
		);
	});

	test("update asks to sign in when the anonymous rate limit stops the check", async () => {
		stubNetwork({ repositories: { "acme/registry-demo": RATE_LIMITED } });

		await runCommand("update", createItem("acme/registry-demo"));

		assert.deepStrictEqual(installCalls, []);
		assert.strictEqual(messages.length, 1);
		assert.ok(messages[0].includes("Sign in to GitHub"), messages[0]);
		assert.deepStrictEqual(warningActions, [["Sign In"]]);
	});

	test("update all does not ask to sign in when the rate limit stops a check with a token", async () => {
		stubNetwork({ token: "test-token", repositories: { "acme/registry-demo": RATE_LIMITED } });

		await runCommand("updateAll");

		assert.deepStrictEqual(installCalls, []);
		assert.strictEqual(messages.length, 1);
		assert.ok(messages[0].includes("GitHub rate limit reached."), messages[0]);
		assert.ok(!/sign in/i.test(messages[0]), messages[0]);
		assert.deepStrictEqual(warningActions, [["Show Logs"]]);
	});

	test("update all reports a repository that denies access and keeps the other results", async () => {
		stubNetwork({
			token: "test-token",
			repositories: { "acme/registry-demo": { githubTags: ["v1.3.0"] }, "acme/github-demo": { githubStatus: 403 } },
		});

		await runCommand("updateAll");

		assert.deepStrictEqual(installCalls, [
			{ source: "acme/registry-demo@v1.3.0", workspaceFolder: FIXTURE_ROOT, sourceType: "registry" },
		]);
		assert.strictEqual(
			messages[messages.length - 1],
			"Updated acme/registry-demo to 1.3.0; 1 repository could not be checked.",
		);
	});

	test("update all reports a rejected token as a failed check", async () => {
		stubNetwork({
			token: "expired-token",
			repositories: { "acme/registry-demo": { githubStatus: 401 }, "acme/github-demo": { githubStatus: 401 } },
		});

		await runCommand("updateAll");

		assert.deepStrictEqual(installCalls, []);
		assert.strictEqual(messages.length, 1);
		assert.ok(messages[0].includes("The update check failed."), messages[0]);
	});

	test("remove passes the extension id and workspace folder", async () => {
		await runCommand("remove", createItem("acme/github-demo"));

		assert.deepStrictEqual(removeCalls, [{ extension: "acme/github-demo", workspaceFolder: FIXTURE_ROOT }]);
	});

	async function installFromLocalSource(target: unknown): Promise<string> {
		const localSource = path.join(FIXTURE_ROOT, "local-source");
		const originalShowQuickPick = vscode.window.showQuickPick;
		const originalShowOpenDialog = vscode.window.showOpenDialog;
		vscode.window.showQuickPick = (async (items: readonly (vscode.QuickPickItem & { sourceType?: string })[]) =>
			items.find((item) => item.sourceType === "local") ?? items[0]) as unknown as typeof vscode.window.showQuickPick;
		vscode.window.showOpenDialog = (async () => [vscode.Uri.file(localSource)]) as typeof vscode.window.showOpenDialog;
		try {
			await runCommand("installExtension", target);
		} finally {
			vscode.window.showQuickPick = originalShowQuickPick;
			vscode.window.showOpenDialog = originalShowOpenDialog;
		}
		return localSource;
	}

	test("install with an extension tree item installs into the folder of that item", async () => {
		const localSource = await installFromLocalSource(createItem("acme/github-demo"));

		assert.deepStrictEqual(installCalls, [
			{ source: localSource, workspaceFolder: FIXTURE_ROOT, sourceType: undefined },
		]);
	});

	test("install with a workspace folder tree item installs into that folder", async () => {
		const localSource = await installFromLocalSource(new WorkspaceFolderTreeItem("treeCommands", FIXTURE_ROOT));

		assert.deepStrictEqual(installCalls, [
			{ source: localSource, workspaceFolder: FIXTURE_ROOT, sourceType: undefined },
		]);
	});
});
