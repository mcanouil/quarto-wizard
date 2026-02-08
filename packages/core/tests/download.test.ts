import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";

/**
 * Simulates the drain-wait pattern used in downloadArchive.
 * This is the CURRENT (buggy) version that only listens for drain.
 */
function waitForDrainBuggy(stream: Writable): Promise<void> {
	return new Promise<void>((resolve) => {
		stream.once("drain", resolve);
	});
}

/**
 * Simulates the FIXED drain-wait pattern that also listens for errors.
 */
function waitForDrainFixed(stream: Writable): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const onDrain = () => {
			stream.off("error", onError);
			resolve();
		};
		const onError = (err: Error) => {
			stream.off("drain", onDrain);
			reject(err);
		};
		stream.once("drain", onDrain);
		stream.once("error", onError);
	});
}

/**
 * Create a writable stream that simulates backpressure followed by an error.
 * When written to, it returns false (backpressure), then emits an error
 * instead of drain.
 */
function createErroringStream(): Writable {
	const stream = new Writable({
		write(_chunk, _encoding, callback) {
			// Simulate slow write
			callback();
		},
		highWaterMark: 1, // Low threshold to easily trigger backpressure
	});

	return stream;
}

describe("drain-wait during stream error", () => {
	it("buggy version hangs when stream errors during drain wait", async () => {
		const stream = createErroringStream();

		// Suppress the uncaught error from stream.destroy() in this test
		stream.on("error", () => {});

		// Start the drain wait
		const drainPromise = waitForDrainBuggy(stream);

		// Emit error instead of drain (simulates disk full, I/O error, etc.)
		process.nextTick(() => {
			stream.destroy(new Error("Simulated disk error"));
		});

		// The buggy version should hang because drain never fires.
		// We use a race with a timeout to detect the hang.
		const result = await Promise.race([
			drainPromise.then(() => "resolved"),
			new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 500)),
		]);

		// This proves the bug: the drain wait hangs (times out)
		expect(result).toBe("timeout");
	});

	it("fixed version rejects when stream errors during drain wait", async () => {
		const stream = createErroringStream();

		// Start the drain wait with the fixed version
		const drainPromise = waitForDrainFixed(stream);

		// Emit error instead of drain
		process.nextTick(() => {
			stream.destroy(new Error("Simulated disk error"));
		});

		// The fixed version should reject with the error
		await expect(drainPromise).rejects.toThrow("Simulated disk error");
	});
});
