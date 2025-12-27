/**
 * Tests for extension update operations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { checkForUpdates, type UpdateInfo } from "../../src/operations/update.js";

vi.mock("../../src/registry/fetcher.js", () => ({
  fetchRegistry: vi.fn(),
}));

import { fetchRegistry } from "../../src/registry/fetcher.js";

describe("checkForUpdates", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qw-update-test-"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function setupExtension(
    owner: string,
    name: string,
    version: string,
    source?: string
  ): void {
    const extDir = path.join(tempDir, "_extensions", owner, name);
    fs.mkdirSync(extDir, { recursive: true });

    let manifest = `title: ${name}\nversion: ${version}\n`;
    if (source) {
      manifest += `source: ${source}\n`;
    }

    fs.writeFileSync(path.join(extDir, "_extension.yml"), manifest);
  }

  it("should find updates when newer version available", async () => {
    setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome@v1.0.0");

    vi.mocked(fetchRegistry).mockResolvedValue({
      "quarto-ext/fontawesome": {
        fullName: "quarto-ext/fontawesome",
        latestVersion: "2.0.0",
        latestTag: "v2.0.0",
        latestReleaseUrl: "https://github.com/quarto-ext/fontawesome/releases/tag/v2.0.0",
      },
    });

    const updates = await checkForUpdates({ projectDir: tempDir });

    expect(updates).toHaveLength(1);
    expect(updates[0].currentVersion).toBe("1.0.0");
    expect(updates[0].latestVersion).toBe("2.0.0");
    expect(updates[0].source).toBe("quarto-ext/fontawesome@v2.0.0");
  });

  it("should not find updates when already at latest", async () => {
    setupExtension("quarto-ext", "fontawesome", "2.0.0", "quarto-ext/fontawesome@v2.0.0");

    vi.mocked(fetchRegistry).mockResolvedValue({
      "quarto-ext/fontawesome": {
        fullName: "quarto-ext/fontawesome",
        latestVersion: "2.0.0",
        latestTag: "v2.0.0",
        latestReleaseUrl: null,
      },
    });

    const updates = await checkForUpdates({ projectDir: tempDir });

    expect(updates).toHaveLength(0);
  });

  it("should skip extensions without source", async () => {
    setupExtension("quarto-ext", "fontawesome", "1.0.0");

    vi.mocked(fetchRegistry).mockResolvedValue({
      "quarto-ext/fontawesome": {
        fullName: "quarto-ext/fontawesome",
        latestVersion: "2.0.0",
        latestTag: "v2.0.0",
        latestReleaseUrl: null,
      },
    });

    const updates = await checkForUpdates({ projectDir: tempDir });

    expect(updates).toHaveLength(0);
  });

  it("should skip extensions not in registry", async () => {
    setupExtension("unknown", "extension", "1.0.0", "unknown/extension");

    vi.mocked(fetchRegistry).mockResolvedValue({
      "quarto-ext/fontawesome": {
        fullName: "quarto-ext/fontawesome",
        latestVersion: "2.0.0",
        latestTag: "v2.0.0",
        latestReleaseUrl: null,
      },
    });

    const updates = await checkForUpdates({ projectDir: tempDir });

    expect(updates).toHaveLength(0);
  });

  it("should check specific extension when provided", async () => {
    setupExtension("quarto-ext", "fontawesome", "1.0.0", "quarto-ext/fontawesome");
    setupExtension("quarto-ext", "lightbox", "1.0.0", "quarto-ext/lightbox");

    vi.mocked(fetchRegistry).mockResolvedValue({
      "quarto-ext/fontawesome": {
        fullName: "quarto-ext/fontawesome",
        latestVersion: "2.0.0",
        latestTag: "v2.0.0",
        latestReleaseUrl: null,
      },
      "quarto-ext/lightbox": {
        fullName: "quarto-ext/lightbox",
        latestVersion: "2.0.0",
        latestTag: "v2.0.0",
        latestReleaseUrl: null,
      },
    });

    const updates = await checkForUpdates({
      projectDir: tempDir,
      extension: { owner: "quarto-ext", name: "fontawesome" },
    });

    expect(updates).toHaveLength(1);
    expect(updates[0].extension.id.name).toBe("fontawesome");
  });

  it("should handle version prefixed with v", async () => {
    setupExtension("quarto-ext", "fontawesome", "v1.0.0", "quarto-ext/fontawesome");

    vi.mocked(fetchRegistry).mockResolvedValue({
      "quarto-ext/fontawesome": {
        fullName: "quarto-ext/fontawesome",
        latestVersion: "v2.0.0",
        latestTag: "v2.0.0",
        latestReleaseUrl: null,
      },
    });

    const updates = await checkForUpdates({ projectDir: tempDir });

    expect(updates).toHaveLength(1);
    expect(updates[0].currentVersion).toBe("1.0.0");
    expect(updates[0].latestVersion).toBe("2.0.0");
  });

  it("should handle case-insensitive registry lookup", async () => {
    setupExtension("Quarto-Ext", "FontAwesome", "1.0.0", "Quarto-Ext/FontAwesome");

    vi.mocked(fetchRegistry).mockResolvedValue({
      "quarto-ext/fontawesome": {
        fullName: "quarto-ext/fontawesome",
        latestVersion: "2.0.0",
        latestTag: "v2.0.0",
        latestReleaseUrl: null,
      },
    });

    const updates = await checkForUpdates({ projectDir: tempDir });

    expect(updates).toHaveLength(1);
  });

  it("should return empty for no installed extensions", async () => {
    vi.mocked(fetchRegistry).mockResolvedValue({});

    const updates = await checkForUpdates({ projectDir: tempDir });

    expect(updates).toHaveLength(0);
  });
});
