import * as assert from "assert";
import { debounce } from "../../utils/debounce";

/** Let the delay pass. */
function after(delayMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

suite("Debounce Test Suite", () => {
	test("Should report whether a call is waiting", async () => {
		// A caller that has to run the delayed work now, and only once, needs to
		// know which of several delays was waiting. Flushing them all runs the same
		// work more than once, and cancelling them all drops it.
		const debounced = debounce(() => undefined, 20);
		assert.strictEqual(debounced.pending(), false);

		debounced();
		assert.strictEqual(debounced.pending(), true);

		await after(40);
		assert.strictEqual(debounced.pending(), false);
	});

	test("Should report nothing waiting after a flush or a cancel", () => {
		const flushed = debounce(() => undefined, 20);
		flushed();
		flushed.flush();
		assert.strictEqual(flushed.pending(), false);

		const cancelled = debounce(() => undefined, 20);
		cancelled();
		cancelled.cancel();
		assert.strictEqual(cancelled.pending(), false);
	});
});
