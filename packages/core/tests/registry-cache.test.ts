import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Registry } from "../src/types/registry.js";
import {
	readCachedRegistry,
	writeCachedRegistry,
	clearRegistryCache,
	getCacheFilePath,
	getCacheStatus,
} from "../src/registry/cache.js";

describe("registry cache", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "quarto-cache-test-"));
	});

	afterEach(async () => {
		await fs.promises.rm(tempDir, { recursive: true, force: true });
	});

	const testRegistry: Registry = {
		"test/ext": {
			id: "test/ext",
			owner: "test",
			name: "Test Extension",
			fullName: "test/ext",
			description: "A test extension",
			topics: ["test"],
			latestVersion: "1.0.0",
			latestTag: "v1.0.0",
			latestReleaseUrl: null,
			stars: 10,
			licence: "MIT",
			htmlUrl: "https://github.com/test/ext",
			template: false,
			templateContent: null,
		},
	};

	const testUrl = "https://example.com/registry.json";

	describe("writeCachedRegistry", () => {
		it("writes cache to file", async () => {
			await writeCachedRegistry(tempDir, testUrl, testRegistry);

			const cacheFile = getCacheFilePath(tempDir);
			expect(fs.existsSync(cacheFile)).toBe(true);
		});

		it("creates directory if needed", async () => {
			const nestedDir = path.join(tempDir, "nested", "cache");
			await writeCachedRegistry(nestedDir, testUrl, testRegistry);

			const cacheFile = getCacheFilePath(nestedDir);
			expect(fs.existsSync(cacheFile)).toBe(true);
		});
	});

	describe("readCachedRegistry", () => {
		it("returns null when cache does not exist", async () => {
			const result = await readCachedRegistry(tempDir, testUrl);

			expect(result).toBeNull();
		});

		it("reads valid cache", async () => {
			await writeCachedRegistry(tempDir, testUrl, testRegistry);

			const result = await readCachedRegistry(tempDir, testUrl);

			expect(result).not.toBeNull();
			expect(result?.["test/ext"]?.name).toBe("Test Extension");
		});

		it("returns null for different URL", async () => {
			await writeCachedRegistry(tempDir, testUrl, testRegistry);

			const result = await readCachedRegistry(tempDir, "https://other.com/registry.json");

			expect(result).toBeNull();
		});

		it("returns null for expired cache", async () => {
			await writeCachedRegistry(tempDir, testUrl, testRegistry);

			const result = await readCachedRegistry(tempDir, testUrl, 0);

			expect(result).toBeNull();
		});

		it("returns cache within TTL", async () => {
			await writeCachedRegistry(tempDir, testUrl, testRegistry);

			const result = await readCachedRegistry(tempDir, testUrl, 60000);

			expect(result).not.toBeNull();
		});
	});

	describe("clearRegistryCache", () => {
		it("clears existing cache", async () => {
			await writeCachedRegistry(tempDir, testUrl, testRegistry);
			const cacheFile = getCacheFilePath(tempDir);
			expect(fs.existsSync(cacheFile)).toBe(true);

			await clearRegistryCache(tempDir);

			expect(fs.existsSync(cacheFile)).toBe(false);
		});

		it("does not throw for non-existent cache", async () => {
			await expect(clearRegistryCache(tempDir)).resolves.not.toThrow();
		});
	});

	describe("getCacheStatus", () => {
		it("returns exists: false when no cache", async () => {
			const status = await getCacheStatus(tempDir);

			expect(status?.exists).toBe(false);
		});

		it("returns cache info when cache exists", async () => {
			await writeCachedRegistry(tempDir, testUrl, testRegistry);

			const status = await getCacheStatus(tempDir);

			expect(status?.exists).toBe(true);
			expect(status?.url).toBe(testUrl);
			expect(status?.age).toBeDefined();
			expect(status?.age).toBeLessThan(1000);
		});
	});

	describe("getCacheFilePath", () => {
		it("returns path with filename", () => {
			const cachePath = getCacheFilePath(tempDir);

			expect(cachePath).toContain(tempDir);
			expect(cachePath).toContain("quarto-wizard-registry.json");
		});
	});
});
