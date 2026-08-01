/**
 * @title Quarto Ignore Module
 * @description Reading and matching `.quartoignore` patterns.
 *
 * `.quartoignore` lists paths a repository keeps out of Quarto's view, most commonly a
 * documentation website that ships its own `_quarto.yml` and `_extensions/`. Tooling that
 * scans a repository for Quarto projects should skip those paths.
 *
 * @module filesystem
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { minimatch } from "minimatch";

/** Name of the ignore file. */
export const QUARTOIGNORE_FILENAME = ".quartoignore";

/**
 * Read and normalise the patterns declared in a directory's `.quartoignore`.
 *
 * Comments (`#`), blank lines, and surrounding whitespace are stripped, as are leading
 * `./` and `/` and trailing `/`, so `docs/`, `/docs` and `docs` are equivalent.
 * Negation (`!`) is not part of Quarto's format and such lines are dropped.
 *
 * @param dir - Directory holding the `.quartoignore` file
 * @returns Normalised patterns, or an empty array when the file is absent or unreadable
 *
 * @example
 * ```typescript
 * const patterns = readQuartoIgnore("./my-extension");
 * // [".scratch", "docs"]
 * ```
 */
export function readQuartoIgnore(dir: string): string[] {
	let content: string;
	try {
		content = fs.readFileSync(path.join(dir, QUARTOIGNORE_FILENAME), "utf8");
	} catch {
		// Missing or unreadable ignore file: nothing is ignored.
		return [];
	}

	const patterns: string[] = [];
	for (const line of content.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("!")) {
			continue;
		}
		const normalised = trimmed.replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/+$/, "");
		if (normalised !== "") {
			patterns.push(normalised);
		}
	}
	return patterns;
}

/**
 * Check whether a path is covered by `.quartoignore` patterns.
 *
 * Every ancestor of `relativePath` is tested, so an ignored directory also hides everything
 * below it. Patterns containing no separator are additionally matched against each individual
 * segment, so `_site` matches at any depth; patterns containing a separator stay anchored to
 * the directory holding the `.quartoignore`.
 *
 * @param patterns - Normalised patterns from {@link readQuartoIgnore}
 * @param relativePath - POSIX-separated path relative to the directory holding the ignore file
 * @returns True when the path is ignored
 *
 * @example
 * ```typescript
 * isQuartoIgnored(["docs"], "docs/_extensions/mcanouil/gitlink"); // true
 * ```
 */
export function isQuartoIgnored(patterns: readonly string[], relativePath: string): boolean {
	if (patterns.length === 0) {
		return false;
	}

	const segments = relativePath.split("/").filter((segment) => segment !== "" && segment !== ".");
	if (segments.length === 0) {
		// The directory holding the ignore file cannot ignore itself.
		return false;
	}

	for (const pattern of patterns) {
		const anchored = pattern.includes("/");
		for (let depth = 1; depth <= segments.length; depth++) {
			const prefix = segments.slice(0, depth).join("/");
			if (minimatch(prefix, pattern, { dot: true })) {
				return true;
			}
			if (!anchored && minimatch(segments[depth - 1], pattern, { dot: true })) {
				return true;
			}
		}
	}

	return false;
}
