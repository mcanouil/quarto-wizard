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
		const normalised = trimmed.replace(/^\.?\/+/, "").replace(/\/+$/, "");
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
	// An empty path is the directory holding the ignore file, which cannot ignore itself.
	const segments = relativePath.split("/").filter((segment) => segment !== "" && segment !== ".");
	const prefixes = segments.map((_, index) => segments.slice(0, index + 1).join("/"));

	return patterns.some((pattern) => {
		// An anchored pattern is matched against whole prefixes only; an unanchored one is
		// matched against each segment, which is what makes it apply at any depth.
		const candidates = pattern.includes("/") ? prefixes : segments;
		return candidates.some((candidate) => minimatch(candidate, pattern, { dot: true }));
	});
}

/**
 * Convert `.quartoignore` patterns into globs matching the ignored paths and their contents.
 *
 * {@link isQuartoIgnored} is a predicate over one path; consumers that hand patterns to a
 * glob matcher need the same semantics expressed as globs instead. Each pattern yields the
 * path itself and everything below it, plus depth-independent variants for unanchored
 * patterns.
 *
 * @param patterns - Normalised patterns from {@link readQuartoIgnore}
 * @returns Glob patterns covering the ignored paths and their descendants
 *
 * @example
 * ```typescript
 * quartoIgnoreGlobs(["docs"]); // ["docs", "docs/**", "**\/docs", "**\/docs/**"]
 * ```
 */
export function quartoIgnoreGlobs(patterns: readonly string[]): string[] {
	const globs = new Set<string>();
	for (const pattern of patterns) {
		globs.add(pattern);
		globs.add(`${pattern}/**`);
		if (!pattern.includes("/")) {
			globs.add(`**/${pattern}`);
			globs.add(`**/${pattern}/**`);
		}
	}
	return [...globs];
}
