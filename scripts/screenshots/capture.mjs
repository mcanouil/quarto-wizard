#!/usr/bin/env node
/**
 * Captures the VS Code screenshots of the documentation and the walkthrough, as described by the
 * scene files in scripts/screenshots/scenes.
 *
 * Usage: node scripts/screenshots/capture.mjs [scene ...]
 * Without scene names, every scene runs. Run `npm run webpack` first.
 *
 * Each scene launches its own VS Code window from one downloaded build, with a fresh copy of the
 * sample project and a window of 1280 x 800 pixels at a 2x scale. It runs the steps, captures the
 * dark image, switches the theme and captures the light image, so the pair matches except for
 * colours. A scene writes only the files its `outputs` name.
 *
 * Set GITHUB_TOKEN to check updates against GitHub; without it the view reports the registry.
 * The output depends on the screen and the fonts, so the script is a tool to refresh the images by
 * hand, not a test. It needs a display, network access, and the Quarto CLI.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_REGISTRY_URL, startRegistry } from "./lib/registry.mjs";
import { loadScenes, selectScenes } from "./lib/scene.mjs";
import { runScenes } from "./lib/session.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const scenes = selectScenes(loadScenes(path.join(repo, "scripts", "screenshots", "scenes")), process.argv.slice(2));

if (!fs.existsSync(path.join(repo, "dist", "extension.js"))) {
	throw new Error("dist/extension.js is missing. Run `npm run webpack` first.");
}

const registry = await startRegistry(DEFAULT_REGISTRY_URL);
try {
	await runScenes(scenes, { repo, registryUrl: registry.url });
} finally {
	await registry.close();
}
