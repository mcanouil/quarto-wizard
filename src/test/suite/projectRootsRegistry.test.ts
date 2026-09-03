import * as assert from "assert";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
	ensureProjectRoots,
	findOwningProjectRoot,
	findOwningProjectRootSync,
	invalidateProjectRoots,
	refreshProjectRoots,
	setProjectRoots,
} from "../../utils/projectRootsRegistry";
import { makeFolder, makeRoot } from "./projectFixtures";

suite("Project Roots Registry Test Suite", () => {
	const tmpRoot = vscode.Uri.file(os.tmpdir()).fsPath;
	const workspaceFsPath = path.join(tmpRoot, "registry-ws");
	const workspace = makeFolder("registry-ws", workspaceFsPath);
	const nestedA = makeRoot(workspace, "subA");
	const nestedADeep = makeRoot(workspace, "subA", "deeper");
	const nestedB = makeRoot(workspace, "subB");

	let originalFindFiles: typeof vscode.workspace.findFiles;
	let originalWorkspaceFoldersDescriptor: PropertyDescriptor | undefined;

	setup(() => {
		originalFindFiles = vscode.workspace.findFiles;
		originalWorkspaceFoldersDescriptor = Object.getOwnPropertyDescriptor(vscode.workspace, "workspaceFolders");
	});

	teardown(() => {
		invalidateProjectRoots();
		vscode.workspace.findFiles = originalFindFiles;
		if (originalWorkspaceFoldersDescriptor) {
			Object.defineProperty(vscode.workspace, "workspaceFolders", originalWorkspaceFoldersDescriptor);
		}
	});

	test("findOwningProjectRoot returns the deepest matching root", async () => {
		setProjectRoots([nestedA, nestedADeep]);

		const document = vscode.Uri.file(path.join(nestedADeep.fsPath, "doc.qmd"));
		const owning = await findOwningProjectRoot(document);

		assert.strictEqual(owning, nestedADeep.fsPath);
	});

	test("findOwningProjectRoot returns the only matching root when others are siblings", async () => {
		setProjectRoots([nestedA, nestedB]);

		const document = vscode.Uri.file(path.join(nestedB.fsPath, "doc.qmd"));
		const owning = await findOwningProjectRoot(document);

		assert.strictEqual(owning, nestedB.fsPath);
	});

	test("findOwningProjectRoot returns undefined when the document lives outside every root", async () => {
		setProjectRoots([nestedA]);

		const outside = vscode.Uri.file(path.join(workspaceFsPath, "outside", "doc.qmd"));
		const owning = await findOwningProjectRoot(outside);

		assert.strictEqual(owning, undefined);
	});

	test("findOwningProjectRoot returns undefined for non-file URIs", async () => {
		setProjectRoots([nestedA]);

		const untitled = vscode.Uri.parse("untitled:Untitled-1");
		const owning = await findOwningProjectRoot(untitled);

		assert.strictEqual(owning, undefined);
	});

	test("findOwningProjectRootSync mirrors the async lookup against the current snapshot", () => {
		setProjectRoots([nestedA, nestedADeep]);

		const document = path.join(nestedADeep.fsPath, "doc.qmd");

		assert.strictEqual(findOwningProjectRootSync(document), nestedADeep.fsPath);
	});

	test("ensureProjectRoots short-circuits to the snapshot once seeded", async () => {
		setProjectRoots([nestedA]);

		const roots = await ensureProjectRoots();

		assert.deepStrictEqual(
			roots.map((root) => root.fsPath),
			[nestedA.fsPath],
		);
	});

	test("invalidateProjectRoots empties the synchronous snapshot", () => {
		setProjectRoots([nestedA, nestedB]);
		invalidateProjectRoots();

		assert.strictEqual(findOwningProjectRootSync(path.join(nestedA.fsPath, "doc.qmd")), undefined);
	});

	/** Resolves once `predicate` holds, so a test can wait for a scan to start. */
	async function waitFor(predicate: () => boolean): Promise<void> {
		for (let attempt = 0; attempt < 200; attempt += 1) {
			if (predicate()) {
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		assert.fail("timed out waiting for the scans to start");
	}

	test("ensureProjectRoots joins an in-flight refresh rather than cancelling it", async () => {
		invalidateProjectRoots();

		Object.defineProperty(vscode.workspace, "workspaceFolders", {
			get: () => [workspace],
			configurable: true,
		});

		let scans = 0;
		let releaseFindFiles: () => void = () => undefined;
		const blockUntil = new Promise<void>((resolve) => {
			releaseFindFiles = resolve;
		});
		vscode.workspace.findFiles = (() => {
			scans += 1;
			return blockUntil.then(() => [] as vscode.Uri[]);
		}) as typeof vscode.workspace.findFiles;

		// The tree view refreshes on activation while a provider asks for the roots.
		const refreshed = refreshProjectRoots();
		const ensured = ensureProjectRoots();
		await waitFor(() => scans >= 2);
		releaseFindFiles();
		const [refreshedRoots, ensuredRoots] = await Promise.all([refreshed, ensured]);

		// One discovery runs two scans. A second discovery would cancel the first,
		// and the tree view would render nothing.
		assert.strictEqual(scans, 2);
		assert.ok(refreshedRoots, "the refresh must not report itself superseded");
		assert.deepStrictEqual(
			ensuredRoots.map((root) => root.fsPath),
			[workspaceFsPath],
		);
	});

	test("ensureProjectRoots waits for the discovery that superseded the one it joined", async () => {
		invalidateProjectRoots();

		Object.defineProperty(vscode.workspace, "workspaceFolders", {
			get: () => [workspace],
			configurable: true,
		});

		let scans = 0;
		const gates: (() => void)[] = [];
		vscode.workspace.findFiles = (() => {
			scans += 1;
			return new Promise<vscode.Uri[]>((resolve) => {
				gates.push(() => resolve([]));
			});
		}) as typeof vscode.workspace.findFiles;

		// A provider asks for the roots, then a watcher event supersedes that scan.
		const ensured = ensureProjectRoots();
		await waitFor(() => scans >= 2);
		const refreshed = refreshProjectRoots();
		await waitFor(() => scans >= 4);

		// The superseded scans answer first, while the snapshot is still empty.
		gates[0]();
		gates[1]();
		await new Promise((resolve) => setTimeout(resolve, 0));
		gates[2]();
		gates[3]();

		const [ensuredRoots, refreshedRoots] = await Promise.all([ensured, refreshed]);

		// The empty snapshot would make `selectWorkspaceFolder` report no workspace.
		assert.deepStrictEqual(
			ensuredRoots.map((root) => root.fsPath),
			[workspaceFsPath],
		);
		assert.deepStrictEqual(ensuredRoots, refreshedRoots);
	});

	test("a superseded discovery leaves the in-flight promise of the newer one alone", async () => {
		invalidateProjectRoots();

		Object.defineProperty(vscode.workspace, "workspaceFolders", {
			get: () => [workspace],
			configurable: true,
		});

		let scans = 0;
		const gates: (() => void)[] = [];
		vscode.workspace.findFiles = (() => {
			scans += 1;
			return new Promise<vscode.Uri[]>((resolve) => {
				gates.push(() => resolve([]));
			});
		}) as typeof vscode.workspace.findFiles;

		const first = ensureProjectRoots();
		await waitFor(() => scans >= 2);
		invalidateProjectRoots();
		const second = ensureProjectRoots();
		await waitFor(() => scans >= 4);

		// The superseded discovery settles while the newer one is still in flight.
		gates[0]();
		gates[1]();
		await new Promise((resolve) => setTimeout(resolve, 0));

		// Its `finally` must leave the newer discovery in place for this caller to join.
		const third = ensureProjectRoots();
		gates[2]();
		gates[3]();
		await Promise.all([first, second, third]);

		assert.strictEqual(scans, 4);
	});

	test("invalidateProjectRoots cancels the scan an in-flight discovery started", async () => {
		invalidateProjectRoots();

		Object.defineProperty(vscode.workspace, "workspaceFolders", {
			get: () => [workspace],
			configurable: true,
		});

		const tokens: (vscode.CancellationToken | undefined)[] = [];
		let releaseFindFiles: () => void = () => undefined;
		const blockUntil = new Promise<void>((resolve) => {
			releaseFindFiles = resolve;
		});
		vscode.workspace.findFiles = ((
			_include: vscode.GlobPattern,
			_exclude?: vscode.GlobPattern | null,
			_maxResults?: number,
			token?: vscode.CancellationToken,
		) => {
			tokens.push(token);
			return blockUntil.then(() => [] as vscode.Uri[]);
		}) as typeof vscode.workspace.findFiles;

		const pending = ensureProjectRoots();
		await waitFor(() => tokens.length >= 2);
		invalidateProjectRoots();
		releaseFindFiles();
		const roots = await pending;

		assert.ok(tokens[0], "discovery must pass a cancellation token to findFiles");
		assert.strictEqual(tokens[0]?.isCancellationRequested, true);
		// Nothing replaced the cancelled discovery, and the debounced refresh of the
		// tree view is 500 ms away, so the caller must run one of its own.
		assert.deepStrictEqual(
			roots.map((root) => root.fsPath),
			[workspaceFsPath],
		);
	});

	test("setProjectRoots wins over an older in-flight ensureProjectRoots discovery", async () => {
		// Force `ensureProjectRoots` down the discovery branch by leaving state uninitialised.
		invalidateProjectRoots();

		Object.defineProperty(vscode.workspace, "workspaceFolders", {
			get: () => [workspace],
			configurable: true,
		});

		// Hold discovery open: returning no files means the workspace folder root falls back
		// to itself, so without the race fix the `.then` would set `currentRoots` to a
		// fallback `[workspaceRoot]` snapshot — clobbering whatever `setProjectRoots` wrote.
		let releaseFindFiles: () => void = () => undefined;
		const blockUntil = new Promise<void>((resolve) => {
			releaseFindFiles = resolve;
		});
		vscode.workspace.findFiles = (() => blockUntil.then(() => [] as vscode.Uri[])) as typeof vscode.workspace.findFiles;

		const pending = ensureProjectRoots();
		setProjectRoots([nestedADeep]);
		releaseFindFiles();
		const resolved = await pending;

		assert.deepStrictEqual(
			resolved.map((root) => root.fsPath),
			[nestedADeep.fsPath],
		);
		assert.strictEqual(findOwningProjectRootSync(path.join(nestedADeep.fsPath, "doc.qmd")), nestedADeep.fsPath);
	});
});
