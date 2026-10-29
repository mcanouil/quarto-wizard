import * as assert from "assert";
import * as path from "node:path";
import { buildProjectTree, type ProjectTreeNode } from "../../ui/projectTreeBuilder";
import { makeFolder, makeRoot } from "./projectFixtures";

function expectProject(node: ProjectTreeNode, expectedLabel: string): void {
	assert.strictEqual(node.kind, "project", `Expected project leaf with label "${expectedLabel}"`);
	assert.strictEqual(node.label, expectedLabel);
}

function expectGroup(node: ProjectTreeNode, expectedLabel: string, childCount: number): void {
	assert.strictEqual(node.kind, "group", `Expected group with label "${expectedLabel}"`);
	if (node.kind === "group") {
		assert.strictEqual(node.label, expectedLabel);
		assert.strictEqual(node.children.length, childCount);
	}
}

suite("Project Tree Builder Test Suite", () => {
	test("Empty input yields empty tree", () => {
		assert.deepStrictEqual(buildProjectTree([]), []);
	});

	test("Single project at workspace root renders as a leaf", () => {
		const folder = makeFolder("myrepo", path.resolve(path.sep, "tmp", "myrepo"));
		const root = makeRoot(folder);
		const tree = buildProjectTree([root]);
		assert.strictEqual(tree.length, 1);
		expectProject(tree[0], "myrepo");
		if (tree[0].kind === "project") {
			assert.strictEqual(tree[0].root, root);
		}
	});

	test("Single sub-project collapses into a flat label", () => {
		const folder = makeFolder("myrepo", path.resolve(path.sep, "tmp", "myrepo"));
		const root = makeRoot(folder, "docs", "projectA");
		const tree = buildProjectTree([root]);
		assert.strictEqual(tree.length, 1);
		expectProject(tree[0], "myrepo/docs/projectA");
	});

	test("Sibling sub-projects sharing a parent are grouped", () => {
		const folder = makeFolder("myrepo", path.resolve(path.sep, "tmp", "myrepo"));
		const a = makeRoot(folder, "docs", "A");
		const b = makeRoot(folder, "docs", "B");
		const tree = buildProjectTree([a, b]);
		assert.strictEqual(tree.length, 1);
		expectGroup(tree[0], "myrepo/docs", 2);
		if (tree[0].kind === "group") {
			expectProject(tree[0].children[0], "A");
			expectProject(tree[0].children[1], "B");
		}
	});

	test("Sub-projects under different parents share a workspace group with collapsed children", () => {
		const folder = makeFolder("myrepo", path.resolve(path.sep, "tmp", "myrepo"));
		const a = makeRoot(folder, "docs", "A");
		const b = makeRoot(folder, "other", "B");
		const tree = buildProjectTree([a, b]);
		assert.strictEqual(tree.length, 1);
		expectGroup(tree[0], "myrepo", 2);
		if (tree[0].kind === "group") {
			const labels = tree[0].children.map((child) => child.label).sort();
			assert.deepStrictEqual(labels, ["docs/A", "other/B"]);
			for (const child of tree[0].children) {
				assert.strictEqual(child.kind, "project");
			}
		}
	});

	test("Deeper shared parents collapse the workspace name into the group label", () => {
		const folder = makeFolder("myrepo", path.resolve(path.sep, "tmp", "myrepo"));
		const a = makeRoot(folder, "docs", "sub", "A");
		const b = makeRoot(folder, "docs", "sub", "B");
		const tree = buildProjectTree([a, b]);
		assert.strictEqual(tree.length, 1);
		expectGroup(tree[0], "myrepo/docs/sub", 2);
		if (tree[0].kind === "group") {
			expectProject(tree[0].children[0], "A");
			expectProject(tree[0].children[1], "B");
		}
	});

	test("Workspace-root project with one sub-project keeps its own leaf first", () => {
		const folder = makeFolder("myrepo", path.resolve(path.sep, "tmp", "myrepo"));
		const own = makeRoot(folder);
		const docs = makeRoot(folder, "docs");
		const tree = buildProjectTree([own, docs]);
		assert.strictEqual(tree.length, 1);
		expectGroup(tree[0], "myrepo", 2);
		if (tree[0].kind === "group") {
			assert.strictEqual(tree[0].fsPath, folder.uri.fsPath);
			expectProject(tree[0].children[0], "myrepo");
			if (tree[0].children[0].kind === "project") {
				assert.strictEqual(tree[0].children[0].root, own);
			}
			expectProject(tree[0].children[1], "docs");
		}
	});

	test("Workspace-root project with several sub-projects keeps its own leaf first", () => {
		const folder = makeFolder("myrepo", path.resolve(path.sep, "tmp", "myrepo"));
		const own = makeRoot(folder);
		const tree = buildProjectTree([
			own,
			makeRoot(folder, "docs", "A"),
			makeRoot(folder, "docs", "B"),
			makeRoot(folder, "site"),
		]);
		assert.strictEqual(tree.length, 1);
		expectGroup(tree[0], "myrepo", 3);
		if (tree[0].kind === "group") {
			expectProject(tree[0].children[0], "myrepo");
			if (tree[0].children[0].kind === "project") {
				assert.strictEqual(tree[0].children[0].root, own);
			}
			expectGroup(tree[0].children[1], "docs", 2);
			expectProject(tree[0].children[2], "site");
		}
	});

	test("Nested project with one sub-project is not collapsed into its parent", () => {
		const folder = makeFolder("myrepo", path.resolve(path.sep, "tmp", "myrepo"));
		const ext = makeRoot(folder, "_extensions", "x");
		const child = makeRoot(folder, "_extensions", "x", "sub");
		const tree = buildProjectTree([ext, child]);
		assert.strictEqual(tree.length, 1);
		expectGroup(tree[0], "myrepo/_extensions/x", 2);
		if (tree[0].kind === "group") {
			expectProject(tree[0].children[0], "x");
			expectProject(tree[0].children[1], "sub");
		}
	});

	test("Multiple workspaces with one project each remain flat", () => {
		const repoA = makeFolder("repoA", path.resolve(path.sep, "tmp", "repoA"));
		const repoB = makeFolder("repoB", path.resolve(path.sep, "tmp", "repoB"));
		const tree = buildProjectTree([makeRoot(repoA), makeRoot(repoB)]);
		assert.strictEqual(tree.length, 2);
		expectProject(tree[0], "repoA");
		expectProject(tree[1], "repoB");
	});

	test("Mixed workspaces: one with siblings, one with a single root", () => {
		const repoA = makeFolder("repoA", path.resolve(path.sep, "tmp", "repoA"));
		const repoB = makeFolder("repoB", path.resolve(path.sep, "tmp", "repoB"));
		const tree = buildProjectTree([makeRoot(repoA, "docs", "A"), makeRoot(repoA, "docs", "B"), makeRoot(repoB)]);
		assert.strictEqual(tree.length, 2);
		expectGroup(tree[0], "repoA/docs", 2);
		expectProject(tree[1], "repoB");
	});
});
