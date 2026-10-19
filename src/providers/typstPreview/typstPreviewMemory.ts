import type { TypstCompileResult } from "./typstCompiler";

/**
 * How many compiled results are remembered.
 *
 * Enough to hold every block of a document under an edit and its undo history,
 * and small enough that a session of many documents does not grow without
 * bound.
 */
export const CACHE_LIMIT = 32;

/**
 * How many bytes of image the remembered results may hold together.
 *
 * The count alone is not a bound. One compile may produce up to the compiler's
 * own output limit, which is measured in megabytes, so a cache of a few dense
 * pages would hold far more of the extension host than the count suggests.
 */
const CACHE_LIMIT_BYTES = 16 * 1024 * 1024;

/**
 * How much of the budget one remembered compile takes.
 *
 * Whichever image the entry holds, because a raster and a vector are counted
 * against one budget and reading the vector alone would let a session of
 * rasters grow without any of them being counted.
 */
function imageBytes(compiled: TypstCompileResult | undefined): number {
	return compiled?.svg?.length ?? compiled?.png?.length ?? 0;
}

/**
 * The compiled results, most recently used last.
 *
 * Keyed by what decides the image: the source, the arguments and the binary.
 * A failure is remembered as well, because an unchanged broken block is the
 * normal state halfway through an edit and recompiling it says the same thing
 * at the cost of a process.
 */
export class TypstImageMemory {
	private readonly entries = new Map<string, TypstCompileResult>();
	/** How many bytes of image the entries are holding. */
	private bytes = 0;

	constructor(private readonly limitBytes: number = CACHE_LIMIT_BYTES) {}

	/** The result held for a key, which then counts as the most recently used. */
	recall(key: string): TypstCompileResult | undefined {
		const held = this.entries.get(key);
		if (held !== undefined) {
			// Re-inserted so the least recently used entry is the first one, which is
			// what the eviction in `remember` removes.
			this.entries.delete(key);
			this.entries.set(key, held);
		}
		return held;
	}

	/** Forget one compiled image, and the bytes it was counted for. */
	forget(key: string): void {
		this.bytes -= imageBytes(this.entries.get(key));
		this.entries.delete(key);
	}

	/** Remember one compile, and forget those used longest ago to make room. */
	remember(key: string, compiled: TypstCompileResult): void {
		// Anything held for this source is dropped first. Without this the budget
		// would count the same image twice, and the replacement would keep the
		// insertion place of the entry it replaced rather than becoming the most
		// recently used one.
		this.forget(key);
		this.entries.set(key, compiled);
		this.bytes += imageBytes(compiled);
		// A `Map` iterates in insertion order and every hit is re-inserted, so the
		// first key is the one used longest ago. Both bounds matter: the count keeps
		// a session of small blocks from growing without end, and the byte total
		// keeps a handful of dense pages from holding the extension host.
		while (this.entries.size > CACHE_LIMIT || (this.bytes > this.limitBytes && this.entries.size > 1)) {
			const oldest = this.entries.keys().next();
			if (oldest.done) {
				return;
			}
			this.forget(oldest.value);
		}
	}

	/** Forget every compiled image, so the next request compiles again. */
	clear(): void {
		this.entries.clear();
		this.bytes = 0;
	}
}
