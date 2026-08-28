import * as vscode from "vscode";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { getQuartoVersionInfo } from "../../services/quartoVersion";
import { logMessage } from "../../utils/log";

/**
 * The two inputs binary resolution reads from the machine.
 *
 * Everything else about resolution is a path calculation, so injecting these
 * two makes the whole route testable without a Quarto installation.
 */
export interface TypstProbe {
	/** The Quarto bin directory, or undefined when Quarto is unavailable. */
	binPath: () => Promise<string | undefined>;
	/** Whether a candidate path is a file on disk. */
	exists: (candidate: string) => boolean;
	platform: NodeJS.Platform;
	arch: string;
}

/**
 * Where Typst sits inside a Quarto installation.
 *
 * `getQuartoPath()` returns the bin directory and not the executable, so no
 * step climbs out of it. Quarto resolves its own Typst as
 * `<bin>/tools/<arch>/typst`, at `src/core/typst.ts:20` through
 * `architectureToolsPath` at `src/core/resources.ts:33`, and its packaging
 * writes the binary to exactly that path, at
 * `package/src/common/dependencies/typst.ts:23`.
 *
 * That holds on every platform, Windows included, which is where Typst differs
 * from pandoc: pandoc is flat on Windows and Typst is not. Windows carries the
 * `.exe` suffix, because the same packaging step names the file `typst.exe`
 * there.
 */
export function typstBinaryCandidate(binPath: string, platform: NodeJS.Platform, arch: string): string {
	const architecture = arch === "arm64" ? "aarch64" : "x86_64";
	return path.join(binPath, "tools", architecture, platform === "win32" ? "typst.exe" : "typst");
}

/**
 * The bundled Typst executable, or undefined when there is none.
 *
 * One route and no fallback ladder. The attempt is logged at debug level, so a
 * user who reports an inert preview can be diagnosed from the log alone.
 */
export async function probeTypstBinary(probe: TypstProbe): Promise<string | undefined> {
	const binPath = await probe.binPath();
	if (!binPath) {
		logMessage("Typst preview: Quarto reported no path, so no binary was probed.", "debug");
		return undefined;
	}

	const candidate = typstBinaryCandidate(binPath, probe.platform, probe.arch);
	if (probe.exists(candidate)) {
		logMessage(`Typst preview: resolved the compiler at ${candidate}.`, "debug");
		return candidate;
	}
	logMessage(`Typst preview: no compiler at ${candidate}.`, "debug");
	return undefined;
}

/** The probe that reads the running machine. */
const machineProbe: TypstProbe = {
	binPath: async () => {
		const info = await getQuartoVersionInfo();
		return info.available ? info.path : undefined;
	},
	exists: (candidate: string) => {
		try {
			return fs.statSync(candidate).isFile();
		} catch {
			return false;
		}
	},
	platform: process.platform,
	arch: process.arch,
};

let resolution: Promise<string | undefined> | undefined;

/**
 * The bundled Typst executable, resolved once per session.
 *
 * The result is cached because the probe runs on every preview request, and it
 * activates the Quarto extension to read its API.
 */
export async function resolveTypstBinary(): Promise<string | undefined> {
	resolution ??= probeTypstBinary(machineProbe);
	return resolution;
}

/** Forget the resolved binary, so the next request probes again. */
export function invalidateTypstBinary(): void {
	resolution = undefined;
}

/** How long a killed child gets to exit before it is killed again, harder. */
const KILL_GRACE_MS = 2000;

/** How long one compile gets, which also covers a first-use package download. */
export const DEFAULT_TIMEOUT_MS = 20000;

/** How much output one compile may produce before it is treated as a failure. */
export const DEFAULT_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

/** The outcome of one compile that Typst itself reported on. */
export interface TypstCompileResult {
	/** The image, absent when Typst produced none. */
	svg?: string;
	/** The captured standard error, which carries every diagnostic. */
	stderr: string;
}

export interface TypstCompilerOptions {
	timeoutMs?: number;
	maxOutputBytes?: number;
}

/** A compile that never reached Typst, or that was stopped before it finished. */
export class TypstCompileFailure extends Error {}

/** Whether a child has already gone. */
function hasExited(child: ChildProcess): boolean {
	return child.exitCode !== null || child.signalCode !== null;
}

/**
 * Stop a child, and make sure it actually stops.
 *
 * Typst can be inside a package download or a runaway loop, where a polite
 * signal is ignored, so the hard signal follows on a timer.
 */
function killChild(child: ChildProcess): void {
	if (hasExited(child)) {
		return;
	}
	child.kill("SIGTERM");
	const grace = setTimeout(() => {
		if (!hasExited(child)) {
			child.kill("SIGKILL");
		}
	}, KILL_GRACE_MS);
	grace.unref();
	child.once("close", () => clearTimeout(grace));
}

/**
 * One Typst process at a time, over stdin and stdout.
 *
 * `spawn` rather than `execFile`, because `execFile` buffers stdout behind a
 * 1 MiB `maxBuffer` that Typst glyph outlines routinely exceed, and raising it
 * to `Infinity` removes the safety valve without replacing it. Accumulating the
 * output here keeps a running total, so an oversized image is a clean error.
 *
 * Never `exec` and never a shell: the arguments carry workspace-controlled
 * strings, so an argv array with `shell: false` is a hard requirement.
 */
export class TypstCompiler {
	private child: ChildProcess | undefined;
	private abortCurrent: ((error: Error) => void) | undefined;
	private disposed = false;

	constructor(
		private readonly binary: string,
		private readonly options: TypstCompilerOptions = {},
	) {}

	/**
	 * Compile one source, superseding whatever was running.
	 *
	 * Resolves for any run Typst finished, whether or not it produced an image,
	 * because a failed compile is a result the caller renders. Rejects when the
	 * run was cancelled, superseded, timed out, oversized, or never started.
	 */
	compile(source: string, argv: string[], token: vscode.CancellationToken): Promise<TypstCompileResult> {
		if (this.disposed) {
			return Promise.reject(new TypstCompileFailure("The Typst compiler is disposed."));
		}
		this.stopCurrent();

		const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		const maxOutputBytes = this.options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

		return new Promise<TypstCompileResult>((resolve, reject) => {
			let child: ChildProcess;
			try {
				child = spawn(this.binary, argv, { shell: false, windowsHide: true });
			} catch (error) {
				reject(new TypstCompileFailure(`Failed to start Typst: ${String(error)}.`));
				return;
			}

			const output: Buffer[] = [];
			let outputBytes = 0;
			let stderr = "";
			let settled = false;

			const timer = setTimeout(
				() => abort(new TypstCompileFailure(`Typst did not finish within ${timeoutMs} ms.`)),
				timeoutMs,
			);
			const cancellation = token.onCancellationRequested(() => abort(new vscode.CancellationError()));

			const settle = (act: () => void) => {
				if (settled) {
					return;
				}
				settled = true;
				clearTimeout(timer);
				cancellation.dispose();
				if (this.child === child) {
					this.child = undefined;
					this.abortCurrent = undefined;
				}
				act();
			};

			function abort(error: Error): void {
				killChild(child);
				settle(() => reject(error));
			}

			this.child = child;
			this.abortCurrent = abort;

			// Attach this before writing. Typst closes stdin as soon as it gives up
			// on the source, which is the common case while typing, and an unhandled
			// EPIPE takes the extension host down with it.
			child.stdin?.on("error", (error: Error) => {
				logMessage(`Typst preview: the compiler closed its input early: ${error.message}.`, "debug");
			});
			child.stdin?.end(source);

			child.stdout?.on("data", (chunk: Buffer) => {
				outputBytes += chunk.length;
				if (outputBytes > maxOutputBytes) {
					abort(new TypstCompileFailure(`Typst produced more than ${maxOutputBytes} bytes.`));
					return;
				}
				output.push(chunk);
			});

			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString("utf-8");
			});

			child.on("error", (error: Error) =>
				settle(() => reject(new TypstCompileFailure(`Failed to start Typst: ${error.message}.`))),
			);

			child.on("close", (code: number | null) => {
				settle(() => {
					const svg = Buffer.concat(output).toString("utf-8");
					resolve(code === 0 && svg.length > 0 ? { svg, stderr } : { stderr });
				});
			});
		});
	}

	/** Stop the running compile, if there is one. */
	private stopCurrent(): void {
		this.abortCurrent?.(new vscode.CancellationError());
	}

	dispose(): void {
		this.disposed = true;
		this.stopCurrent();
	}
}
