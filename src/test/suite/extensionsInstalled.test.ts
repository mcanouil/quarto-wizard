import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { SchemaCache } from "@quarto-wizard/schema";
import { SnippetCache } from "@quarto-wizard/snippets";
import { LocalEditsError, writeSourceRecord, type InstallTrack } from "@quarto-wizard/core";
import { registerInstallCommands } from "../../commands/installQuartoExtension";
import type { QuartoProjectRoot } from "../../utils/quartoProjectDiscovery";
import { ExtensionsInstalled } from "../../ui/extensionsInstalled";
import { QuartoExtensionTreeDataProvider } from "../../ui/extensionTreeDataProvider";
import { ExtensionTreeItem, WorkspaceFolderTreeItem, type FolderCache } from "../../ui/extensionTreeItems";
import { formatExtensionId, getInstalledExtensionsRecord, type InstalledExtension } from "../../utils/extensions";
import * as quarto from "../../utils/coreOperations";
import { FakeMemento, makeEmbeddedRoot, makeFolder, makeRoot } from "./projectFixtures";
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

interface RecordedInstall {
	source: string;
	recordSource: string | undefined;
	track: InstallTrack | undefined;
}

interface RemoveCall {
	extension: string;
	workspaceFolder: string;
}

interface ProviderInternals {
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
	let originalWithProgress: typeof vscode.window.withProgress;
	let originalRefreshAfterAction: typeof QuartoExtensionTreeDataProvider.prototype.refreshAfterAction;
	let originalSetProjectRoots: typeof QuartoExtensionTreeDataProvider.prototype.setProjectRoots;

	let installCalls: InstallCall[];
	let expectedIds: (string | undefined)[];
	let removeCalls: RemoveCall[];
	let messages: string[];
	let errors: string[];
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
			workspaceState: new FakeMemento(),
		} as unknown as vscode.ExtensionContext;
	}

	function createItem(id: string): ExtensionTreeItem {
		return new ExtensionTreeItem(id, vscode.TreeItemCollapsibleState.Collapsed, FIXTURE_ROOT, extensions[id]);
	}

	function stubNetwork(options: UpdateBoundaryOptions): void {
		restoreBoundary();
		restoreBoundary = stubUpdateBoundary(options);
	}

	function cancelEveryProgress(): void {
		const source = new vscode.CancellationTokenSource();
		source.cancel();
		subscriptions.push(source);
		const cancelled = source.token;
		vscode.window.withProgress = ((_options, task) =>
			task({ report: () => undefined }, cancelled)) as typeof vscode.window.withProgress;
	}

	function cancellableProgress(): { cancel: () => void } {
		let cancelled = false;
		const token = {
			get isCancellationRequested() {
				return cancelled;
			},
			onCancellationRequested: () => new vscode.Disposable(() => undefined),
		} as vscode.CancellationToken;
		vscode.window.withProgress = ((_options, task) =>
			task({ report: () => undefined }, token)) as typeof vscode.window.withProgress;
		return {
			cancel: () => {
				cancelled = true;
			},
		};
	}

	function stubTwoUpdates(): void {
		stubNetwork({
			repositories: {
				"acme/registry-demo": { githubTags: ["v1.3.0"] },
				"acme/github-demo": { githubTags: ["v1.3.0"] },
			},
		});
	}

	// The suite replaces the prototype method with a no-op, so the injected roots go through the original.
	function setRoots(roots: readonly QuartoProjectRoot[]): void {
		originalSetProjectRoots.call(provider, roots);
	}

	function runCommand(name: string, ...args: unknown[]): Thenable<unknown> {
		const id =
			name === "installExtension" ? "quartoWizard.installExtension" : `quartoWizard.extensionsInstalled.${name}`;
		return vscode.commands.executeCommand(`${COMMAND_PREFIX}${id}`, ...args);
	}

	// The constructor schedules a discovery that ends in refreshAfterAction, possibly after the test has ended.
	// The stubs stay in place for the whole suite so that a late call never starts a real check during a later test.
	suiteSetup(() => {
		originalRefreshAfterAction = QuartoExtensionTreeDataProvider.prototype.refreshAfterAction;
		originalSetProjectRoots = QuartoExtensionTreeDataProvider.prototype.setProjectRoots;
		// Both would reach the registry over the network or replace the roots injected below.
		QuartoExtensionTreeDataProvider.prototype.refreshAfterAction = () => undefined;
		QuartoExtensionTreeDataProvider.prototype.setProjectRoots = () => false;
	});

	suiteTeardown(() => {
		QuartoExtensionTreeDataProvider.prototype.refreshAfterAction = originalRefreshAfterAction;
		QuartoExtensionTreeDataProvider.prototype.setProjectRoots = originalSetProjectRoots;
	});

	setup(async () => {
		originalInstall = quarto.installQuartoExtension;
		originalRemove = quarto.removeQuartoExtension;
		originalRegisterCommand = vscode.commands.registerCommand;
		originalCreateTreeView = vscode.window.createTreeView;
		originalShowWarningMessage = vscode.window.showWarningMessage;
		originalShowErrorMessage = vscode.window.showErrorMessage;
		originalShowInformationMessage = vscode.window.showInformationMessage;
		originalWithProgress = vscode.window.withProgress;

		installCalls = [];
		expectedIds = [];
		removeCalls = [];
		messages = [];
		errors = [];
		warningActions = [];
		subscriptions = [];
		restoreBoundary = stubUpdateBoundary({ repositories: {} });

		quartoModule.installQuartoExtension = async (source, workspaceFolder, options = {}) => {
			installCalls.push({ source, workspaceFolder, sourceType: options.sourceType });
			expectedIds.push(options.expectedExtensionId && formatExtensionId(options.expectedExtensionId));
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
			onDidChangeCheckboxState: () => new vscode.Disposable(() => undefined),
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
			errors.push(message);
			return undefined;
		}) as unknown as typeof vscode.window.showErrorMessage;
		vscode.window.showInformationMessage = (async (message: string) => {
			messages.push(message);
			return undefined;
		}) as unknown as typeof vscode.window.showInformationMessage;

		registerInstallCommands(createContext(), () => undefined);
		const instance = new ExtensionsInstalled(createContext(), new SchemaCache(), new SnippetCache());
		provider = (instance as unknown as { treeDataProvider: ProviderInternals }).treeDataProvider;
		await provider.pendingRefresh;

		extensions = await getInstalledExtensionsRecord(FIXTURE_ROOT);
		setRoots([makeRoot(makeFolder("treeCommands", FIXTURE_ROOT))]);
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
		vscode.window.withProgress = originalWithProgress;
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

	test("update names the installed extension as the one to install", async () => {
		stubNetwork({ repositories: { "acme/github-demo": { githubTags: ["v1.3.0"] } } });

		await runCommand("update", createItem("acme/github-demo"));

		assert.deepStrictEqual(expectedIds, ["acme/github-demo"]);
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

	test("reinstall names the installed extension as the one to install", async () => {
		await runCommand("reinstall", createItem("acme/pinned-demo"));

		assert.deepStrictEqual(expectedIds, ["acme/pinned-demo"]);
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

	test("update all names each installed extension as the one to install", async () => {
		stubTwoUpdates();

		await runCommand("updateAll");

		assert.deepStrictEqual([...expectedIds].sort(), ["acme/github-demo", "acme/registry-demo"]);
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
		const requests: string[] = [];
		stubNetwork({ repositories: { "acme/registry-demo": { githubTags: ["v1.3.0"] } }, requests });
		cancelEveryProgress();

		await runCommand("updateAll");

		await new Promise((resolve) => setTimeout(resolve, 0));

		assert.deepStrictEqual(requests, []);
		assert.deepStrictEqual(installCalls, []);
		assert.deepStrictEqual(messages, []);
		assert.deepStrictEqual(errors, []);
	});

	test("update stops quietly when the check is cancelled", async () => {
		const requests: string[] = [];
		stubNetwork({ repositories: { "acme/registry-demo": { githubTags: ["v1.0.0"] } }, requests });
		cancelEveryProgress();

		await runCommand("update", createItem("acme/registry-demo"));

		await new Promise((resolve) => setTimeout(resolve, 0));

		assert.deepStrictEqual(requests, []);
		assert.deepStrictEqual(installCalls, []);
		assert.deepStrictEqual(messages, []);
		assert.deepStrictEqual(errors, []);
	});

	test("update all stays quiet when it is cancelled before any install completes", async () => {
		stubTwoUpdates();
		const progress = cancellableProgress();
		quartoModule.installQuartoExtension = async (source, workspaceFolder, options = {}) => {
			installCalls.push({ source, workspaceFolder, sourceType: options.sourceType });
			progress.cancel();
			return null;
		};

		await runCommand("updateAll");

		assert.strictEqual(installCalls.length, 1);
		assert.deepStrictEqual(errors, []);
		assert.ok(!messages.some((message) => message.startsWith("Updated")), messages.join("\n"));
	});

	test("update all reports a declined install that is not a cancel", async () => {
		stubTwoUpdates();
		quartoModule.installQuartoExtension = async (source, workspaceFolder, options = {}) => {
			installCalls.push({ source, workspaceFolder, sourceType: options.sourceType });
			return null;
		};

		await runCommand("updateAll");

		assert.strictEqual(installCalls.length, 1);
		assert.deepStrictEqual(errors, ["Failed to update extensions."]);
	});

	test("update all reports a skipped extension and updates the others", async () => {
		stubTwoUpdates();
		const modes: (string | undefined)[] = [];
		quartoModule.installQuartoExtension = async (source, workspaceFolder, options = {}) => {
			installCalls.push({ source, workspaceFolder, sourceType: options.sourceType });
			modes.push(options.localEdits);
			if (source.startsWith("acme/registry-demo")) {
				if (options.outcome) {
					options.outcome.localEdits = new LocalEditsError({ owner: "acme", name: "registry-demo" }, [
						{ path: "_extension.yml", change: "modified" },
						{ path: "filter.lua", change: "missing" },
					]);
				}
				return null;
			}
			return true;
		};

		await runCommand("updateAll");

		assert.strictEqual(installCalls.length, 2);
		assert.deepStrictEqual(modes, ["skip", "skip"]);
		assert.deepStrictEqual(errors, []);
		assert.deepStrictEqual(messages.slice(-2), [
			"Updated acme/github-demo to 1.3.0.",
			"Skipped 1 extension with local changes: acme/registry-demo (_extension.yml (modified), filter.lua (missing)).",
		]);
	});

	test("update all groups the notes about copies without an install record", async () => {
		stubTwoUpdates();
		quartoModule.installQuartoExtension = async (source, workspaceFolder, options = {}) => {
			installCalls.push({ source, workspaceFolder, sourceType: options.sourceType });
			if (options.outcome) {
				options.outcome.replacedUntracked = true;
			}
			return true;
		};

		await runCommand("updateAll");

		assert.strictEqual(installCalls.length, 2);
		assert.deepStrictEqual(errors, []);
		assert.deepStrictEqual(
			messages.filter((message) => message.includes("no install record")),
			[
				"2 extensions had no install record, so Quarto Wizard could not check them for local changes: acme/github-demo, acme/registry-demo.",
			],
		);
	});

	test("update all does not report an error when every update is skipped", async () => {
		stubTwoUpdates();
		quartoModule.installQuartoExtension = async (source, workspaceFolder, options = {}) => {
			installCalls.push({ source, workspaceFolder, sourceType: options.sourceType });
			if (options.outcome) {
				options.outcome.localEdits = new LocalEditsError({ owner: "acme", name: "demo" }, [
					{ path: "_extension.yml", change: "added" },
				]);
			}
			return null;
		};

		await runCommand("updateAll");

		assert.strictEqual(installCalls.length, 2);
		assert.deepStrictEqual(errors, []);
		assert.match(messages[messages.length - 1], /^Skipped 2 extensions with local changes: /);
	});

	function recordReplaceRules(): { replaceSameVersion: boolean | undefined; force: boolean | undefined }[] {
		const rules: { replaceSameVersion: boolean | undefined; force: boolean | undefined }[] = [];
		quartoModule.installQuartoExtension = async (source, workspaceFolder, options = {}) => {
			installCalls.push({ source, workspaceFolder, sourceType: options.sourceType });
			rules.push({ replaceSameVersion: options.replaceSameVersion, force: options.force });
			return true;
		};
		return rules;
	}

	test("update replaces a copy at the same version without forcing", async () => {
		stubNetwork({ repositories: { "acme/github-demo": { githubTags: ["v1.3.0"] } } });
		const rules = recordReplaceRules();

		await runCommand("update", createItem("acme/github-demo"));

		assert.deepStrictEqual(rules, [{ replaceSameVersion: true, force: undefined }]);
	});

	test("update of a URL extension replaces a copy at the same version without forcing", async () => {
		const rules = recordReplaceRules();

		await runCommand("update", createItem("acme/url-demo"));

		assert.deepStrictEqual(rules, [{ replaceSameVersion: true, force: undefined }]);
	});

	test("update all replaces copies at the same version without forcing", async () => {
		stubTwoUpdates();
		const rules = recordReplaceRules();

		await runCommand("updateAll");

		assert.deepStrictEqual(rules, [
			{ replaceSameVersion: true, force: undefined },
			{ replaceSameVersion: true, force: undefined },
		]);
	});

	test("reinstall forces the install of the same version", async () => {
		const forced: (boolean | undefined)[] = [];
		quartoModule.installQuartoExtension = async (source, workspaceFolder, options = {}) => {
			installCalls.push({ source, workspaceFolder, sourceType: options.sourceType });
			forced.push(options.force);
			return true;
		};

		await runCommand("reinstall", createItem("acme/pinned-demo"));

		assert.deepStrictEqual(forced, [true]);
	});

	test("update and reinstall of an extension without a recorded source install nothing", async () => {
		const pinned = extensions["acme/pinned-demo"];
		const item = new ExtensionTreeItem("acme/pinned-demo", vscode.TreeItemCollapsibleState.Collapsed, FIXTURE_ROOT, {
			...pinned,
			manifest: { ...pinned.manifest, source: undefined },
		});

		await runCommand("update", item);
		await runCommand("reinstall", item);

		assert.deepStrictEqual(installCalls, []);
		assert.deepStrictEqual(errors, [
			'Failed to update extension "acme/pinned-demo". No install source is recorded for this extension.',
			'Failed to reinstall extension "acme/pinned-demo". No install source is recorded for this extension.',
		]);
	});

	suite("an extension installed without a ref", () => {
		const UNPINNED_ID = "acme/unpinned-demo";
		let unpinnedRoot: string;
		let recorded: RecordedInstall[];

		setup(() => {
			unpinnedRoot = vscode.Uri.file(fs.mkdtempSync(path.join(os.tmpdir(), "qw-unpinned-"))).fsPath;
			recorded = [];
			quartoModule.installQuartoExtension = async (source, workspaceFolder, options = {}) => {
				installCalls.push({ source, workspaceFolder, sourceType: options.sourceType });
				recorded.push({ source, recordSource: options.recordSource, track: options.track });
				return true;
			};
		});

		teardown(() => {
			fs.rmSync(unpinnedRoot, { recursive: true, force: true });
		});

		async function unpinnedItem(source: string, commit?: string): Promise<ExtensionTreeItem> {
			const extensionDir = path.join(unpinnedRoot, "_extensions", "acme", "unpinned-demo");
			fs.mkdirSync(extensionDir, { recursive: true });
			fs.writeFileSync(
				path.join(extensionDir, "_extension.yml"),
				"title: Unpinned demo\nauthor: Acme\nversion: 1.0.0\ncontributes: {}\n",
			);
			writeSourceRecord(extensionDir, {
				source,
				kind: "github",
				...(commit && { quartoWizard: { commit } }),
			});
			setRoots([makeRoot(makeFolder("unpinned", unpinnedRoot))]);
			const installed = await getInstalledExtensionsRecord(unpinnedRoot);
			return new ExtensionTreeItem(
				UNPINNED_ID,
				vscode.TreeItemCollapsibleState.Collapsed,
				unpinnedRoot,
				installed[UNPINNED_ID],
			);
		}

		test("update installs the latest tag and records it", async () => {
			stubNetwork({ repositories: { [UNPINNED_ID]: { githubTags: ["v1.3.0"] } } });

			await runCommand("update", await unpinnedItem(UNPINNED_ID));

			assert.deepStrictEqual(recorded, [{ source: `${UNPINNED_ID}@v1.3.0`, recordSource: undefined, track: "tag" }]);
		});

		test("update to a new commit installs the full commit and records the source without a ref", async () => {
			stubNetwork({ repositories: { [UNPINNED_ID]: { latestCommit: "fed9876543210fedcba9876543210fedcba98765" } } });

			await runCommand("update", await unpinnedItem(UNPINNED_ID, "aaaaaaa"));

			assert.deepStrictEqual(recorded, [
				{ source: `${UNPINNED_ID}@fed9876543210fedcba9876543210fedcba98765`, recordSource: UNPINNED_ID, track: "tag" },
			]);
		});

		test("update all to a new commit installs the full commit and records the source without a ref", async () => {
			stubNetwork({ repositories: { [UNPINNED_ID]: { latestCommit: "fed9876543210fedcba9876543210fedcba98765" } } });
			await unpinnedItem(UNPINNED_ID, "aaaaaaa");

			await runCommand("updateAll");

			assert.deepStrictEqual(recorded, [
				{ source: `${UNPINNED_ID}@fed9876543210fedcba9876543210fedcba98765`, recordSource: UNPINNED_ID, track: "tag" },
			]);
		});

		test("update of a pinned extension records the new ref", async () => {
			stubNetwork({ repositories: { [UNPINNED_ID]: { githubTags: ["v1.3.0"] } } });

			await runCommand("update", await unpinnedItem(`${UNPINNED_ID}@v1.0.0`));

			assert.deepStrictEqual(recorded, [{ source: `${UNPINNED_ID}@v1.3.0`, recordSource: undefined, track: "tag" }]);
		});

		test("update all of a pinned extension records the new ref", async () => {
			stubNetwork({ repositories: { [UNPINNED_ID]: { githubTags: ["v1.3.0"] } } });
			await unpinnedItem(`${UNPINNED_ID}@v1.0.0`);

			await runCommand("updateAll");

			assert.deepStrictEqual(recorded, [{ source: `${UNPINNED_ID}@v1.3.0`, recordSource: undefined, track: "tag" }]);
		});

		test("reinstall installs the recorded commit and records the source without a ref", async () => {
			await runCommand("reinstall", await unpinnedItem(UNPINNED_ID, "fed9876"));

			assert.deepStrictEqual(recorded, [{ source: `${UNPINNED_ID}@fed9876`, recordSource: UNPINNED_ID, track: "tag" }]);
		});

		test("reinstall of a tagged extension installs the source as recorded", async () => {
			await runCommand("reinstall", await unpinnedItem(UNPINNED_ID));

			assert.deepStrictEqual(recorded, [{ source: UNPINNED_ID, recordSource: undefined, track: "tag" }]);
		});
	});

	suite("change update source", () => {
		const SWITCH_ID = "acme/switch-demo";
		const HEAD = "fed9876543210fedcba9876543210fedcba98765";
		let switchRoot: string;
		let dialogs: { message: string; modal: boolean | undefined; items: string[] }[];
		let dialogAnswer: string | undefined;
		let installs: {
			source: string;
			recordSource: string | undefined;
			track: InstallTrack | undefined;
			replaceSameVersion: boolean | undefined;
			force: boolean | undefined;
			localEdits: string | undefined;
			expectedId: string | undefined;
		}[];

		setup(() => {
			switchRoot = vscode.Uri.file(fs.mkdtempSync(path.join(os.tmpdir(), "qw-switch-"))).fsPath;
			dialogs = [];
			dialogAnswer = "Switch";
			installs = [];
			vscode.window.showWarningMessage = (async (message: string, ...rest: unknown[]) => {
				const options = typeof rest[0] === "object" ? (rest[0] as vscode.MessageOptions) : undefined;
				dialogs.push({
					message,
					modal: options?.modal,
					items: rest.filter((item): item is string => typeof item === "string"),
				});
				return dialogAnswer;
			}) as unknown as typeof vscode.window.showWarningMessage;
			quartoModule.installQuartoExtension = async (source, workspaceFolder, options = {}) => {
				installCalls.push({ source, workspaceFolder, sourceType: options.sourceType });
				installs.push({
					source,
					recordSource: options.recordSource,
					track: options.track,
					replaceSameVersion: options.replaceSameVersion,
					force: options.force,
					localEdits: options.localEdits,
					expectedId: options.expectedExtensionId && formatExtensionId(options.expectedExtensionId),
				});
				return true;
			};
		});

		teardown(() => {
			fs.rmSync(switchRoot, { recursive: true, force: true });
		});

		async function switchItem(
			source: string,
			quartoWizard: { track: InstallTrack; commit?: string },
		): Promise<ExtensionTreeItem> {
			const extensionDir = path.join(switchRoot, "_extensions", "acme", "switch-demo");
			fs.mkdirSync(extensionDir, { recursive: true });
			fs.writeFileSync(
				path.join(extensionDir, "_extension.yml"),
				"title: Switch demo\nauthor: Acme\nversion: 1.0.0\ncontributes: {}\n",
			);
			writeSourceRecord(extensionDir, { source, kind: "github", quartoWizard });
			setRoots([makeRoot(makeFolder("switch", switchRoot))]);
			const installed = await getInstalledExtensionsRecord(switchRoot);
			return new ExtensionTreeItem(
				SWITCH_ID,
				vscode.TreeItemCollapsibleState.Collapsed,
				switchRoot,
				installed[SWITCH_ID],
			);
		}

		test("tag to branch asks with the exact copy and installs the head of the default branch", async () => {
			stubNetwork({ repositories: { [SWITCH_ID]: { latestCommit: HEAD, defaultBranch: "main" } } });

			await runCommand("changeUpdateSource", await switchItem(`${SWITCH_ID}@v1.0.0`, { track: "tag" }));

			assert.deepStrictEqual(dialogs, [
				{
					message: `Switch "${SWITCH_ID}" to the default branch: install main @ fed9876 (now 1.0.0)?`,
					modal: true,
					items: ["Switch"],
				},
			]);
			assert.deepStrictEqual(installs, [
				{
					source: `${SWITCH_ID}@${HEAD}`,
					recordSource: SWITCH_ID,
					track: "branch",
					replaceSameVersion: true,
					force: undefined,
					localEdits: undefined,
					expectedId: SWITCH_ID,
				},
			]);
			assert.ok(
				messages.includes(`Extension "${SWITCH_ID}" now updates from the default branch.`),
				messages.join("\n"),
			);
		});

		test("branch to tag asks with the exact copy and installs the latest tag", async () => {
			stubNetwork({ repositories: { [SWITCH_ID]: { githubTags: ["v1.3.0"] } } });

			await runCommand("changeUpdateSource", await switchItem(SWITCH_ID, { track: "branch", commit: HEAD }));

			assert.deepStrictEqual(
				dialogs.map((dialog) => dialog.message),
				[`Switch "${SWITCH_ID}" to the latest tag: install v1.3.0 (now 1.0.0)?`],
			);
			assert.deepStrictEqual(
				installs.map((install) => [install.source, install.recordSource, install.track, install.replaceSameVersion]),
				[[`${SWITCH_ID}@v1.3.0`, undefined, "tag", true]],
			);
			assert.ok(messages.includes(`Extension "${SWITCH_ID}" now updates from the latest tag.`), messages.join("\n"));
		});

		test("a downgrade adds a second sentence", async () => {
			stubNetwork({ repositories: { [SWITCH_ID]: { githubTags: ["v0.9.0"] } } });

			await runCommand("changeUpdateSource", await switchItem(SWITCH_ID, { track: "branch", commit: HEAD }));

			assert.deepStrictEqual(
				dialogs.map((dialog) => dialog.message),
				[
					`Switch "${SWITCH_ID}" to the latest tag: install v0.9.0 (now 1.0.0)? This is an older version than the one installed.`,
				],
			);
		});

		for (const [name, answer] of [
			["a dismissed dialog", undefined],
			["another button", "Cancel"],
		] as const) {
			test(`${name} installs nothing`, async () => {
				stubNetwork({ repositories: { [SWITCH_ID]: { latestCommit: HEAD } } });
				dialogAnswer = answer;

				await runCommand("changeUpdateSource", await switchItem(SWITCH_ID, { track: "tag" }));

				assert.strictEqual(dialogs.length, 1);
				assert.deepStrictEqual(installs, []);
			});
		}

		test("local edits are left to the Replace anyway dialog of the install", async () => {
			stubNetwork({ repositories: { [SWITCH_ID]: { latestCommit: HEAD } } });

			await runCommand("changeUpdateSource", await switchItem(SWITCH_ID, { track: "tag" }));

			assert.strictEqual(installs[0].localEdits, undefined);
			assert.strictEqual(installs[0].force, undefined);
			assert.strictEqual(installs[0].replaceSameVersion, true);
		});

		test("a branch with no commit shows the error and installs nothing", async () => {
			stubNetwork({ repositories: { [SWITCH_ID]: {} } });

			await runCommand("changeUpdateSource", await switchItem(SWITCH_ID, { track: "tag" }));

			assert.deepStrictEqual(dialogs, []);
			assert.deepStrictEqual(installs, []);
			assert.deepStrictEqual(errors, [
				`Cannot find a commit on the default branch of "${SWITCH_ID}". Check that the repository has commits and try again.`,
			]);
		});

		test("an extension that is not on GitHub shows nothing", async () => {
			await runCommand("changeUpdateSource", createItem("acme/url-demo"));

			assert.deepStrictEqual(dialogs, []);
			assert.deepStrictEqual(installs, []);
			assert.deepStrictEqual(errors, []);
		});
	});

	test("reinstall in branch mode installs the recorded commit and keeps the mode", async () => {
		const reinstalled: RecordedInstall[] = [];
		quartoModule.installQuartoExtension = async (source, _workspaceFolder, options = {}) => {
			reinstalled.push({ source, recordSource: options.recordSource, track: options.track });
			return true;
		};
		const root = vscode.Uri.file(fs.mkdtempSync(path.join(os.tmpdir(), "qw-branch-"))).fsPath;
		try {
			const extensionDir = path.join(root, "_extensions", "acme", "branch-demo");
			fs.mkdirSync(extensionDir, { recursive: true });
			fs.writeFileSync(
				path.join(extensionDir, "_extension.yml"),
				"title: Branch demo\nauthor: Acme\nversion: 1.0.0\ncontributes: {}\n",
			);
			const commit = "fed9876543210fedcba9876543210fedcba98765";
			writeSourceRecord(extensionDir, {
				source: "acme/branch-demo@dev",
				kind: "github",
				quartoWizard: { track: "branch", commit },
			});
			setRoots([makeRoot(makeFolder("branch", root))]);
			const installed = await getInstalledExtensionsRecord(root);

			await runCommand(
				"reinstall",
				new ExtensionTreeItem(
					"acme/branch-demo",
					vscode.TreeItemCollapsibleState.Collapsed,
					root,
					installed["acme/branch-demo"],
				),
			);

			assert.deepStrictEqual(reinstalled, [
				{ source: `acme/branch-demo@${commit}`, recordSource: "acme/branch-demo@dev", track: "branch" },
			]);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	test("update all reports the updates done before a cancel", async () => {
		stubTwoUpdates();
		const progress = cancellableProgress();
		quartoModule.installQuartoExtension = async (source, workspaceFolder, options = {}) => {
			installCalls.push({ source, workspaceFolder, sourceType: options.sourceType });
			if (installCalls.length === 1) {
				return true;
			}
			progress.cancel();
			return null;
		};

		await runCommand("updateAll");

		assert.strictEqual(installCalls.length, 2);
		assert.deepStrictEqual(errors, []);
		assert.strictEqual(messages[messages.length - 1], "Updated acme/github-demo to 1.3.0; cancelled before 1 more.");
	});

	test("update all reports a failed install when it is cancelled afterwards", async () => {
		stubTwoUpdates();
		const progress = cancellableProgress();
		quartoModule.installQuartoExtension = async (source, workspaceFolder, options = {}) => {
			installCalls.push({ source, workspaceFolder, sourceType: options.sourceType });
			if (installCalls.length === 1) {
				return false;
			}
			progress.cancel();
			return null;
		};

		await runCommand("updateAll");

		assert.strictEqual(installCalls.length, 2);
		assert.deepStrictEqual(errors, ["Failed to update extensions."]);
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

	test("update all skips the extensions of an installed embedded parent", async () => {
		stubTwoUpdates();
		setRoots([
			makeEmbeddedRoot(makeFolder("treeCommands", FIXTURE_ROOT), {
				id: { owner: "acme", name: "parent" },
				source: "acme/parent@v1.0.0",
			}),
		]);

		await runCommand("updateAll");

		assert.deepStrictEqual(installCalls, []);
		assert.deepStrictEqual(messages, ["All extensions are up to date."]);
	});

	test("update all skips a self-embedded extension", async () => {
		stubTwoUpdates();
		setRoots([
			makeEmbeddedRoot(makeFolder("treeCommands", FIXTURE_ROOT), { id: { owner: "acme", name: "registry-demo" } }),
		]);

		await runCommand("updateAll");

		assert.deepStrictEqual(installCalls, [
			{ source: "acme/github-demo@v1.3.0", workspaceFolder: FIXTURE_ROOT, sourceType: "github" },
		]);
		assert.ok(!messages[0].includes("acme/registry-demo"), messages[0]);
	});

	test("update all skips a hidden project and still checks a visible one", async () => {
		const requests: string[] = [];
		stubNetwork({
			requests,
			repositories: {
				"acme/registry-demo": { githubTags: ["v1.3.0"] },
				"acme/github-demo": { githubTags: ["v1.3.0"] },
			},
		});
		const visiblePath = vscode.Uri.file(fs.mkdtempSync(path.join(os.tmpdir(), "qw-update-all-"))).fsPath;
		try {
			const extensionDir = path.join(visiblePath, "_extensions", "acme", "github-demo");
			fs.mkdirSync(extensionDir, { recursive: true });
			fs.writeFileSync(
				path.join(extensionDir, "_extension.yml"),
				"title: GitHub demo\nauthor: Acme\nversion: 1.0.0\ncontributes: {}\nsource: acme/github-demo@v1.0.0\nsource-type: github\n",
			);
			setRoots([makeRoot(makeFolder("treeCommands", FIXTURE_ROOT)), makeRoot(makeFolder("visible", visiblePath, 1))]);
			await runCommand("hideProject", new WorkspaceFolderTreeItem("treeCommands", FIXTURE_ROOT));

			await runCommand("updateAll");

			assert.deepStrictEqual(installCalls, [
				{ source: "acme/github-demo@v1.3.0", workspaceFolder: visiblePath, sourceType: "github" },
			]);
			assert.ok(
				requests.some((url) => url.includes("/acme/github-demo")),
				requests.join("\n"),
			);
			assert.ok(!requests.some((url) => url.includes("/acme/registry-demo")), requests.join("\n"));
		} finally {
			fs.rmSync(visiblePath, { recursive: true, force: true });
		}
	});

	test("hideProject hides the folder", async () => {
		const tree = provider as unknown as QuartoExtensionTreeDataProvider;
		const otherPath = path.join(FIXTURE_ROOT, "_extensions");
		setRoots([makeRoot(makeFolder("treeCommands", FIXTURE_ROOT)), makeRoot(makeFolder("other", otherPath, 1))]);
		assert.strictEqual((await tree.getChildren()).length, 2);

		await runCommand("hideProject", new WorkspaceFolderTreeItem("other", otherPath));

		const top = await tree.getChildren();
		assert.deepStrictEqual(
			top.map((item) => (item as WorkspaceFolderTreeItem).folderPath),
			[FIXTURE_ROOT],
		);
	});
});
