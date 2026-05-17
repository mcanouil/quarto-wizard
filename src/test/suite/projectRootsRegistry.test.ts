import * as assert from "assert";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
	ensureProjectRoots,
	findOwningProjectRoot,
	findOwningProjectRootSync,
	invalidateProjectRoots,
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

	teardown(() => {
		invalidateProjectRoots();
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
});
