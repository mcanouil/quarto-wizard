import { beforeEach, describe, expect, it, vi } from "vitest";
import { CancellationError } from "../src/errors.js";
import { fetchRegistry } from "../src/registry/fetcher.js";
import { proxyFetch } from "../src/proxy/index.js";

vi.mock("../src/proxy/index.js", () => ({
	proxyFetch: vi.fn(),
}));

describe("fetchRegistry", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(proxyFetch).mockResolvedValue(new Response("{}", { status: 200 }));
	});

	it("sends no request when the signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort();

		await expect(fetchRegistry({ cacheDir: "", signal: controller.signal })).rejects.toBeInstanceOf(CancellationError);

		expect(proxyFetch).not.toHaveBeenCalled();
	});
});
