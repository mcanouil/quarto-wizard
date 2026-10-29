import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { ProjectVisibility, defaultVisibility, resolveVisibility, visibilityKey } from "../../utils/projectVisibility";
import { FakeMemento, makeFolder, makeRoot } from "./projectFixtures";

suite("Project Visibility Test Suite", () => {
	const root = path.resolve("workspace-a");
	const folderA = makeFolder("a", root);
	const folderB = makeFolder("b", path.resolve("workspace-b"), 1);

	suite("defaultVisibility", () => {
		test("hides a project that .quartoignore excludes", () => {
			assert.strictEqual(defaultVisibility({ ...makeRoot(folderA, "docs"), quartoIgnored: true }), false);
		});

		test("hides an embedded project that has a source", () => {
			const embedded = {
				...makeRoot(folderA, "docs"),
				embeddedIn: { id: { name: "ext" }, source: "owner/ext" },
			} as ReturnType<typeof makeRoot>;
			assert.strictEqual(defaultVisibility(embedded), false);
		});

		test("shows an embedded project without a source", () => {
			const embedded = {
				...makeRoot(folderA, "docs"),
				embeddedIn: { id: { name: "ext" } },
			} as ReturnType<typeof makeRoot>;
			assert.strictEqual(defaultVisibility(embedded), true);
		});

		test("shows a plain project", () => {
			assert.strictEqual(defaultVisibility(makeRoot(folderA, "docs")), true);
		});
	});

	suite("resolveVisibility", () => {
		const hiddenByDefault = { ...makeRoot(folderA, "docs"), quartoIgnored: true };

		test("an override beats the setting", () => {
			assert.strictEqual(
				resolveVisibility(hiddenByDefault, { docs: false }, { [visibilityKey(hiddenByDefault)]: true }),
				true,
			);
		});

		test("the setting beats the default", () => {
			assert.strictEqual(resolveVisibility(hiddenByDefault, { docs: true }, {}), true);
			assert.strictEqual(resolveVisibility(makeRoot(folderA, "docs"), { docs: false }, {}), false);
		});

		test("the default applies without an override or setting", () => {
			assert.strictEqual(resolveVisibility(hiddenByDefault, {}, {}), false);
		});
	});

	test("keys differ for the same relative path in two workspace folders", () => {
		assert.notStrictEqual(visibilityKey(makeRoot(folderA, "docs")), visibilityKey(makeRoot(folderB, "docs")));
	});

	suite("ProjectVisibility", () => {
		let originalGetConfiguration: typeof vscode.workspace.getConfiguration;
		let stored: Record<string, boolean> | undefined;
		let updates: { value: unknown; target: unknown }[];
		let store: ProjectVisibility;

		setup(() => {
			stored = undefined;
			updates = [];
			originalGetConfiguration = vscode.workspace.getConfiguration;
			vscode.workspace.getConfiguration = ((section?: string, scope?: vscode.ConfigurationScope) => {
				if (section !== "quartoWizard") {
					return originalGetConfiguration(section, scope);
				}
				return {
					get: (key: string) => (key === "projectVisibility" ? stored : undefined),
					update: async (_key: string, value: unknown, target: unknown) => {
						updates.push({ value, target });
						stored = value as Record<string, boolean>;
					},
				};
			}) as typeof vscode.workspace.getConfiguration;
			store = new ProjectVisibility(new FakeMemento());
		});

		teardown(() => {
			store.dispose();
			vscode.workspace.getConfiguration = originalGetConfiguration;
		});

		test("setVisible fires onDidChange once", async () => {
			let fired = 0;
			store.onDidChange(() => fired++);
			const roots = [makeRoot(folderA, "docs"), makeRoot(folderA, "site")];
			await store.setVisible(roots, false);
			assert.strictEqual(fired, 1);
			assert.strictEqual(store.isVisible(roots[0]), false);
			assert.strictEqual(store.isVisible(roots[1]), false);
		});

		test("saveToWorkspaceSettings writes POSIX relative paths", async () => {
			const nested = makeRoot(folderA, "docs", "sub");
			assert.strictEqual(nested.fsPath, path.join(folderA.uri.fsPath, "docs", "sub"));
			await store.setVisible([nested], false);
			await store.saveToWorkspaceSettings([nested, makeRoot(folderA)]);
			assert.deepStrictEqual(stored, { "docs/sub": false });
			assert.strictEqual(updates[0].target, vscode.ConfigurationTarget.WorkspaceFolder);
		});

		test("saveToWorkspaceSettings leaves out a root that keeps its default", async () => {
			const ignored = { ...makeRoot(folderA, "notes"), quartoIgnored: true };
			const shownIgnored = { ...makeRoot(folderA, "kept"), quartoIgnored: true };
			await store.setVisible([shownIgnored], true);
			await store.saveToWorkspaceSettings([ignored, shownIgnored]);
			assert.deepStrictEqual(stored, { kept: true });
		});

		test("saveToWorkspaceSettings clears the overrides it saved", async () => {
			const docs = makeRoot(folderA, "docs");
			await store.setVisible([docs], false);
			await store.saveToWorkspaceSettings([docs]);
			stored = { docs: true };
			assert.strictEqual(store.isVisible(docs), true);
		});

		test("stale keys are ignored and dropped on save", async () => {
			stored = { gone: false, docs: false };
			const docs = makeRoot(folderA, "docs");
			assert.strictEqual(store.isVisible(docs), false);
			assert.strictEqual(store.isVisible(makeRoot(folderA, "site")), true);
			await store.saveToWorkspaceSettings([docs]);
			assert.deepStrictEqual(stored, { docs: false });
		});
	});
});
