import * as assert from "assert";
import * as path from "node:path";
import * as vscode from "vscode";
import { SchemaCache } from "@quarto-wizard/schema";
import { SnippetCache } from "@quarto-wizard/snippets";
import { ExtensionsInstalled } from "../../ui/extensionsInstalled";
import { QuartoExtensionTreeDataProvider } from "../../ui/extensionTreeDataProvider";
import { ExtensionTreeItem, type FolderCache } from "../../ui/extensionTreeItems";
import { getInstalledExtensionsRecord, type InstalledExtension } from "../../utils/extensions";
import * as quarto from "../../utils/quarto";
import { makeFolder, makeRoot } from "./projectFixtures";

const FIXTURE_ROOT = path.join(__dirname, "..", "..", "..", "src", "test", "fixtures", "treeCommands");
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
		subscriptions = [];

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
		vscode.window.showWarningMessage = (async () => "Update All") as unknown as typeof vscode.window.showWarningMessage;
		vscode.window.showInformationMessage = (async () =>
			undefined) as unknown as typeof vscode.window.showInformationMessage;

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
			latestVersions: {},
			parseErrors: new Set(),
			compatibility: {},
		};
	});

	teardown(() => {
		for (const subscription of subscriptions) {
			subscription.dispose();
		}
		quartoModule.installQuartoExtension = originalInstall;
		quartoModule.removeQuartoExtension = originalRemove;
		vscode.commands.registerCommand = originalRegisterCommand;
		vscode.window.createTreeView = originalCreateTreeView;
		vscode.window.showWarningMessage = originalShowWarningMessage;
		vscode.window.showInformationMessage = originalShowInformationMessage;
		QuartoExtensionTreeDataProvider.prototype.refreshAfterAction = originalRefreshAfterAction;
		QuartoExtensionTreeDataProvider.prototype.setProjectRoots = originalSetProjectRoots;
	});

	test("update passes the bare owner/repo for a registry extension", async () => {
		await runCommand("update", createItem("acme/registry-demo"));

		assert.deepStrictEqual(installCalls, [
			{ source: "acme/registry-demo", workspaceFolder: FIXTURE_ROOT, sourceType: "registry" },
		]);
	});

	test("update passes the bare owner/repo for a GitHub extension", async () => {
		await runCommand("update", createItem("acme/github-demo"));

		assert.deepStrictEqual(installCalls, [
			{ source: "acme/github-demo", workspaceFolder: FIXTURE_ROOT, sourceType: "github" },
		]);
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

	test("update all processes only the extensions in getOutdatedExtensions", async () => {
		provider.cache[FIXTURE_ROOT].latestVersions = { "acme/registry-demo": "1.1.0" };

		await runCommand("updateAll");

		assert.deepStrictEqual(installCalls, [
			{ source: "acme/registry-demo", workspaceFolder: FIXTURE_ROOT, sourceType: "registry" },
		]);
	});

	test("remove passes the extension id and workspace folder", async () => {
		await runCommand("remove", createItem("acme/github-demo"));

		assert.deepStrictEqual(removeCalls, [{ extension: "acme/github-demo", workspaceFolder: FIXTURE_ROOT }]);
	});
});
