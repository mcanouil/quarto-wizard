/**
 * Tests for extension installation operations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  parseInstallSource,
  formatInstallSource,
  type InstallSource,
} from "../../src/operations/install.js";

describe("parseInstallSource", () => {
  describe("GitHub sources", () => {
    it("should parse owner/repo format", () => {
      const result = parseInstallSource("quarto-ext/fontawesome");
      expect(result).toEqual({
        type: "github",
        owner: "quarto-ext",
        repo: "fontawesome",
        version: { type: "latest" },
      });
    });

    it("should parse owner/repo@tag format", () => {
      const result = parseInstallSource("quarto-ext/fontawesome@v1.0.0");
      expect(result).toEqual({
        type: "github",
        owner: "quarto-ext",
        repo: "fontawesome",
        version: { type: "tag", tag: "v1.0.0" },
      });
    });

    it("should parse owner/repo@branch format", () => {
      const result = parseInstallSource("quarto-ext/fontawesome@main");
      expect(result).toEqual({
        type: "github",
        owner: "quarto-ext",
        repo: "fontawesome",
        version: { type: "branch", branch: "main" },
      });
    });

    it("should throw for invalid format without owner", () => {
      expect(() => parseInstallSource("fontawesome")).toThrow(
        /Invalid extension reference/
      );
    });
  });

  describe("URL sources", () => {
    it("should parse https URL", () => {
      const result = parseInstallSource(
        "https://github.com/quarto-ext/fontawesome/archive/main.zip"
      );
      expect(result).toEqual({
        type: "url",
        url: "https://github.com/quarto-ext/fontawesome/archive/main.zip",
      });
    });

    it("should parse http URL", () => {
      const result = parseInstallSource(
        "http://example.com/extension.zip"
      );
      expect(result).toEqual({
        type: "url",
        url: "http://example.com/extension.zip",
      });
    });
  });

  describe("local sources", () => {
    it("should parse absolute path", () => {
      const result = parseInstallSource("/path/to/extension");
      expect(result).toEqual({
        type: "local",
        path: "/path/to/extension",
      });
    });

    it("should parse relative path starting with ./", () => {
      const result = parseInstallSource("./my-extension");
      expect(result).toEqual({
        type: "local",
        path: "./my-extension",
      });
    });

    it("should parse relative path starting with ../", () => {
      const result = parseInstallSource("../parent-extension");
      expect(result).toEqual({
        type: "local",
        path: "../parent-extension",
      });
    });

    it("should detect existing path as local", () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qw-test-"));
      try {
        const result = parseInstallSource(tempDir);
        expect(result).toEqual({
          type: "local",
          path: tempDir,
        });
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});

describe("formatInstallSource", () => {
  it("should format GitHub source without version", () => {
    const source: InstallSource = {
      type: "github",
      owner: "quarto-ext",
      repo: "fontawesome",
      version: { type: "latest" },
    };
    expect(formatInstallSource(source)).toBe("quarto-ext/fontawesome");
  });

  it("should format GitHub source with tag", () => {
    const source: InstallSource = {
      type: "github",
      owner: "quarto-ext",
      repo: "fontawesome",
      version: { type: "tag", tag: "v1.0.0" },
    };
    expect(formatInstallSource(source)).toBe("quarto-ext/fontawesome@v1.0.0");
  });

  it("should format GitHub source with branch", () => {
    const source: InstallSource = {
      type: "github",
      owner: "quarto-ext",
      repo: "fontawesome",
      version: { type: "branch", branch: "develop" },
    };
    expect(formatInstallSource(source)).toBe("quarto-ext/fontawesome@develop");
  });

  it("should format GitHub source with exact version", () => {
    const source: InstallSource = {
      type: "github",
      owner: "quarto-ext",
      repo: "fontawesome",
      version: { type: "exact", version: "1.0.0" },
    };
    expect(formatInstallSource(source)).toBe("quarto-ext/fontawesome@v1.0.0");
  });

  it("should format URL source", () => {
    const source: InstallSource = {
      type: "url",
      url: "https://example.com/extension.zip",
    };
    expect(formatInstallSource(source)).toBe("https://example.com/extension.zip");
  });

  it("should format local source", () => {
    const source: InstallSource = {
      type: "local",
      path: "/path/to/extension",
    };
    expect(formatInstallSource(source)).toBe("/path/to/extension");
  });
});
