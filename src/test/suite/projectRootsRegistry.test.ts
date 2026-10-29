import * as assert from "assert";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
	ensureProjectRoots,
	findOwningProjectRoot,
	findOwningProjectRootSync,
	getAllProjectRoots,
	invalidateProjectRoots,
	refreshProjectRoots,
	setProjectRoots,
} from "../../utils/projectRootsRegistry";
import * as discovery from "../../utils/quartoProjectDiscovery";
import type { QuartoProjectRoot } from "../../utils/quartoProjectDiscovery";
import { makeFolder, makeRoot } from "./projectFixtures";
import { Stubs } from "./stubs";

suite("Project Roots Registry Test Suite", () => {
	const tmpRoot = vscode.Uri.file(os.tmpdir()).fsPath;
	const workspaceFsPath = path.join(tmpRoot, "registry-ws");
	const workspace = makeFolder("registry-ws", workspaceFsPath);
	const nestedA = makeRoot(workspace, "subA");
	const nestedADeep = makeRoot(workspace, "subA", "deeper");
	const nestedB = makeRoot(workspace, "subB");
	const workspaceRoot = makeRoot(workspace);
	const embeddedParent: QuartoProjectRoot = {
		...makeRoot(workspace, "_extensions", "astek"),
		embeddedIn: { id: { owner: null, name: "astek" } },
	};

	const stubs = new Stubs();
	let originalWorkspaceFoldersDescriptor: PropertyDescriptor | undefined;

	setup(() => {
		originalWorkspaceFoldersDescriptor = Object.getOwnPropertyDescriptor(vscode.workspace, "workspaceFolders");
	});

	teardown(() => {
		invalidateProjectRoots();
		stubs.restore();
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

	test("findOwningProjectRootSync skips embedded roots", () => {
		setProjectRoots([workspaceRoot, embeddedParent]);

		const filter = path.join(embeddedParent.fsPath, "astek.lua");

		assert.strictEqual(findOwningProjectRootSync(filter), workspaceRoot.fsPath);
	});

	test("findOwningProjectRoot skips embedded roots", async () => {
		setProjectRoots([workspaceRoot, embeddedParent]);

		const filter = vscode.Uri.file(path.join(embeddedParent.fsPath, "astek.lua"));

		assert.strictEqual(await findOwningProjectRoot(filter), workspaceRoot.fsPath);
	});

	test("ensureProjectRoots excludes embedded roots", async () => {
		setProjectRoots([workspaceRoot, embeddedParent]);

		const roots = await ensureProjectRoots();

		assert.deepStrictEqual(roots, [workspaceRoot]);
	});

	test("getAllProjectRoots includes embedded roots", () => {
		setProjectRoots([workspaceRoot, embeddedParent]);

		assert.deepStrictEqual(getAllProjectRoots(), [workspaceRoot, embeddedParent]);
	});

	test("refreshProjectRoots returns embedded roots", async () => {
		Object.defineProperty(vscode.workspace, "workspaceFolders", {
			get: () => [workspace],
			configurable: true,
		});
		stubs.replace(discovery, "discoverQuartoProjectRoots", async () => [workspaceRoot, embeddedParent]);

		const roots = await refreshProjectRoots();

		assert.deepStrictEqual(roots, [workspaceRoot, embeddedParent]);
	});

	/** Resolves once `predicate` holds, so a test can wait for a discovery to start. */
	async function waitFor(predicate: () => boolean): Promise<void> {
		for (let attempt = 0; attempt < 200; attempt += 1) {
			if (predicate()) {
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		assert.fail("timed out waiting for the discoveries to start");
	}

	/** A discovery that waits for its gate, and records the token it was given. */
	interface HeldDiscovery {
		token: vscode.CancellationToken | undefined;
		release: () => void;
	}

	/** Holds every discovery open until the test releases it. */
	function holdDiscoveries(result: readonly QuartoProjectRoot[] = [workspaceRoot]): HeldDiscovery[] {
		Object.defineProperty(vscode.workspace, "workspaceFolders", {
			get: () => [workspace],
			configurable: true,
		});
		const held: HeldDiscovery[] = [];
		stubs.replace(
			discovery,
			"discoverQuartoProjectRoots",
			(_folders: readonly vscode.WorkspaceFolder[], token?: vscode.CancellationToken) =>
				new Promise<QuartoProjectRoot[]>((resolve) => {
					held.push({ token, release: () => resolve([...result]) });
				}),
		);
		return held;
	}

	test("ensureProjectRoots joins an in-flight refresh rather than cancelling it", async () => {
		invalidateProjectRoots();
		const held = holdDiscoveries();

		// The tree view refreshes on activation while a provider asks for the roots.
		const refreshed = refreshProjectRoots();
		const ensured = ensureProjectRoots();
		await waitFor(() => held.length >= 1);
		held[0].release();
		const [refreshedRoots, ensuredRoots] = await Promise.all([refreshed, ensured]);

		// A second discovery would cancel the first, and the tree view would render nothing.
		assert.strictEqual(held.length, 1);
		assert.ok(refreshedRoots, "the refresh must not report itself superseded");
		assert.deepStrictEqual(
			ensuredRoots.map((root) => root.fsPath),
			[workspaceFsPath],
		);
	});

	test("ensureProjectRoots waits for the discovery that superseded the one it joined", async () => {
		invalidateProjectRoots();
		const held = holdDiscoveries();

		// A provider asks for the roots, then a watcher event supersedes that discovery.
		const ensured = ensureProjectRoots();
		await waitFor(() => held.length >= 1);
		const refreshed = refreshProjectRoots();
		await waitFor(() => held.length >= 2);

		// The superseded discovery answers first, while the snapshot is still empty.
		held[0].release();
		await new Promise((resolve) => setTimeout(resolve, 0));
		held[1].release();

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
		const held = holdDiscoveries();

		const first = ensureProjectRoots();
		await waitFor(() => held.length >= 1);
		invalidateProjectRoots();
		const second = ensureProjectRoots();
		await waitFor(() => held.length >= 2);

		// The superseded discovery settles while the newer one is still in flight.
		held[0].release();
		await new Promise((resolve) => setTimeout(resolve, 0));

		// Its `finally` must leave the newer discovery in place for this caller to join.
		const third = ensureProjectRoots();
		held[1].release();
		await Promise.all([first, second, third]);

		assert.strictEqual(held.length, 2);
	});

	test("invalidateProjectRoots cancels the token an in-flight discovery holds", async () => {
		invalidateProjectRoots();
		const held = holdDiscoveries();

		const pending = ensureProjectRoots();
		await waitFor(() => held.length >= 1);
		invalidateProjectRoots();
		held[0].release();
		// Nothing replaced the cancelled discovery, and the debounced refresh of the
		// tree view is 500 ms away, so the caller must run one of its own.
		await waitFor(() => held.length >= 2);
		held[1].release();
		const roots = await pending;

		assert.ok(held[0].token, "discovery must receive a cancellation token");
		assert.strictEqual(held[0].token?.isCancellationRequested, true);
		assert.deepStrictEqual(
			roots.map((root) => root.fsPath),
			[workspaceFsPath],
		);
	});

	test("setProjectRoots wins over an older in-flight ensureProjectRoots discovery", async () => {
		// Force `ensureProjectRoots` down the discovery branch by leaving state uninitialised.
		invalidateProjectRoots();
		// Without the race fix, the held discovery would write `[workspaceRoot]` over
		// whatever `setProjectRoots` wrote.
		const held = holdDiscoveries();

		const pending = ensureProjectRoots();
		await waitFor(() => held.length >= 1);
		setProjectRoots([nestedADeep]);
		held[0].release();
		const resolved = await pending;

		assert.deepStrictEqual(
			resolved.map((root) => root.fsPath),
			[nestedADeep.fsPath],
		);
		assert.strictEqual(findOwningProjectRootSync(path.join(nestedADeep.fsPath, "doc.qmd")), nestedADeep.fsPath);
	});
});
