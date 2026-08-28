import * as assert from "assert";
import * as path from "node:path";
import { typstBinaryCandidate, probeTypstBinary, type TypstProbe } from "../../providers/typstPreview/typstCompiler";

const BIN = path.join("/opt", "quarto", "bin");

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
});
