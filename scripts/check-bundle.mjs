#!/usr/bin/env node
/**
 * Loads the production bundle and makes sure that it exports `activate`.
 *
 * The production bundle is the artefact that ships, and nothing else loads it.
 * `vscode-test` runs the TypeScript output in `out/`.
 * The Extension Development Host runs the development bundle.
 * A fault that only the production build carries therefore reaches the
 * Marketplace while every check stays green.
 * Version 3.6.0 shipped that way.
 * The minifier joined three statements of a dependency into one call.
 * The bundle threw an error while it evaluated, so no command registered.
 *
 * The `vscode` module exists only inside the extension host.
 * A proxy stands in for it, and the proxy answers any property, call, or
 * construction.
 */

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Module from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bundlePath = join(__dirname, "..", "dist", "extension.js");

if (!existsSync(bundlePath)) {
	console.error(`No bundle exists at ${bundlePath}.`);
	console.error("Run `npx webpack --mode production`, then run this check again.");
	process.exit(1);
}

const stubHandler = {
	get: (_target, property) => (property === "then" ? undefined : stub()),
	apply: () => stub(),
	construct: () => stub(),
};

function stub() {
	return new Proxy(function () {}, stubHandler);
}

const load = Module._load;
Module._load = function (request, parent, isMain) {
	return request === "vscode" ? stub() : load.call(this, request, parent, isMain);
};

let bundle;
try {
	bundle = createRequire(import.meta.url)(bundlePath);
} catch (error) {
	console.error(`The production bundle threw an error while it loaded: ${error.message}`);
	console.error(error.stack);
	console.error("The bundle is broken and the extension cannot activate. Do not publish it.");
	process.exit(1);
}

if (typeof bundle.activate !== "function") {
	console.error("The production bundle loaded, but it exports no `activate` function.");
	console.error("The extension cannot activate. Do not publish it.");
	process.exit(1);
}

console.log("The production bundle loads and exports `activate`.");
