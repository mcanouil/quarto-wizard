import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { ZipArchive } from "archiver";
import { installQuartoExtension, removeQuartoExtension } from "../../utils/coreOperations";

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

	suite("installQuartoExtension", () => {
		test("should return false when workspaceFolder is empty", async () => {
			// The function should properly resolve with false when workspaceFolder is empty
			const result = await installQuartoExtension("test-extension", "");
			assert.strictEqual(result, false);
		});

		test("should attempt installation with valid parameters", async () => {
			const extensionName = "test-extension";

			// This will attempt to run the actual installation
			// Since we don't have a real extension in tests,
			// we expect this to fail, but we can verify the function executes
			const result = await installQuartoExtension(extensionName, testWorkspaceDir);

			assert.strictEqual(typeof result, "boolean");
		});

		suite("cancellation", () => {
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

			async function buildArchive(): Promise<Buffer> {
				const archiveDir = fs.mkdtempSync(path.join(os.tmpdir(), "quarto-wizard-archive-"));
				try {
					const extensionDir = path.join(archiveDir, "demo-1.0.0", "_extensions", "acme", "demo");
					fs.mkdirSync(extensionDir, { recursive: true });
					fs.writeFileSync(
						path.join(extensionDir, "_extension.yml"),
						"title: Demo\nauthor: Acme\nversion: 1.0.0\ncontributes: {}\n",
					);
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
