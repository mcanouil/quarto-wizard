type CacheEntry<T> = { status: "settled"; value: T; expiresAt: number } | { status: "pending"; inFlight: Promise<T> };

/**
 * Generic TTL-based cache with in-flight request deduplication.
 *
 * Ensures that concurrent requests for the same key share a single
 * in-flight promise rather than triggering redundant fetches.
 * Every value a fetch resolves to is cached, including falsy values
 * such as `""`, `0`, `false`, `null` and `undefined`.
 */
export class AsyncKeyedCache<T> {
	private cache = new Map<string, CacheEntry<T>>();

	constructor(
		private readonly fetcher: (key: string) => Promise<T>,
		private readonly ttlMs = 2000,
	) {}

	async get(key: string): Promise<T> {
		const entry = this.cache.get(key);

		if (entry?.status === "pending") {
			return entry.inFlight;
		}
		if (entry?.status === "settled" && entry.expiresAt > Date.now()) {
			return entry.value;
		}

		const inFlight = this.fetcher(key)
			.then((value) => {
				if (this.isCurrent(key, inFlight)) {
					this.cache.set(key, {
						status: "settled",
						value,
						expiresAt: Date.now() + this.ttlMs,
					});
				}
				return value;
			})
			.catch((error) => {
				if (this.isCurrent(key, inFlight)) {
					this.cache.delete(key);
				}
				throw error;
			});

		this.cache.set(key, { status: "pending", inFlight });

		return inFlight;
	}

	invalidate(key?: string): void {
		if (key !== undefined) {
			this.cache.delete(key);
			return;
		}
		this.cache.clear();
	}

	private isCurrent(key: string, inFlight: Promise<T>): boolean {
		const entry = this.cache.get(key);
		return entry?.status === "pending" && entry.inFlight === inFlight;
	}
}
