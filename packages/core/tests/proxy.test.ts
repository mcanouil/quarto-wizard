import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getProxyConfig, shouldBypassProxy, getProxyForUrl } from "../src/proxy/config.js";

describe("getProxyConfig", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv };
		delete process.env["HTTP_PROXY"];
		delete process.env["HTTPS_PROXY"];
		delete process.env["NO_PROXY"];
		delete process.env["http_proxy"];
		delete process.env["https_proxy"];
		delete process.env["no_proxy"];
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it("returns empty config when no env vars set", () => {
		const config = getProxyConfig();

		expect(config.httpProxy).toBeUndefined();
		expect(config.httpsProxy).toBeUndefined();
		expect(config.noProxy).toEqual([]);
	});

	it("reads HTTP_PROXY (uppercase)", () => {
		process.env["HTTP_PROXY"] = "http://proxy.example.com:8080";

		const config = getProxyConfig();

		expect(config.httpProxy).toBe("http://proxy.example.com:8080");
	});

	it("reads http_proxy (lowercase)", () => {
		process.env["http_proxy"] = "http://proxy.example.com:8080";

		const config = getProxyConfig();

		expect(config.httpProxy).toBe("http://proxy.example.com:8080");
	});

	it("prefers uppercase HTTP_PROXY over lowercase", () => {
		process.env["HTTP_PROXY"] = "http://upper.example.com:8080";
		process.env["http_proxy"] = "http://lower.example.com:8080";

		const config = getProxyConfig();

		expect(config.httpProxy).toBe("http://upper.example.com:8080");
	});

	it("reads HTTPS_PROXY (uppercase)", () => {
		process.env["HTTPS_PROXY"] = "http://proxy.example.com:8443";

		const config = getProxyConfig();

		expect(config.httpsProxy).toBe("http://proxy.example.com:8443");
	});

	it("reads https_proxy (lowercase)", () => {
		process.env["https_proxy"] = "http://proxy.example.com:8443";

		const config = getProxyConfig();

		expect(config.httpsProxy).toBe("http://proxy.example.com:8443");
	});

	it("parses NO_PROXY as comma-separated list", () => {
		process.env["NO_PROXY"] = "localhost,127.0.0.1,.example.com";

		const config = getProxyConfig();

		expect(config.noProxy).toEqual(["localhost", "127.0.0.1", ".example.com"]);
	});

	it("parses NO_PROXY as space-separated list", () => {
		process.env["NO_PROXY"] = "localhost 127.0.0.1 .example.com";

		const config = getProxyConfig();

		expect(config.noProxy).toEqual(["localhost", "127.0.0.1", ".example.com"]);
	});

	it("handles mixed separators in NO_PROXY", () => {
		process.env["NO_PROXY"] = "localhost, 127.0.0.1  .example.com";

		const config = getProxyConfig();

		expect(config.noProxy).toEqual(["localhost", "127.0.0.1", ".example.com"]);
	});

	it("lowercases NO_PROXY patterns", () => {
		process.env["NO_PROXY"] = "LOCALHOST,EXAMPLE.COM";

		const config = getProxyConfig();

		expect(config.noProxy).toEqual(["localhost", "example.com"]);
	});

	it("filters empty patterns from NO_PROXY", () => {
		process.env["NO_PROXY"] = "localhost,,  ,example.com";

		const config = getProxyConfig();

		expect(config.noProxy).toEqual(["localhost", "example.com"]);
	});
});

describe("shouldBypassProxy", () => {
	it("returns false when noProxy is empty", () => {
		expect(shouldBypassProxy("example.com", [])).toBe(false);
	});

	it("matches wildcard *", () => {
		expect(shouldBypassProxy("example.com", ["*"])).toBe(true);
		expect(shouldBypassProxy("anything.org", ["*"])).toBe(true);
	});

	it("matches exact hostname", () => {
		expect(shouldBypassProxy("example.com", ["example.com"])).toBe(true);
		expect(shouldBypassProxy("other.com", ["example.com"])).toBe(false);
	});

	it("matches case-insensitively", () => {
		expect(shouldBypassProxy("EXAMPLE.COM", ["example.com"])).toBe(true);
		expect(shouldBypassProxy("Example.Com", ["example.com"])).toBe(true);
	});

	it("matches subdomain when pattern has leading dot", () => {
		expect(shouldBypassProxy("api.example.com", [".example.com"])).toBe(true);
		expect(shouldBypassProxy("foo.bar.example.com", [".example.com"])).toBe(true);
		expect(shouldBypassProxy("example.com", [".example.com"])).toBe(true);
		expect(shouldBypassProxy("notexample.com", [".example.com"])).toBe(false);
	});

	it("matches subdomain when pattern has no leading dot", () => {
		expect(shouldBypassProxy("api.example.com", ["example.com"])).toBe(true);
		expect(shouldBypassProxy("foo.bar.example.com", ["example.com"])).toBe(true);
	});

	it("does not match partial hostname", () => {
		expect(shouldBypassProxy("myexample.com", ["example.com"])).toBe(false);
		expect(shouldBypassProxy("example.com.evil.org", ["example.com"])).toBe(false);
	});

	it("matches localhost", () => {
		expect(shouldBypassProxy("localhost", ["localhost"])).toBe(true);
		expect(shouldBypassProxy("LOCALHOST", ["localhost"])).toBe(true);
	});

	it("matches IP addresses", () => {
		expect(shouldBypassProxy("127.0.0.1", ["127.0.0.1"])).toBe(true);
		expect(shouldBypassProxy("192.168.1.1", ["192.168.1.1"])).toBe(true);
	});

	it("checks all patterns in list", () => {
		const noProxy = ["localhost", "127.0.0.1", ".internal.corp"];

		expect(shouldBypassProxy("localhost", noProxy)).toBe(true);
		expect(shouldBypassProxy("127.0.0.1", noProxy)).toBe(true);
		expect(shouldBypassProxy("api.internal.corp", noProxy)).toBe(true);
		expect(shouldBypassProxy("external.com", noProxy)).toBe(false);
	});
});

describe("getProxyForUrl", () => {
	it("returns undefined when no proxy configured", () => {
		const config = { noProxy: [] };

		expect(getProxyForUrl("https://example.com", config)).toBeUndefined();
	});

	it("returns HTTPS proxy for HTTPS URLs", () => {
		const config = {
			httpProxy: "http://http-proxy:8080",
			httpsProxy: "http://https-proxy:8443",
			noProxy: [],
		};

		expect(getProxyForUrl("https://example.com/path", config)).toBe("http://https-proxy:8443");
	});

	it("falls back to HTTP proxy for HTTPS URLs when no HTTPS proxy", () => {
		const config = {
			httpProxy: "http://http-proxy:8080",
			noProxy: [],
		};

		expect(getProxyForUrl("https://example.com/path", config)).toBe("http://http-proxy:8080");
	});

	it("returns HTTP proxy for HTTP URLs", () => {
		const config = {
			httpProxy: "http://http-proxy:8080",
			httpsProxy: "http://https-proxy:8443",
			noProxy: [],
		};

		expect(getProxyForUrl("http://example.com/path", config)).toBe("http://http-proxy:8080");
	});

	it("does not use HTTPS proxy for HTTP URLs", () => {
		const config = {
			httpsProxy: "http://https-proxy:8443",
			noProxy: [],
		};

		expect(getProxyForUrl("http://example.com/path", config)).toBeUndefined();
	});

	it("returns undefined for bypassed hosts", () => {
		const config = {
			httpProxy: "http://proxy:8080",
			httpsProxy: "http://proxy:8443",
			noProxy: ["localhost", ".internal.corp"],
		};

		expect(getProxyForUrl("https://localhost:3000", config)).toBeUndefined();
		expect(getProxyForUrl("https://api.internal.corp/v1", config)).toBeUndefined();
		expect(getProxyForUrl("https://external.com", config)).toBe("http://proxy:8443");
	});

	it("returns undefined for invalid URLs", () => {
		const config = {
			httpProxy: "http://proxy:8080",
			noProxy: [],
		};

		expect(getProxyForUrl("not-a-valid-url", config)).toBeUndefined();
	});

	it("returns undefined for non-HTTP protocols", () => {
		const config = {
			httpProxy: "http://proxy:8080",
			httpsProxy: "http://proxy:8443",
			noProxy: [],
		};

		expect(getProxyForUrl("ftp://example.com", config)).toBeUndefined();
		expect(getProxyForUrl("file:///path/to/file", config)).toBeUndefined();
	});

	it("reads from environment when config not provided", () => {
		const originalEnv = process.env;
		process.env = {
			...originalEnv,
			HTTPS_PROXY: "http://env-proxy:8443",
		};

		try {
			expect(getProxyForUrl("https://example.com")).toBe("http://env-proxy:8443");
		} finally {
			process.env = originalEnv;
		}
	});
});
