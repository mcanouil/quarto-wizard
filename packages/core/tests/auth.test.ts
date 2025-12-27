import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createAuthConfig, getAuthHeaders } from "../src/types/auth.js";

describe("createAuthConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env["GITHUB_TOKEN"];
    delete process.env["QUARTO_WIZARD_TOKEN"];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("creates empty config with no options", () => {
    const config = createAuthConfig();

    expect(config.githubToken).toBeUndefined();
    expect(config.httpHeaders).toEqual([]);
  });

  it("uses provided GitHub token", () => {
    const config = createAuthConfig({ githubToken: "test-token" });

    expect(config.githubToken).toBe("test-token");
  });

  it("reads GITHUB_TOKEN from environment", () => {
    process.env["GITHUB_TOKEN"] = "env-token";

    const config = createAuthConfig();

    expect(config.githubToken).toBe("env-token");
  });

  it("reads QUARTO_WIZARD_TOKEN from environment", () => {
    process.env["QUARTO_WIZARD_TOKEN"] = "wizard-token";

    const config = createAuthConfig();

    expect(config.githubToken).toBe("wizard-token");
  });

  it("prefers GITHUB_TOKEN over QUARTO_WIZARD_TOKEN", () => {
    process.env["GITHUB_TOKEN"] = "github-token";
    process.env["QUARTO_WIZARD_TOKEN"] = "wizard-token";

    const config = createAuthConfig();

    expect(config.githubToken).toBe("github-token");
  });

  it("prefers provided token over environment", () => {
    process.env["GITHUB_TOKEN"] = "env-token";

    const config = createAuthConfig({ githubToken: "provided-token" });

    expect(config.githubToken).toBe("provided-token");
  });

  it("parses HTTP headers", () => {
    const config = createAuthConfig({
      httpHeaders: ["Authorization: Bearer token123", "X-Custom: value"],
    });

    expect(config.httpHeaders).toHaveLength(2);
    expect(config.httpHeaders[0]).toEqual({
      name: "Authorization",
      value: "Bearer token123",
    });
    expect(config.httpHeaders[1]).toEqual({
      name: "X-Custom",
      value: "value",
    });
  });

  it("trims header names and values", () => {
    const config = createAuthConfig({
      httpHeaders: ["  Name  :  Value  "],
    });

    expect(config.httpHeaders[0]).toEqual({
      name: "Name",
      value: "Value",
    });
  });

  it("throws on invalid header format", () => {
    expect(() =>
      createAuthConfig({ httpHeaders: ["invalid-header"] })
    ).toThrow('Invalid header format: "invalid-header"');
  });

  it("handles headers with multiple colons", () => {
    const config = createAuthConfig({
      httpHeaders: ["Authorization: Bearer: token: value"],
    });

    expect(config.httpHeaders[0]).toEqual({
      name: "Authorization",
      value: "Bearer: token: value",
    });
  });
});

describe("getAuthHeaders", () => {
  it("returns empty object with no auth", () => {
    const headers = getAuthHeaders(undefined, false);

    expect(headers).toEqual({});
  });

  it("adds Authorization header for GitHub requests", () => {
    const auth = { githubToken: "test-token", httpHeaders: [] };

    const headers = getAuthHeaders(auth, true);

    expect(headers["Authorization"]).toBe("Bearer test-token");
  });

  it("does not add Authorization for non-GitHub requests", () => {
    const auth = { githubToken: "test-token", httpHeaders: [] };

    const headers = getAuthHeaders(auth, false);

    expect(headers["Authorization"]).toBeUndefined();
  });

  it("includes custom HTTP headers", () => {
    const auth = {
      githubToken: undefined,
      httpHeaders: [{ name: "X-Custom", value: "value" }],
    };

    const headers = getAuthHeaders(auth, false);

    expect(headers["X-Custom"]).toBe("value");
  });

  it("combines GitHub token and custom headers", () => {
    const auth = {
      githubToken: "test-token",
      httpHeaders: [{ name: "X-Custom", value: "value" }],
    };

    const headers = getAuthHeaders(auth, true);

    expect(headers["Authorization"]).toBe("Bearer test-token");
    expect(headers["X-Custom"]).toBe("value");
  });
});
