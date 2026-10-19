import * as assert from "assert";
import { AsyncKeyedCache } from "../../utils/asyncKeyedCache";

interface Deferred<T> {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: Error) => void;
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

suite("Async Keyed Cache Test Suite", () => {
	const realNow = Date.now;
	let now: number;

	setup(() => {
		now = 1_000_000;
		Date.now = () => now;
	});

	teardown(() => {
		Date.now = realNow;
	});

	function countingCache(ttlMs?: number): { cache: AsyncKeyedCache<string>; calls: string[] } {
		const calls: string[] = [];
		const cache = new AsyncKeyedCache<string>(
			async (key) => {
				calls.push(key);
				return `${key}#${calls.length}`;
			},
			"empty",
			ttlMs,
		);
		return { cache, calls };
	}

	test("Should fetch once and serve the value within the time to live", async () => {
		const { cache, calls } = countingCache(2000);
		assert.strictEqual(await cache.get("a"), "a#1");
		now += 1999;
		assert.strictEqual(await cache.get("a"), "a#1");
		assert.deepStrictEqual(calls, ["a"]);
	});

	test("Should fetch again once the time to live has passed", async () => {
		const { cache, calls } = countingCache(2000);
		await cache.get("a");
		now += 2000;
		assert.strictEqual(await cache.get("a"), "a#2");
		assert.deepStrictEqual(calls, ["a", "a"]);
	});

	test("Should keep a separate entry for each key", async () => {
		const { cache, calls } = countingCache();
		assert.strictEqual(await cache.get("a"), "a#1");
		assert.strictEqual(await cache.get("b"), "b#2");
		assert.strictEqual(await cache.get("a"), "a#1");
		assert.deepStrictEqual(calls, ["a", "b"]);
	});

	test("Should share one fetch between concurrent callers", async () => {
		const gate = deferred<string>();
		let fetches = 0;
		const cache = new AsyncKeyedCache<string>(() => {
			fetches += 1;
			return gate.promise;
		}, "empty");
		const first = cache.get("a");
		const second = cache.get("a");
		gate.resolve("value");
		assert.deepStrictEqual(await Promise.all([first, second]), ["value", "value"]);
		assert.strictEqual(fetches, 1);
	});

	test("Should drop one key on invalidate and keep the others", async () => {
		const { cache, calls } = countingCache();
		await cache.get("a");
		await cache.get("b");
		cache.invalidate("a");
		assert.strictEqual(await cache.get("a"), "a#3");
		assert.strictEqual(await cache.get("b"), "b#2");
		assert.deepStrictEqual(calls, ["a", "b", "a"]);
	});

	test("Should drop every key when invalidate gets no key", async () => {
		const { cache, calls } = countingCache();
		await cache.get("a");
		await cache.get("b");
		cache.invalidate();
		await cache.get("a");
		await cache.get("b");
		assert.deepStrictEqual(calls, ["a", "b", "a", "b"]);
	});

	test("Should not store the result of a fetch that an invalidate superseded", async () => {
		const gate = deferred<string>();
		const values = [gate.promise, Promise.resolve("fresh")];
		const cache = new AsyncKeyedCache<string>(() => values.shift() as Promise<string>, "empty");
		const stale = cache.get("a");
		cache.invalidate("a");
		assert.strictEqual(await cache.get("a"), "fresh");
		gate.resolve("stale");
		assert.strictEqual(await stale, "stale");
		assert.strictEqual(await cache.get("a"), "fresh");
	});

	test("Should reject, forget the failure and fetch again on the next call", async () => {
		let attempts = 0;
		const cache = new AsyncKeyedCache<string>(async () => {
			attempts += 1;
			if (attempts === 1) {
				throw new Error("network down");
			}
			return "recovered";
		}, "empty");
		await assert.rejects(cache.get("a"), /network down/);
		assert.strictEqual(await cache.get("a"), "recovered");
		assert.strictEqual(attempts, 2);
	});

	test("Should share a failure between concurrent callers", async () => {
		const gate = deferred<string>();
		const cache = new AsyncKeyedCache<string>(() => gate.promise, "empty");
		const first = cache.get("a");
		const second = cache.get("a");
		gate.reject(new Error("boom"));
		await assert.rejects(first, /boom/);
		await assert.rejects(second, /boom/);
	});
});
