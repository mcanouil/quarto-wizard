import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	typstBinaryCandidate,
	probeTypstBinary,
	TypstCompiler,
	TypstCompileFailure,
	type TypstProbe,
} from "../../providers/typstPreview/typstCompiler";
import type { TypstCommand } from "../../utils/typst/typstCli";

const BIN = path.join("/opt", "quarto", "bin");

/**
 * A stand-in for the compiler binary.
 *
 * The lifecycle of `compile` is about processes and not about Typst, so these
 * tests drive it with this runtime instead. Continuous integration has no Quarto
 * and therefore no Typst, so a test that needed the real binary could never run
 * there, and this is the code most worth covering in the whole slice.
 */
const RUNTIME = process.execPath;

/** A command that runs one expression in a child process. */
function run(source: string): TypstCommand {
	return { argv: ["-e", source] };
}

/** A token that is already cancelled. */
function cancelled(): vscode.CancellationToken {
	const source = new vscode.CancellationTokenSource();
	source.cancel();
	return source.token;
}

const never = new vscode.CancellationTokenSource().token;

/**
 * A probe whose only real input is the set of paths that exist.
 *
 * Resolution is pure apart from the two calls injected here, so a test can
 * describe a whole platform in one object.
 */
function probe(overrides: Partial<TypstProbe> & { present?: string[] } = {}): TypstProbe {
	const present = new Set(overrides.present ?? []);
	return {
		binPath: overrides.binPath ?? (async () => BIN),
		exists: overrides.exists ?? ((candidate: string) => present.has(candidate)),
		platform: overrides.platform ?? "darwin",
		arch: overrides.arch ?? "arm64",
	};
}

suite("Typst Compiler Test Suite", () => {
	suite("typstBinaryCandidate", () => {
		test("Should map arm64 to aarch64", () => {
			assert.strictEqual(typstBinaryCandidate(BIN, "darwin", "arm64"), path.join(BIN, "tools", "aarch64", "typst"));
		});

		test("Should map every other architecture to x86_64", () => {
			assert.strictEqual(typstBinaryCandidate(BIN, "linux", "x64"), path.join(BIN, "tools", "x86_64", "typst"));
		});

		test("Should use the architecture directory on Windows as well", () => {
			// Typst is not pandoc. Quarto resolves pandoc flat on Windows, and Typst
			// through the architecture directory on every platform, at
			// `src/core/typst.ts:20`. The packaging step writes it there too.
			assert.strictEqual(typstBinaryCandidate(BIN, "win32", "x64"), path.join(BIN, "tools", "x86_64", "typst.exe"));
		});
	});

	suite("probeTypstBinary", () => {
		test("Should return the candidate when it is present", async () => {
			const candidate = path.join(BIN, "tools", "aarch64", "typst");
			assert.strictEqual(await probeTypstBinary(probe({ present: [candidate] })), candidate);
		});

		test("Should return undefined when Quarto is unavailable", async () => {
			// No Quarto extension, no API, or an API that reports unavailable. The
			// feature is inert, and reading it must not throw.
			const found = await probeTypstBinary(probe({ binPath: async () => undefined, present: [] }));
			assert.strictEqual(found, undefined);
		});

		test("Should probe exactly one path, and give up when it is absent", async () => {
			// There is no fallback route, so a layout Quarto does not produce leaves
			// the feature inert rather than reaching for a binary somewhere else.
			const attempted: string[] = [];
			const found = await probeTypstBinary(
				probe({
					exists: (candidate: string) => {
						attempted.push(candidate);
						return false;
					},
				}),
			);
			assert.strictEqual(found, undefined);
			assert.deepStrictEqual(attempted, [path.join(BIN, "tools", "aarch64", "typst")]);
		});
	});

	suite("TypstCompiler.compile", () => {
		test("Should resolve with the output of a run that produced one", async () => {
			const compiler = new TypstCompiler(RUNTIME);
			try {
				const result = await compiler.compile("", run("process.stdout.write('<svg/>')"), never);
				assert.strictEqual(result.svg, "<svg/>");
				assert.strictEqual(result.stderr, "");
			} finally {
				compiler.dispose();
			}
		});

		test("Should resolve without an image when the run failed", async () => {
			// A failed compile is a result the caller renders, not an exception.
			const compiler = new TypstCompiler(RUNTIME);
			try {
				const result = await compiler.compile("", run("process.stderr.write('error: no'); process.exit(1)"), never);
				assert.strictEqual(result.svg, undefined);
				assert.strictEqual(result.stderr, "error: no");
			} finally {
				compiler.dispose();
			}
		});

		test("Should write the source to standard input", async () => {
			const compiler = new TypstCompiler(RUNTIME);
			try {
				const result = await compiler.compile(
					"the source",
					run("process.stdin.on('data', (d) => process.stdout.write(d))"),
					never,
				);
				assert.strictEqual(result.svg, "the source");
			} finally {
				compiler.dispose();
			}
		});

		test("Should run from the directory the caller names", async () => {
			// A relative `--font-path` is left relative by the filter, so it resolves
			// against the directory the compile runs from. The preview has to run from
			// the same place a render does, or it reads the fonts of nowhere.
			const directory = fs.realpathSync(os.tmpdir());
			const compiler = new TypstCompiler(RUNTIME);
			try {
				const command = { ...run("process.stdout.write(process.cwd())"), cwd: directory };
				const result = await compiler.compile("", command, never);
				assert.strictEqual(result.svg, directory);
			} finally {
				compiler.dispose();
			}
		});

		test("Should keep a multi-byte character split across two chunks", async () => {
			// Typst writes its position line starting with `┌─`. Decoding each chunk
			// as it arrives would cut that character in half and lose the position.
			const compiler = new TypstCompiler(RUNTIME);
			const halves =
				"const b = Buffer.from('┌─ <stdin>:1:0'); process.stderr.write(b.subarray(0, 2)); setTimeout(() => { process.stderr.write(b.subarray(2)); process.exit(1); }, 20)";
			try {
				const result = await compiler.compile("", run(halves), never);
				assert.strictEqual(result.stderr, "┌─ <stdin>:1:0");
			} finally {
				compiler.dispose();
			}
		});

		test("Should reject when the run outlives the timeout", async () => {
			const compiler = new TypstCompiler(RUNTIME, { timeoutMs: 100 });
			try {
				await assert.rejects(
					compiler.compile("", run("setTimeout(() => {}, 10000)"), never),
					(error: unknown) =>
						error instanceof TypstCompileFailure && /did not finish within 100 ms/.test(String(error)),
				);
			} finally {
				compiler.dispose();
			}
		});

		test("Should reject when the run produces more than the limit", async () => {
			const compiler = new TypstCompiler(RUNTIME, { maxOutputBytes: 64 });
			try {
				await assert.rejects(
					compiler.compile("", run("process.stdout.write('x'.repeat(4096))"), never),
					(error: unknown) => error instanceof TypstCompileFailure && /more than 64 bytes/.test(String(error)),
				);
			} finally {
				compiler.dispose();
			}
		});

		test("Should stop collecting standard error past the limit", async () => {
			// A cap on the image alone is not a cap: a loop that reports once per
			// iteration fills standard error just as fast. The run still finishes,
			// because the diagnostics are not the product and the head carries the
			// first one.
			//
			// The child writes four megabytes. The bound asserted here is the limit
			// plus the one chunk that crosses it, and a chunk is bounded by the pipe,
			// so how the writes happen to arrive cannot decide the outcome. Asserting
			// the limit itself would fail wherever the whole stream lands in a single
			// chunk, which is what the runner does and a developer machine does not.
			const compiler = new TypstCompiler(RUNTIME, { maxOutputBytes: 64 });
			try {
				const result = await compiler.compile(
					"",
					run("for (let i = 0; i < 4096; i++) { process.stderr.write('error: '.repeat(146) + '\\n'); }"),
					never,
				);
				assert.ok(result.stderr.startsWith("error: "), "the head of the output is kept");
				assert.ok(result.stderr.length < 1024 * 1024, `bounded, got ${result.stderr.length}`);
			} finally {
				compiler.dispose();
			}
		});

		test("Should reject the previous run when a second one supersedes it", async () => {
			const compiler = new TypstCompiler(RUNTIME);
			try {
				const first = compiler.compile("", run("setTimeout(() => {}, 10000)"), never);
				const second = compiler.compile("", run("process.stdout.write('<svg/>')"), never);
				await assert.rejects(first, (error: unknown) => error instanceof vscode.CancellationError);
				assert.strictEqual((await second).svg, "<svg/>");
			} finally {
				compiler.dispose();
			}
		});

		test("Should reject when the token is cancelled", async () => {
			const compiler = new TypstCompiler(RUNTIME);
			try {
				await assert.rejects(
					compiler.compile("", run("setTimeout(() => {}, 10000)"), cancelled()),
					(error: unknown) => error instanceof vscode.CancellationError,
				);
			} finally {
				compiler.dispose();
			}
		});

		test("Should reject when the binary is not there", async () => {
			const compiler = new TypstCompiler(path.join(BIN, "tools", "aarch64", "typst"));
			try {
				await assert.rejects(
					compiler.compile("", { argv: [] }, never),
					(error: unknown) => error instanceof TypstCompileFailure && /Failed to start Typst/.test(String(error)),
				);
			} finally {
				compiler.dispose();
			}
		});

		test("Should refuse to compile once disposed", async () => {
			const compiler = new TypstCompiler(RUNTIME);
			compiler.dispose();
			await assert.rejects(
				compiler.compile("", run("process.stdout.write('<svg/>')"), never),
				(error: unknown) => error instanceof TypstCompileFailure && /disposed/.test(String(error)),
			);
		});

		test("Should stop the running child when disposed", async () => {
			const compiler = new TypstCompiler(RUNTIME);
			const running = compiler.compile("", run("setTimeout(() => {}, 10000)"), never);
			compiler.dispose();
			await assert.rejects(running, (error: unknown) => error instanceof vscode.CancellationError);
		});
	});
});
