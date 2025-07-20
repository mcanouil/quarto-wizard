import * as assert from "assert";
import * as vscode from "vscode";
import { getExtensionsDetails, ExtensionDetails } from "../../utils/extensionDetails";
import { generateHashKey } from "../../utils/hash";
import * as constants from "../../constants";

interface MockExtensionContext {
	globalState: {
		get: (key: string) => unknown;
		update: (key: string, value: unknown) => Thenable<void>;
	};
}

suite("Extension Details Test Suite", () => {
	let originalFetch: typeof globalThis.fetch;
	let mockContext: MockExtensionContext;
	let globalStateStorage: Record<string, unknown>;

	const mockExtensionData = {
		"mcanouil/quarto-github": {
			createdAt: "2024-07-14T12:20:53Z",
			defaultBranchRef: "main",
			description:
				"Use GitHub short references (commits, issues, discussions, and pull requests) directly into your Quarto documents.",
			latestRelease: "1.0.1",
			latestReleaseUrl: "https://github.com/mcanouil/quarto-github/releases/tag/1.0.1",
			licenseInfo: "MIT License",
			name: "quarto-github",
			nameWithOwner: "mcanouil/quarto-github",
			openGraphImageUrl:
				"https://repository-images.githubusercontent.com/828525647/516f4d12-3326-4ba1-bc80-d5fec8c5b0bf",
			owner: "mcanouil",
			repositoryTopics: ["github", "short-link", "example"],
			stargazerCount: 20,
			title: "GITHUB",
			updatedAt: "2025-05-25T12:30:59Z",
			url: "https://github.com/mcanouil/quarto-github",
			author: "Mickaël Canouil",
			template: false,
			templateContent: null,
			example: true,
			exampleContent: "LS0tCnRpdGxlOiAiQXV0b2xpbmtlZCByZWZlcmVuY2VzIGFuZCBVUkxzIgpk",
		},
		"mcanouil/quarto-highlight-text": {
			createdAt: "2024-05-03T20:09:15Z",
			defaultBranchRef: "main",
			description:
				"Quarto extension that allows to highlight text in a document for various formats: HTML, LaTeX, Typst, Reveal.js, Beamer, PowerPoint, and Docx.",
			latestRelease: "1.3.3",
			latestReleaseUrl: "https://github.com/mcanouil/quarto-highlight-text/releases/tag/1.3.3",
			licenseInfo: "MIT License",
			name: "quarto-highlight-text",
			nameWithOwner: "mcanouil/quarto-highlight-text",
			openGraphImageUrl:
				"https://repository-images.githubusercontent.com/795686327/7503a7fe-546d-4d0d-a638-564a090e7627",
			owner: "mcanouil",
			repositoryTopics: ["docx", "filter", "highlight", "highlight-text", "html", "latex", "typst", "example"],
			stargazerCount: 27,
			title: "HIGHLIGHT TEXT",
			updatedAt: "2025-06-27T19:41:53Z",
			url: "https://github.com/mcanouil/quarto-highlight-text",
			author: "Mickaël Canouil",
			template: false,
			templateContent: null,
			example: true,
			exampleContent: "LS0tCnRpdGxlOiAiSGlnaGxpZ2h0LXRleHQgUXVhcnRvIEV4dGVuc2lvbiIK",
		},
	};

	// Expected extension details - we cast the results as the actual function returns
	// The templateContent might be null in JSON but the function should handle it
	const expectedExtensions = [
		{
			id: "mcanouil/quarto-github",
			name: "GITHUB",
			full_name: "mcanouil/quarto-github",
			owner: "mcanouil",
			description:
				"Use GitHub short references (commits, issues, discussions, and pull requests) directly into your Quarto documents.",
			stars: 20,
			license: "MIT License",
			html_url: "https://github.com/mcanouil/quarto-github",
			version: "1.0.1",
			tag: "1.0.1",
			template: false,
			templateContent: null, // This will be what the function actually returns
		},
		{
			id: "mcanouil/quarto-highlight-text",
			name: "HIGHLIGHT TEXT",
			full_name: "mcanouil/quarto-highlight-text",
			owner: "mcanouil",
			description:
				"Quarto extension that allows to highlight text in a document for various formats: HTML, LaTeX, Typst, Reveal.js, Beamer, PowerPoint, and Docx.",
			stars: 27,
			license: "MIT License",
			html_url: "https://github.com/mcanouil/quarto-highlight-text",
			version: "1.3.3",
			tag: "1.3.3",
			template: false,
			templateContent: null, // This will be what the function actually returns
		},
	];

	setup(() => {
		// Store original fetch
		originalFetch = globalThis.fetch;

		// Reset global state storage
		globalStateStorage = {};

		// Create mock context
		mockContext = {
			globalState: {
				get: (key: string) => globalStateStorage[key],
				update: (key: string, value: unknown) => {
					globalStateStorage[key] = value;
					return Promise.resolve();
				},
			},
		};
	});

	teardown(() => {
		// Restore original fetch
		globalThis.fetch = originalFetch;
	});

	test("getExtensionsDetails - Should fetch and parse extension details successfully", async () => {
		// Mock successful fetch
		globalThis.fetch = async (): Promise<Response> => {
			return {
				ok: true,
				statusText: "OK",
				text: async () => JSON.stringify(mockExtensionData),
			} as Response;
		};

		const result = await getExtensionsDetails(mockContext as unknown as vscode.ExtensionContext);

		assert.strictEqual(result.length, 2, "Should return 2 extensions");
		assert.deepStrictEqual(result, expectedExtensions, "Should match expected extension details");
	});

	test("getExtensionsDetails - Should use cached data when available and not expired", async () => {
		// Note: This test accounts for QW_EXTENSIONS_CACHE_TIME being 0 in the constants
		// When cache time is 0, cache is effectively disabled, so we expect fetch to be called
		let fetchCalled = false;

		// Pre-populate cache with valid, non-expired data
		const cacheKey = `${constants.QW_EXTENSIONS_CACHE}_${generateHashKey(constants.QW_EXTENSIONS)}`;
		globalStateStorage[cacheKey] = {
			data: expectedExtensions,
			timestamp: Date.now() - 1000, // 1 second ago
		};

		// Mock fetch to detect if it's called
		globalThis.fetch = async (): Promise<Response> => {
			fetchCalled = true;
			return {
				ok: true,
				statusText: "OK",
				text: async () => JSON.stringify(mockExtensionData),
			} as Response;
		};

		const result = await getExtensionsDetails(mockContext as unknown as vscode.ExtensionContext);

		if (constants.QW_EXTENSIONS_CACHE_TIME === 0) {
			// Cache is disabled, so fetch should be called
			assert.strictEqual(fetchCalled, true, "Fetch should be called when cache is disabled");
			assert.strictEqual(result.length, 2, "Should return fresh extensions");
		} else {
			// Cache is enabled, so fetch should not be called
			assert.strictEqual(fetchCalled, false, "Fetch should not be called when cache is valid");
			assert.strictEqual(result.length, 2, "Should return cached extensions");
			assert.deepStrictEqual(result, expectedExtensions, "Should return cached data");
		}
	});

	test("getExtensionsDetails - Should demonstrate caching logic when cache time is non-zero", async () => {
		// This test demonstrates what happens when caching is actually enabled
		let fetchCalled = false;

		// Pre-populate cache with valid data
		const cacheKey = `${constants.QW_EXTENSIONS_CACHE}_${generateHashKey(constants.QW_EXTENSIONS)}`;
		const recentTimestamp = Date.now() - 1000; // 1 second ago
		globalStateStorage[cacheKey] = {
			data: expectedExtensions,
			timestamp: recentTimestamp,
		};

		// Mock fetch to detect if it's called
		globalThis.fetch = async (): Promise<Response> => {
			fetchCalled = true;
			return {
				ok: true,
				statusText: "OK",
				text: async () => JSON.stringify(mockExtensionData),
			} as Response;
		};

		const result = await getExtensionsDetails(mockContext as unknown as vscode.ExtensionContext);

		// Test the logical condition: if current time - cached time < cache time, then use cache
		const cacheAge = Date.now() - recentTimestamp;
		const shouldUseCache = cacheAge < constants.QW_EXTENSIONS_CACHE_TIME;

		if (shouldUseCache) {
			assert.strictEqual(fetchCalled, false, "Should use cache when data is fresh");
			assert.deepStrictEqual(result, expectedExtensions, "Should return cached data");
		} else {
			assert.strictEqual(fetchCalled, true, "Should fetch new data when cache is expired");
			assert.strictEqual(result.length, 2, "Should return fresh extensions");
		}
	});

	test("getExtensionsDetails - Should fetch new data when cache is expired", async () => {
		let fetchCalled = false;

		// Pre-populate cache with expired data
		const cacheKey = `${constants.QW_EXTENSIONS_CACHE}_${generateHashKey(constants.QW_EXTENSIONS)}`;
		globalStateStorage[cacheKey] = {
			data: [],
			timestamp: Date.now() - (constants.QW_EXTENSIONS_CACHE_TIME + 1000), // Expired
		};

		// Mock successful fetch
		globalThis.fetch = async (): Promise<Response> => {
			fetchCalled = true;
			return {
				ok: true,
				statusText: "OK",
				text: async () => JSON.stringify(mockExtensionData),
			} as Response;
		};

		const result = await getExtensionsDetails(mockContext as unknown as vscode.ExtensionContext);

		assert.strictEqual(fetchCalled, true, "Fetch should be called when cache is expired");
		assert.strictEqual(result.length, 2, "Should return new extensions");
	});

	test("getExtensionsDetails - Should handle network errors gracefully", async () => {
		// Mock failed fetch
		globalThis.fetch = async (): Promise<Response> => {
			throw new Error("Network error");
		};

		const result = await getExtensionsDetails(mockContext as unknown as vscode.ExtensionContext);

		assert.strictEqual(result.length, 0, "Should return empty array on network error");
	});

	test("getExtensionsDetails - Should handle HTTP errors gracefully", async () => {
		// Mock HTTP error response
		globalThis.fetch = async (): Promise<Response> => {
			return {
				ok: false,
				statusText: "Not Found",
				text: async () => "",
			} as Response;
		};

		const result = await getExtensionsDetails(mockContext as unknown as vscode.ExtensionContext);

		assert.strictEqual(result.length, 0, "Should return empty array on HTTP error");
	});

	test("getExtensionsDetails - Should handle malformed JSON gracefully", async () => {
		// Mock fetch with invalid JSON
		globalThis.fetch = async (): Promise<Response> => {
			return {
				ok: true,
				statusText: "OK",
				text: async () => "invalid json {",
			} as Response;
		};

		const result = await getExtensionsDetails(mockContext as unknown as vscode.ExtensionContext);

		assert.strictEqual(result.length, 0, "Should return empty array on JSON parse error");
	});

	test("getExtensionsDetails - Should handle empty response data", async () => {
		// Mock fetch with empty object
		globalThis.fetch = async (): Promise<Response> => {
			return {
				ok: true,
				statusText: "OK",
				text: async () => "{}",
			} as Response;
		};

		const result = await getExtensionsDetails(mockContext as unknown as vscode.ExtensionContext);

		assert.strictEqual(result.length, 0, "Should return empty array for empty data");
	});

	test("getExtensionsDetails - Should strip 'v' prefix from version correctly", async () => {
		const dataWithVersions = {
			"mcanouil/ext-with-v": {
				...mockExtensionData["mcanouil/quarto-github"],
				latestRelease: "v2.1.3",
			},
			"mcanouil/ext-without-v": {
				...mockExtensionData["mcanouil/quarto-github"],
				latestRelease: "1.0.0", // No 'v' prefix
			},
		};

		// Mock successful fetch
		globalThis.fetch = async (): Promise<Response> => {
			return {
				ok: true,
				statusText: "OK",
				text: async () => JSON.stringify(dataWithVersions),
			} as Response;
		};

		const result = await getExtensionsDetails(mockContext as unknown as vscode.ExtensionContext);

		assert.strictEqual(result[0].version, "2.1.3", "Should strip 'v' prefix from version");
		assert.strictEqual(result[0].tag, "v2.1.3", "Should keep original tag with 'v' prefix");
		assert.strictEqual(result[1].version, "1.0.0", "Should handle version without 'v' prefix");
		assert.strictEqual(result[1].tag, "1.0.0", "Should keep original tag without 'v' prefix");
	});

	test("getExtensionsDetails - Should handle template and non-template extensions correctly", async () => {
		// Create test data with one template and one non-template extension
		const testData = {
			"mcanouil/quarto-github": {
				...mockExtensionData["mcanouil/quarto-github"],
			},
			"mcanouil/template-extension": {
				...mockExtensionData["mcanouil/quarto-highlight-text"],
				template: true,
				templateContent: "# Template Content\n\nThis is a template.",
			},
		};

		// Mock successful fetch
		globalThis.fetch = async (): Promise<Response> => {
			return {
				ok: true,
				statusText: "OK",
				text: async () => JSON.stringify(testData),
			} as Response;
		};

		const result = await getExtensionsDetails(mockContext as unknown as vscode.ExtensionContext);

		const nonTemplate = result.find((ext) => ext.id === "mcanouil/quarto-github");
		const template = result.find((ext) => ext.id === "mcanouil/template-extension");

		assert.strictEqual(nonTemplate?.template, false, "Non-template extension should have template=false");
		assert.strictEqual(nonTemplate?.templateContent, null, "Non-template should have null template content");

		assert.strictEqual(template?.template, true, "Template extension should have template=true");
		assert.strictEqual(
			template?.templateContent,
			"# Template Content\n\nThis is a template.",
			"Template should have content"
		);
	});

	test("getExtensionsDetails - Should save fetched data to cache", async () => {
		// Mock successful fetch
		globalThis.fetch = async (): Promise<Response> => {
			return {
				ok: true,
				statusText: "OK",
				text: async () => JSON.stringify(mockExtensionData),
			} as Response;
		};

		const result = await getExtensionsDetails(mockContext as unknown as vscode.ExtensionContext);

		// Check that data was cached
		const cacheKey = `${constants.QW_EXTENSIONS_CACHE}_${generateHashKey(constants.QW_EXTENSIONS)}`;
		const cachedData = globalStateStorage[cacheKey] as { data: ExtensionDetails[]; timestamp: number };

		assert.ok(cachedData, "Data should be cached");
		assert.strictEqual(cachedData.data.length, 2, "Cached data should have correct length");
		assert.ok(cachedData.timestamp > 0, "Cache should have timestamp");
		assert.deepStrictEqual(result, cachedData.data, "Result should match cached data");
	});

	test("getExtensionsDetails - Should handle missing fields gracefully", async () => {
		const incompleteData = {
			"mcanouil/incomplete": {
				title: "Incomplete Extension",
				nameWithOwner: "mcanouil/incomplete",
				owner: "mcanouil",
				// Missing description, stargazerCount, etc.
				latestRelease: "v1.0.0",
				template: false,
				templateContent: null,
			},
		};

		// Mock successful fetch with incomplete data
		globalThis.fetch = async (): Promise<Response> => {
			return {
				ok: true,
				statusText: "OK",
				text: async () => JSON.stringify(incompleteData),
			} as Response;
		};

		const result = await getExtensionsDetails(mockContext as unknown as vscode.ExtensionContext);

		assert.strictEqual(result.length, 1, "Should return 1 extension even with missing fields");
		assert.strictEqual(result[0].id, "mcanouil/incomplete", "Should have correct id");
		assert.strictEqual(result[0].name, "Incomplete Extension", "Should have correct name");
		assert.strictEqual(result[0].description, undefined, "Should handle missing description");
	});

	test("getExtensionsDetails - Should validate ExtensionDetails interface", async () => {
		// Mock successful fetch
		globalThis.fetch = async (): Promise<Response> => {
			return {
				ok: true,
				statusText: "OK",
				text: async () => JSON.stringify(mockExtensionData),
			} as Response;
		};

		const result = await getExtensionsDetails(mockContext as unknown as vscode.ExtensionContext);

		result.forEach((extension) => {
			// Validate required fields exist
			assert.ok(typeof extension.id === "string", "id should be a string");
			assert.ok(typeof extension.name === "string", "name should be a string");
			assert.ok(typeof extension.full_name === "string", "full_name should be a string");
			assert.ok(typeof extension.owner === "string", "owner should be a string");
			assert.ok(typeof extension.version === "string", "version should be a string");
			assert.ok(typeof extension.tag === "string", "tag should be a string");
			assert.ok(typeof extension.template === "boolean", "template should be a boolean");
			assert.ok(
				typeof extension.templateContent === "string" || extension.templateContent === null,
				"templateContent should be a string or null"
			);

			// Validate optional fields when present
			if (extension.description !== undefined) {
				assert.ok(typeof extension.description === "string", "description should be a string when present");
			}
			if (extension.stars !== undefined) {
				assert.ok(typeof extension.stars === "number", "stars should be a number when present");
			}
			if (extension.license !== undefined) {
				assert.ok(typeof extension.license === "string", "license should be a string when present");
			}
			if (extension.html_url !== undefined) {
				assert.ok(typeof extension.html_url === "string", "html_url should be a string when present");
			}
		});
	});
});
