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
 *
 * The `vscode` module exists only inside the extension host.
 * A proxy stands in for it, and the proxy answers any property, call, or
 * construction.
 */

import Module, { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const bundlePath = fileURLToPath(new URL("../dist/extension.js", import.meta.url));

function fail(...lines) {
	console.error(lines.join("\n"));
	process.exit(1);
}

if (!existsSync(bundlePath)) {
	fail(`No bundle exists at ${bundlePath}.`, "Run `npx webpack --mode production`, then run this check again.");
}

const stubHandler = {
	// A stub that answers `then` looks like a promise, and an `await` on it never settles.
	get: (_target, property) => (property === "then" ? undefined : stub),
	apply: () => stub,
	construct: () => stub,
};

const stub = new Proxy(function () {}, stubHandler);

const load = Module._load;
Module._load = function (request, parent, isMain) {
	return request === "vscode" ? stub : load.call(this, request, parent, isMain);
};

let bundle;
try {
	bundle = createRequire(import.meta.url)(bundlePath);
} catch (error) {
	fail(
		`The production bundle threw an error while it loaded: ${error.message}`,
		error.stack,
		"The bundle is broken and the extension cannot activate. Do not publish it.",
	);
}

for (const name of ["activate", "deactivate"]) {
	if (typeof bundle[name] !== "function") {
		fail(`The production bundle loaded, but it exports no \`${name}\` function.`, "Do not publish it.");
	}
}

console.log("The production bundle loads and exports `activate` and `deactivate`.");

// The bundle can register a handle as it loads, and an open handle would hold the job open.
process.exit(0);
