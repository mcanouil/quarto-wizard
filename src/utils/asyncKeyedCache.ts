/**
 * Generic TTL-based cache with in-flight request deduplication.
 *
 * Ensures that concurrent requests for the same key share a single
 * in-flight promise rather than triggering redundant fetches.
 */
export class AsyncKeyedCache<T> {
	private cache = new Map<
		string,
		{
			expiresAt: number;
			value: T;
			inFlight?: Promise<T>;
		}
	>();

	constructor(
		private readonly fetcher: (key: string) => Promise<T>,
		private readonly emptyValue: T,
		private readonly ttlMs = 2000,
	) {}

	async get(key: string): Promise<T> {
		const now = Date.now();
		const entry = this.cache.get(key);

		if (entry?.value && entry.expiresAt > now) {
			return entry.value;
		}
		if (entry?.inFlight) {
			return entry.inFlight;
		}

		const inFlight = this.fetcher(key)
			.then((value) => {
				const currentEntry = this.cache.get(key);
				if (currentEntry?.inFlight === inFlight) {
					this.cache.set(key, {
						value,
						expiresAt: Date.now() + this.ttlMs,
					});
				}
				return value;
			})
			.catch((error) => {
				const currentEntry = this.cache.get(key);
				if (currentEntry?.inFlight === inFlight) {
					this.cache.delete(key);
				}
				throw error;
			});

		this.cache.set(key, {
			value: entry?.value ?? this.emptyValue,
			expiresAt: entry?.expiresAt ?? 0,
			inFlight,
		});

		return inFlight;
	}

	invalidate(key?: string): void {
		if (key) {
			this.cache.delete(key);
			return;
		}
		this.cache.clear();
	}
}
