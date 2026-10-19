import * as assert from "assert";
import * as vscode from "vscode";
import { SchemaCache } from "@quarto-wizard/schema";
import { SnippetCache } from "@quarto-wizard/snippets";
import { ExtensionsInstalled } from "../../ui/extensionsInstalled";
import { QuartoExtensionTreeDataProvider } from "../../ui/extensionTreeDataProvider";
import { ExtensionTreeItem, type FolderCache } from "../../ui/extensionTreeItems";
import { getInstalledExtensionsRecord, type InstalledExtension } from "../../utils/extensions";
import * as quarto from "../../utils/quarto";
import { makeFolder, makeRoot } from "./projectFixtures";
import { TREE_COMMANDS_ROOT as FIXTURE_ROOT, stubUpdateBoundary, type UpdateBoundaryOptions } from "./updateFixtures";
const COMMAND_PREFIX = "treeCommandsTest.";

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
	let originalShowInformationMessage: typeof vscode.window.showInformationMessage;
	let originalRefreshAfterAction: typeof QuartoExtensionTreeDataProvider.prototype.refreshAfterAction;
	let originalSetProjectRoots: typeof QuartoExtensionTreeDataProvider.prototype.setProjectRoots;

	let installCalls: InstallCall[];
	let removeCalls: RemoveCall[];
	let messages: string[];
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
		return vscode.commands.executeCommand(`${COMMAND_PREFIX}quartoWizard.extensionsInstalled.${name}`, ...args);
	}

	setup(async () => {
		originalInstall = quarto.installQuartoExtension;
		originalRemove = quarto.removeQuartoExtension;
		originalRegisterCommand = vscode.commands.registerCommand;
		originalCreateTreeView = vscode.window.createTreeView;
		originalShowWarningMessage = vscode.window.showWarningMessage;
		originalShowInformationMessage = vscode.window.showInformationMessage;
		originalRefreshAfterAction = QuartoExtensionTreeDataProvider.prototype.refreshAfterAction;
		originalSetProjectRoots = QuartoExtensionTreeDataProvider.prototype.setProjectRoots;

		installCalls = [];
		removeCalls = [];
		messages = [];
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
			const options = rest[0] as vscode.MessageOptions | undefined;
			messages.push(options?.detail ? `${message}\n${options.detail}` : message);
			return "Update All";
		}) as unknown as typeof vscode.window.showWarningMessage;
		vscode.window.showInformationMessage = (async (message: string) => {
			messages.push(message);
			return undefined;
		}) as unknown as typeof vscode.window.showInformationMessage;

		// Both would reach the registry over the network or replace the roots injected below.
		QuartoExtensionTreeDataProvider.prototype.refreshAfterAction = () => undefined;
		QuartoExtensionTreeDataProvider.prototype.setProjectRoots = () => false;

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

	test("remove passes the extension id and workspace folder", async () => {
		await runCommand("remove", createItem("acme/github-demo"));

		assert.deepStrictEqual(removeCalls, [{ extension: "acme/github-demo", workspaceFolder: FIXTURE_ROOT }]);
	});
});
