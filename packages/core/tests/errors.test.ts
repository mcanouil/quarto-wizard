import { describe, it, expect } from "vitest";
import {
  QuartoWizardError,
  ExtensionError,
  AuthenticationError,
  RepositoryNotFoundError,
  NetworkError,
  SecurityError,
  ManifestError,
  VersionError,
  isQuartoWizardError,
  wrapError,
} from "../src/errors.js";

describe("QuartoWizardError", () => {
  it("creates error with message and code", () => {
    const error = new QuartoWizardError("Test message", "TEST_CODE");

    expect(error.message).toBe("Test message");
    expect(error.code).toBe("TEST_CODE");
    expect(error.name).toBe("QuartoWizardError");
    expect(error.suggestion).toBeUndefined();
  });

  it("creates error with suggestion", () => {
    const error = new QuartoWizardError("Test", "CODE", "Try this instead");

    expect(error.suggestion).toBe("Try this instead");
  });

  it("formats error without suggestion", () => {
    const error = new QuartoWizardError("Test message", "CODE");

    expect(error.format()).toBe("QuartoWizardError: Test message");
  });

  it("formats error with suggestion", () => {
    const error = new QuartoWizardError("Test message", "CODE", "Try this");

    expect(error.format()).toContain("Suggestion: Try this");
  });

  it("is instanceof Error", () => {
    const error = new QuartoWizardError("Test", "CODE");

    expect(error instanceof Error).toBe(true);
  });
});

describe("ExtensionError", () => {
  it("creates error with correct name and code", () => {
    const error = new ExtensionError("Extension failed");

    expect(error.name).toBe("ExtensionError");
    expect(error.code).toBe("EXTENSION_ERROR");
    expect(error instanceof QuartoWizardError).toBe(true);
  });
});

describe("AuthenticationError", () => {
  it("creates error with default suggestion", () => {
    const error = new AuthenticationError("Auth failed");

    expect(error.name).toBe("AuthenticationError");
    expect(error.code).toBe("AUTH_ERROR");
    expect(error.suggestion).toContain("GITHUB_TOKEN");
  });
});

describe("RepositoryNotFoundError", () => {
  it("creates error with custom hint", () => {
    const error = new RepositoryNotFoundError("Not found", "Check spelling");

    expect(error.name).toBe("RepositoryNotFoundError");
    expect(error.code).toBe("NOT_FOUND");
    expect(error.suggestion).toBe("Check spelling");
  });

  it("uses default hint if not provided", () => {
    const error = new RepositoryNotFoundError("Not found");

    expect(error.suggestion).toContain("repository exists");
  });
});

describe("NetworkError", () => {
  it("creates error with status code", () => {
    const error = new NetworkError("Request failed", 404);

    expect(error.name).toBe("NetworkError");
    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.statusCode).toBe(404);
  });

  it("works without status code", () => {
    const error = new NetworkError("Request failed");

    expect(error.statusCode).toBeUndefined();
  });
});

describe("SecurityError", () => {
  it("creates error with correct name", () => {
    const error = new SecurityError("Path traversal detected");

    expect(error.name).toBe("SecurityError");
    expect(error.code).toBe("SECURITY_ERROR");
  });
});

describe("ManifestError", () => {
  it("creates error with manifest path", () => {
    const error = new ManifestError("Invalid manifest", "/path/to/_extension.yml");

    expect(error.name).toBe("ManifestError");
    expect(error.code).toBe("MANIFEST_ERROR");
    expect(error.manifestPath).toBe("/path/to/_extension.yml");
    expect(error.suggestion).toContain("/path/to/_extension.yml");
  });

  it("works without manifest path", () => {
    const error = new ManifestError("Invalid manifest");

    expect(error.manifestPath).toBeUndefined();
    expect(error.suggestion).toBeUndefined();
  });
});

describe("VersionError", () => {
  it("creates error with custom suggestion", () => {
    const error = new VersionError("Version not found", "Try latest");

    expect(error.name).toBe("VersionError");
    expect(error.code).toBe("VERSION_ERROR");
    expect(error.suggestion).toBe("Try latest");
  });
});

describe("isQuartoWizardError", () => {
  it("returns true for QuartoWizardError", () => {
    const error = new QuartoWizardError("Test", "CODE");

    expect(isQuartoWizardError(error)).toBe(true);
  });

  it("returns true for subclasses", () => {
    expect(isQuartoWizardError(new ExtensionError("Test"))).toBe(true);
    expect(isQuartoWizardError(new NetworkError("Test"))).toBe(true);
  });

  it("returns false for regular Error", () => {
    expect(isQuartoWizardError(new Error("Test"))).toBe(false);
  });

  it("returns false for non-errors", () => {
    expect(isQuartoWizardError("string")).toBe(false);
    expect(isQuartoWizardError(null)).toBe(false);
    expect(isQuartoWizardError(undefined)).toBe(false);
    expect(isQuartoWizardError({})).toBe(false);
  });
});

describe("wrapError", () => {
  it("returns QuartoWizardError unchanged", () => {
    const original = new ExtensionError("Original");
    const wrapped = wrapError(original);

    expect(wrapped).toBe(original);
  });

  it("wraps regular Error", () => {
    const wrapped = wrapError(new Error("Test error"));

    expect(wrapped instanceof QuartoWizardError).toBe(true);
    expect(wrapped.message).toBe("Test error");
    expect(wrapped.code).toBe("UNKNOWN_ERROR");
  });

  it("wraps string", () => {
    const wrapped = wrapError("String error");

    expect(wrapped.message).toBe("String error");
  });

  it("adds context prefix", () => {
    const wrapped = wrapError(new Error("Failed"), "Download");

    expect(wrapped.message).toBe("Download: Failed");
  });
});
