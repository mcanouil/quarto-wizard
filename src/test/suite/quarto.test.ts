import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { ZipArchive } from "archiver";
import { readSourceRecord } from "@quarto-wizard/core";
import { QW_LOG } from "../../constants";
import {
	configuredInstallTrack,
	installQuartoExtension,
	removeQuartoExtension,
	useQuartoExtension,
	type InstallOutcome,
} from "../../utils/coreOperations";

suite("Quarto Utils Test Suite", () => {
	let testWorkspaceDir: string;

	// Store original methods for restoration
	let originalExecuteCommand: typeof vscode.commands.executeCommand;

	setup(() => {
		// Create temporary test directory
		testWorkspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "quarto-wizard-test-"));

		// Store original methods
		originalExecuteCommand = vscode.commands.executeCommand;

		vscode.commands.executeCommand = async <T>(): Promise<T> => {
			// Mock implementation
			return Promise.resolve() as Promise<T>;
		};
	});

	teardown(() => {
		// Restore original methods
		vscode.commands.executeCommand = originalExecuteCommand;

		// Clean up test directory
		if (fs.existsSync(testWorkspaceDir)) {
			fs.rmSync(testWorkspaceDir, { recursive: true, force: true });
		}
	});

	suite("configuredInstallTrack", () => {
		let originalGetConfiguration: typeof vscode.workspace.getConfiguration;
		let configured: string | undefined;

		setup(() => {
			originalGetConfiguration = vscode.workspace.getConfiguration;
			configured = undefined;
			Object.defineProperty(vscode.workspace, "getConfiguration", {
				value: (section?: string) => ({
					get: (key: string) => (section === "quartoWizard.install" && key === "updateSource" ? configured : undefined),
				}),
				writable: true,
				configurable: true,
			});
		});

		teardown(() => {
			Object.defineProperty(vscode.workspace, "getConfiguration", {
				value: originalGetConfiguration,
				writable: true,
				configurable: true,
			});
		});

		test("maps latestTag to tag", () => {
			configured = "latestTag";
			assert.strictEqual(configuredInstallTrack(testWorkspaceDir), "tag");
		});

		test("maps defaultBranch to branch", () => {
			configured = "defaultBranch";
			assert.strictEqual(configuredInstallTrack(testWorkspaceDir), "branch");
		});

		test("reads an unset or unknown value as tag", () => {
			assert.strictEqual(configuredInstallTrack(testWorkspaceDir), "tag");
			configured = "somethingElse";
			assert.strictEqual(configuredInstallTrack(testWorkspaceDir), "tag");
		});
	});

	suite("installQuartoExtension", () => {
		test("should return false when workspaceFolder is empty", async () => {
			// The function should properly resolve with false when workspaceFolder is empty
			const result = await installQuartoExtension("test-extension", "");
			assert.strictEqual(result, false);
		});

		test("should refuse force without expectedExtensionId", async () => {
			await assert.rejects(
				installQuartoExtension("acme/demo", testWorkspaceDir, { force: true }),
				/force option needs the expectedExtensionId option/,
			);
		});

		test("should attempt installation with valid parameters", async () => {
			const extensionName = "test-extension";

			// This will attempt to run the actual installation
			// Since we don't have a real extension in tests,
			// we expect this to fail, but we can verify the function executes
			const result = await installQuartoExtension(extensionName, testWorkspaceDir);

			assert.strictEqual(typeof result, "boolean");
		});

		suite("against a stubbed repository", () => {
			const ARCHIVE_URL = "https://api.github.com/repos/acme/demo/zipball/v1.0.0";
			let originalFetch: typeof globalThis.fetch;
			let originalShowWarningMessage: typeof vscode.window.showWarningMessage;
			let source: vscode.CancellationTokenSource;
			let archiveRequests: (AbortSignal | null | undefined)[];
			let onArchiveRequest: () => void;
			let archiveBody: Buffer | undefined;
			let requireAuth: boolean;
			let originalShowErrorMessage: typeof vscode.window.showErrorMessage;
			let originalGetSession: typeof vscode.authentication.getSession;

			function json(body: unknown): Response {
				return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
			}

			async function buildArchive(names: readonly string[] = ["demo"], version = "1.0.0"): Promise<Buffer> {
				const archiveDir = fs.mkdtempSync(path.join(os.tmpdir(), "quarto-wizard-archive-"));
				try {
					for (const name of names) {
						const extensionDir = path.join(archiveDir, "demo-1.0.0", "_extensions", "acme", name);
						fs.mkdirSync(extensionDir, { recursive: true });
						fs.writeFileSync(
							path.join(extensionDir, "_extension.yml"),
							`title: ${name}\nauthor: Acme\nversion: ${version}\ncontributes: {}\n`,
						);
					}
					const zipPath = path.join(archiveDir, "demo.zip");
					await new Promise<void>((resolve, reject) => {
						const output = fs.createWriteStream(zipPath);
						const archive = new ZipArchive();
						output.on("close", () => resolve());
						archive.on("error", reject);
						archive.pipe(output);
						archive.directory(path.join(archiveDir, "demo-1.0.0"), "demo-1.0.0");
						void archive.finalize();
					});
					return fs.readFileSync(zipPath);
				} finally {
					fs.rmSync(archiveDir, { recursive: true, force: true });
				}
			}

			setup(() => {
				source = new vscode.CancellationTokenSource();
				archiveRequests = [];
				onArchiveRequest = () => undefined;
				archiveBody = undefined;
				requireAuth = false;
				originalShowErrorMessage = vscode.window.showErrorMessage;
				originalGetSession = vscode.authentication.getSession;
				originalFetch = globalThis.fetch;
				originalShowWarningMessage = vscode.window.showWarningMessage;

				globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
					const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
					if (url.startsWith("https://api.github.com/repos/acme/demo/releases")) {
						const headers = new Headers(init?.headers);
						if (requireAuth && !headers.has("Authorization")) {
							return new Response(JSON.stringify({ message: "Requires authentication" }), { status: 401 });
						}
						return json([
							{
								tag_name: "v1.0.0",
								name: "v1.0.0",
								zipball_url: ARCHIVE_URL,
								tarball_url: "https://api.github.com/repos/acme/demo/tarball/v1.0.0",
								html_url: "https://github.com/acme/demo/releases/tag/v1.0.0",
								published_at: "2026-01-01T00:00:00Z",
								prerelease: false,
								draft: false,
							},
						]);
					}
					if (url.startsWith("https://api.github.com/repos/acme/demo/tags")) {
						return json([]);
					}
					if (url === ARCHIVE_URL) {
						archiveRequests.push(init?.signal);
						onArchiveRequest();
						if (archiveBody) {
							return new Response(new Uint8Array(archiveBody), { status: 200 });
						}
						return new Promise<Response>((_resolve, reject) => {
							init?.signal?.addEventListener("abort", () =>
								reject(new DOMException("The operation was aborted.", "AbortError")),
							);
						});
					}
					return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
				}) as typeof globalThis.fetch;
			});

			teardown(() => {
				globalThis.fetch = originalFetch;
				vscode.window.showWarningMessage = originalShowWarningMessage;
				vscode.window.showErrorMessage = originalShowErrorMessage;
				(vscode.authentication as { getSession: unknown }).getSession = originalGetSession;
				source.dispose();
			});

			test("a cancel during the download aborts it and returns null", async () => {
				const downloadStarted = new Promise<void>((resolve) => {
					onArchiveRequest = resolve;
				});

				const pending = installQuartoExtension("acme/demo", testWorkspaceDir, { cancellationToken: source.token });
				await downloadStarted;
				source.cancel();

				assert.strictEqual(await pending, null);
				assert.strictEqual(archiveRequests.length, 1);
				assert.strictEqual(archiveRequests[0]?.aborted, true);
			});

			test("a cancel on an already-cancelled token returns null without a download", async () => {
				source.cancel();

				const result = await installQuartoExtension("acme/demo", testWorkspaceDir, {
					cancellationToken: source.token,
				});

				assert.strictEqual(result, null);
				assert.strictEqual(archiveRequests.length, 0);
			});

			function signInOnDemand(onSignIn: () => void): void {
				(vscode.window as { showErrorMessage: unknown }).showErrorMessage = async () => "Sign In";
				(vscode.authentication as { getSession: unknown }).getSession = async () => {
					onSignIn();
					return { accessToken: "token" } as vscode.AuthenticationSession;
				};
			}

			test("a cancel after sign-in returns null without a retry", async () => {
				requireAuth = true;
				signInOnDemand(() => source.cancel());

				const result = await installQuartoExtension("acme/demo", testWorkspaceDir, {
					cancellationToken: source.token,
				});

				assert.strictEqual(result, null);
				assert.strictEqual(archiveRequests.length, 0);
			});

			test("a cancel while the sign-in prompt is dismissed returns null", async () => {
				requireAuth = true;
				(vscode.window as { showErrorMessage: unknown }).showErrorMessage = async () => {
					source.cancel();
					return undefined;
				};

				const result = await installQuartoExtension("acme/demo", testWorkspaceDir, {
					cancellationToken: source.token,
				});

				assert.strictEqual(result, null);
				assert.strictEqual(archiveRequests.length, 0);
			});

			test("a cancel during the retry after sign-in returns null", async () => {
				requireAuth = true;
				signInOnDemand(() => undefined);
				const downloadStarted = new Promise<void>((resolve) => {
					onArchiveRequest = resolve;
				});

				const pending = installQuartoExtension("acme/demo", testWorkspaceDir, { cancellationToken: source.token });
				await downloadStarted;
				source.cancel();

				assert.strictEqual(await pending, null);
				assert.strictEqual(archiveRequests[0]?.aborted, true);
			});

			test("a cancel during the overwrite prompt returns null", async () => {
				archiveBody = await buildArchive();
				const installedDir = path.join(testWorkspaceDir, "_extensions", "acme", "demo");
				fs.mkdirSync(installedDir, { recursive: true });
				fs.writeFileSync(path.join(installedDir, "_extension.yml"), "title: Old\nauthor: Acme\nversion: 0.9.0\n");
				(vscode.window as { showWarningMessage: unknown }).showWarningMessage = async () => {
					source.cancel();
					return undefined;
				};

				const result = await installQuartoExtension("acme/demo", testWorkspaceDir, {
					cancellationToken: source.token,
				});

				assert.strictEqual(result, null);
				assert.match(fs.readFileSync(path.join(installedDir, "_extension.yml"), "utf8"), /Old/);
			});

			suite("an installed copy", () => {
				const MANIFEST_NAME = "_extension.yml";
				let installedDir: string;
				let warnings: string[];
				let infos: string[];
				let warningChoice: string | undefined;
				let originalShowInformationMessage: typeof vscode.window.showInformationMessage;

				setup(() => {
					installedDir = path.join(testWorkspaceDir, "_extensions", "acme", "demo");
					warnings = [];
					infos = [];
					warningChoice = undefined;
					originalShowInformationMessage = vscode.window.showInformationMessage;
					(vscode.window as { showWarningMessage: unknown }).showWarningMessage = async (message: string) => {
						warnings.push(message);
						return warningChoice;
					};
					(vscode.window as { showInformationMessage: unknown }).showInformationMessage = async (message: string) => {
						infos.push(message);
						return undefined;
					};
				});

				teardown(() => {
					(vscode.window as { showInformationMessage: unknown }).showInformationMessage =
						originalShowInformationMessage;
				});

				async function installThenEdit(): Promise<void> {
					archiveBody = await buildArchive(["demo"], "1.0.0");
					assert.strictEqual(await installQuartoExtension("acme/demo", testWorkspaceDir), true);
					fs.appendFileSync(path.join(installedDir, MANIFEST_NAME), "# local edit\n");
				}

				test("with local changes shows the warning and Replace anyway forces the replacement", async () => {
					await installThenEdit();
					archiveBody = await buildArchive(["demo"], "1.1.0");
					warningChoice = "Replace anyway";

					const result = await installQuartoExtension("acme/demo", testWorkspaceDir);

					assert.strictEqual(result, true);
					assert.deepStrictEqual(warnings, [
						"acme/demo has local changes that a reinstall would remove: _extension.yml (modified).",
					]);
					const manifest = fs.readFileSync(path.join(installedDir, MANIFEST_NAME), "utf8");
					assert.match(manifest, /version: 1\.1\.0/);
					assert.doesNotMatch(manifest, /local edit/);
				});

				for (const [name, choice] of [
					["Cancel", "Cancel"],
					["a dismissed dialog", undefined],
				] as const) {
					test(`with local changes is left untouched on ${name}`, async () => {
						await installThenEdit();
						archiveBody = await buildArchive(["demo"], "1.1.0");
						warningChoice = choice;

						const result = await installQuartoExtension("acme/demo", testWorkspaceDir);

						assert.strictEqual(result, null);
						assert.strictEqual(warnings.length, 1);
						const manifest = fs.readFileSync(path.join(installedDir, MANIFEST_NAME), "utf8");
						assert.match(manifest, /version: 1\.0\.0/);
						assert.match(manifest, /local edit/);
					});
				}

				test("a plain install follows the latest tag by default", async () => {
					archiveBody = await buildArchive(["demo"], "1.0.0");

					assert.strictEqual(await installQuartoExtension("acme/demo", testWorkspaceDir), true);

					const read = readSourceRecord(installedDir);
					assert.strictEqual(read.status, "ok");
					assert.strictEqual(read.status === "ok" && read.record.quartoWizard?.track, "tag");
				});

				test("a change of update source with local changes shows Replace anyway and Cancel writes nothing", async () => {
					await installThenEdit();
					const before = readSourceRecord(installedDir);
					const manifestBefore = fs.readFileSync(path.join(installedDir, MANIFEST_NAME), "utf8");
					archiveBody = await buildArchive(["demo"], "1.0.0");
					warningChoice = "Cancel";

					const result = await installQuartoExtension("acme/demo@v1.0.0", testWorkspaceDir, {
						skipOverwritePrompt: true,
						expectedExtensionId: { owner: "acme", name: "demo" },
						replaceSameVersion: true,
						recordSource: "acme/demo",
						track: "branch",
					});

					assert.strictEqual(result, null);
					assert.deepStrictEqual(warnings, [
						"acme/demo has local changes that a reinstall would remove: _extension.yml (modified).",
					]);
					assert.deepStrictEqual(readSourceRecord(installedDir), before);
					assert.strictEqual(fs.readFileSync(path.join(installedDir, MANIFEST_NAME), "utf8"), manifestBefore);
				});

				test("with local changes lists at most ten files and counts the rest", async () => {
					await installThenEdit();
					for (let index = 1; index <= 12; index++) {
						fs.writeFileSync(path.join(installedDir, `extra-${String(index).padStart(2, "0")}.txt`), "x");
					}
					archiveBody = await buildArchive(["demo"], "1.1.0");

					await installQuartoExtension("acme/demo", testWorkspaceDir);

					assert.strictEqual(warnings.length, 1);
					const listed = warnings[0].replace(/^.*remove: /, "");
					assert.match(listed, / and 3 more\.$/);
					assert.strictEqual(listed.split(" (").length - 1, 10);
				});

				test("with local changes is skipped in skip mode without a dialog", async () => {
					await installThenEdit();
					archiveBody = await buildArchive(["demo"], "1.1.0");
					const outcome: InstallOutcome = {};

					const result = await installQuartoExtension("acme/demo", testWorkspaceDir, { localEdits: "skip", outcome });

					assert.strictEqual(result, null);
					assert.deepStrictEqual(warnings, []);
					assert.deepStrictEqual(outcome.localEdits?.edits, [{ path: MANIFEST_NAME, change: "modified" }]);
					assert.match(fs.readFileSync(path.join(installedDir, MANIFEST_NAME), "utf8"), /local edit/);
				});

				test("with local changes in several selected extensions lists every one of them", async () => {
					archiveBody = await buildArchive(["demo", "other"], "1.0.0");
					const originalShowQuickPick = vscode.window.showQuickPick;
					(vscode.window as { showQuickPick: unknown }).showQuickPick = async (items: unknown[]) => items;
					try {
						assert.strictEqual(await installQuartoExtension("acme/demo", testWorkspaceDir), true);
						const otherDir = path.join(testWorkspaceDir, "_extensions", "acme", "other");
						fs.appendFileSync(path.join(installedDir, MANIFEST_NAME), "# local edit\n");
						fs.appendFileSync(path.join(otherDir, MANIFEST_NAME), "# local edit\n");
						archiveBody = await buildArchive(["demo", "other"], "1.1.0");
						warningChoice = "Cancel";

						const result = await installQuartoExtension("acme/demo", testWorkspaceDir);

						assert.strictEqual(result, null);
						assert.deepStrictEqual(warnings, [
							"acme/demo, acme/other have local changes that a reinstall would remove: acme/demo: _extension.yml (modified); acme/other: _extension.yml (modified).",
						]);
					} finally {
						(vscode.window as { showQuickPick: unknown }).showQuickPick = originalShowQuickPick;
					}
				});

				test("forced at the same version rewrites a clean copy without a warning", async () => {
					archiveBody = await buildArchive(["demo"], "1.0.0");
					assert.strictEqual(await installQuartoExtension("acme/demo", testWorkspaceDir), true);
					const manifestPath = path.join(installedDir, MANIFEST_NAME);
					const old = new Date(2000, 0, 1);
					fs.utimesSync(manifestPath, old, old);

					const result = await installQuartoExtension("acme/demo", testWorkspaceDir, {
						force: true,
						expectedExtensionId: { owner: "acme", name: "demo" },
					});

					assert.strictEqual(result, true);
					assert.deepStrictEqual(warnings, []);
					assert.ok(fs.statSync(manifestPath).mtime.getTime() > old.getTime());
				});

				test("forced at the same version resets an edited copy after Replace anyway", async () => {
					await installThenEdit();
					warningChoice = "Replace anyway";

					const result = await installQuartoExtension("acme/demo", testWorkspaceDir, {
						force: true,
						expectedExtensionId: { owner: "acme", name: "demo" },
					});

					assert.strictEqual(result, true);
					assert.deepStrictEqual(warnings, [
						"acme/demo has local changes that a reinstall would remove: _extension.yml (modified).",
					]);
					assert.doesNotMatch(fs.readFileSync(path.join(installedDir, MANIFEST_NAME), "utf8"), /local edit/);
				});

				test("forced at the same version leaves an edited copy as it is on Cancel", async () => {
					await installThenEdit();
					warningChoice = "Cancel";

					const result = await installQuartoExtension("acme/demo", testWorkspaceDir, {
						force: true,
						expectedExtensionId: { owner: "acme", name: "demo" },
					});

					assert.strictEqual(result, null);
					assert.strictEqual(warnings.length, 1);
					assert.match(fs.readFileSync(path.join(installedDir, MANIFEST_NAME), "utf8"), /local edit/);
				});

				test("replaced at the same version rewrites a clean copy without a message", async () => {
					archiveBody = await buildArchive(["demo"], "1.0.0");
					assert.strictEqual(await installQuartoExtension("acme/demo", testWorkspaceDir), true);
					const manifestPath = path.join(installedDir, MANIFEST_NAME);
					const old = new Date(2000, 0, 1);
					fs.utimesSync(manifestPath, old, old);
					infos = [];

					const result = await installQuartoExtension("acme/demo", testWorkspaceDir, {
						replaceSameVersion: true,
						skipOverwritePrompt: true,
						expectedExtensionId: { owner: "acme", name: "demo" },
					});

					assert.strictEqual(result, true);
					assert.deepStrictEqual(infos, []);
					assert.deepStrictEqual(warnings, []);
					assert.ok(fs.statSync(manifestPath).mtime.getTime() > old.getTime());
				});

				test("replaced at the same version still skips an edited copy", async () => {
					await installThenEdit();
					const outcome: InstallOutcome = {};

					const result = await installQuartoExtension("acme/demo", testWorkspaceDir, {
						replaceSameVersion: true,
						expectedExtensionId: { owner: "acme", name: "demo" },
						localEdits: "skip",
						outcome,
					});

					assert.strictEqual(result, null);
					assert.deepStrictEqual(outcome.localEdits?.edits, [{ path: MANIFEST_NAME, change: "modified" }]);
					assert.match(fs.readFileSync(path.join(installedDir, MANIFEST_NAME), "utf8"), /local edit/);
				});

				test("at the same version with an additional install refreshes the tree and reports it", async () => {
					archiveBody = await buildArchive(["demo", "other"], "1.0.0");
					assert.strictEqual(
						await installQuartoExtension("acme/demo", testWorkspaceDir, {
							expectedExtensionId: { owner: "acme", name: "demo" },
						}),
						true,
					);
					const commands: string[] = [];
					vscode.commands.executeCommand = async <T>(command: string): Promise<T> => {
						commands.push(command);
						return undefined as T;
					};
					const logged: string[] = [];
					const originalInfo = QW_LOG.info;
					QW_LOG.info = (message: string) => {
						logged.push(message);
					};
					const originalShowQuickPick = vscode.window.showQuickPick;
					(vscode.window as { showQuickPick: unknown }).showQuickPick = async (items: unknown[]) => items;
					infos = [];
					try {
						const result = await installQuartoExtension("acme/demo", testWorkspaceDir);

						assert.strictEqual(result, true);
						assert.ok(fs.existsSync(path.join(testWorkspaceDir, "_extensions", "acme", "other", MANIFEST_NAME)));
						assert.deepStrictEqual(commands, ["quartoWizard.extensionsInstalled.refresh"]);
						assert.deepStrictEqual(infos, ["acme/demo is already at version 1.0.0."]);
						assert.ok(
							logged.includes("[acme/demo] Also installed 1 additional extension: acme/other."),
							logged.join("\n"),
						);
					} finally {
						QW_LOG.info = originalInfo;
						(vscode.window as { showQuickPick: unknown }).showQuickPick = originalShowQuickPick;
					}
				});

				suite("used as a template", () => {
					let fileSelections: number;

					function useTemplate(): Promise<unknown> {
						return useQuartoExtension("acme/demo", testWorkspaceDir, {
							selectFiles: async () => {
								fileSelections++;
								return { selectedFiles: [], overwriteExisting: false };
							},
						});
					}

					setup(() => {
						fileSelections = 0;
						(vscode.window as { showWarningMessage: unknown }).showWarningMessage = async (message: string) => {
							warnings.push(message);
							return message.includes("already exists") ? "Overwrite" : warningChoice;
						};
					});

					test("with local changes shows the warning and Replace anyway forces the replacement", async () => {
						await installThenEdit();
						archiveBody = await buildArchive(["demo"], "1.1.0");
						warningChoice = "Replace anyway";

						const result = await useTemplate();

						assert.notStrictEqual(result, null);
						assert.deepStrictEqual(warnings, [
							'Extension "acme/demo" already exists. Overwrite?',
							"acme/demo has local changes that a reinstall would remove: _extension.yml (modified).",
						]);
						assert.strictEqual(fileSelections, 1);
						const manifest = fs.readFileSync(path.join(installedDir, MANIFEST_NAME), "utf8");
						assert.match(manifest, /version: 1\.1\.0/);
						assert.doesNotMatch(manifest, /local edit/);
					});

					test("with local changes is left untouched on Cancel", async () => {
						await installThenEdit();
						archiveBody = await buildArchive(["demo"], "1.1.0");
						warningChoice = "Cancel";

						const result = await useTemplate();

						assert.strictEqual(result, null);
						assert.strictEqual(warnings.length, 2);
						const manifest = fs.readFileSync(path.join(installedDir, MANIFEST_NAME), "utf8");
						assert.match(manifest, /version: 1\.0\.0/);
						assert.match(manifest, /local edit/);
					});
				});

				test("a replaced copy without an install record is announced", async () => {
					archiveBody = await buildArchive(["demo"], "1.1.0");
					fs.mkdirSync(installedDir, { recursive: true });
					fs.writeFileSync(path.join(installedDir, MANIFEST_NAME), "title: Old\nauthor: Acme\nversion: 1.0.0\n");
					warningChoice = "Overwrite";

					const result = await installQuartoExtension("acme/demo", testWorkspaceDir);

					assert.strictEqual(result, true);
					assert.deepStrictEqual(infos, [
						"acme/demo had no install record, so Quarto Wizard could not check it for local changes.",
					]);
				});

				test("at the same version shows the already-at-version message and writes nothing", async () => {
					await installThenEdit();

					const result = await installQuartoExtension("acme/demo", testWorkspaceDir);

					assert.strictEqual(result, true);
					assert.deepStrictEqual(infos, ["acme/demo is already at version 1.0.0."]);
					assert.deepStrictEqual(warnings, []);
					assert.match(fs.readFileSync(path.join(installedDir, MANIFEST_NAME), "utf8"), /local edit/);
				});
			});

			test("a local source with a relative path resolves against the project folder", async () => {
				const sourceDir = path.join(testWorkspaceDir, "ext-source", "_extensions", "acme", "local-demo");
				fs.mkdirSync(sourceDir, { recursive: true });
				fs.writeFileSync(
					path.join(sourceDir, "_extension.yml"),
					"title: Local\nauthor: Acme\nversion: 1.0.0\ncontributes: {}\n",
				);

				const result = await installQuartoExtension("./ext-source", testWorkspaceDir, { sourceType: "local" });

				assert.strictEqual(result, true);
				assert.ok(fs.existsSync(path.join(testWorkspaceDir, "_extensions", "acme", "local-demo", "_extension.yml")));
				const record = fs.readFileSync(
					path.join(testWorkspaceDir, "_extensions", "acme", "local-demo", ".quarto-source.yml"),
					"utf8",
				);
				assert.match(record, /\.\/ext-source/);
			});

			test("a record source replaces the installed source in the install record", async () => {
				archiveBody = await buildArchive(["demo"], "1.0.0");

				const result = await installQuartoExtension("acme/demo@v1.0.0", testWorkspaceDir, {
					recordSource: "acme/demo",
				});

				assert.strictEqual(result, true);
				const record = fs.readFileSync(
					path.join(testWorkspaceDir, "_extensions", "acme", "demo", ".quarto-source.yml"),
					"utf8",
				);
				assert.match(record, /^source: acme\/demo$/m);
				assert.doesNotMatch(record, /^ref:/m);
			});

			test("an expected extension installs only that extension without a quick pick", async () => {
				archiveBody = await buildArchive(["demo", "other"]);
				const originalShowQuickPick = vscode.window.showQuickPick;
				let quickPicks = 0;
				(vscode.window as { showQuickPick: unknown }).showQuickPick = async () => {
					quickPicks++;
					return undefined;
				};
				try {
					const result = await installQuartoExtension("acme/demo", testWorkspaceDir, {
						expectedExtensionId: { owner: "acme", name: "other" },
					});

					assert.strictEqual(result, true);
					assert.strictEqual(quickPicks, 0);
					assert.ok(fs.existsSync(path.join(testWorkspaceDir, "_extensions", "acme", "other", "_extension.yml")));
					assert.ok(!fs.existsSync(path.join(testWorkspaceDir, "_extensions", "acme", "demo")));
				} finally {
					(vscode.window as { showQuickPick: unknown }).showQuickPick = originalShowQuickPick;
				}
			});
		});
	});

	suite("removeQuartoExtension", () => {
		test("should return false when workspaceFolder is empty", async () => {
			const result = await removeQuartoExtension("test-extension", "");

			assert.strictEqual(result, false);
		});

		test("should attempt to remove extension from valid workspace", async () => {
			const extensionName = "test-extension";

			const result = await removeQuartoExtension(extensionName, testWorkspaceDir);

			// Should return a boolean (the actual result depends on the remove implementation)
			assert.strictEqual(typeof result, "boolean");
		});

		test("should handle non-existent extension gracefully", async () => {
			const extensionName = "non-existent-extension";

			// This should not throw an error
			const result = await removeQuartoExtension(extensionName, testWorkspaceDir);

			assert.strictEqual(typeof result, "boolean");
		});
	});
});
