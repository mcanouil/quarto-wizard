/**
 * The two path rules Quarto and the `typst-render` filter resolve against.
 *
 * They are separate rules and they are easy to conflate. `preamble`, `file` and
 * `brand` resolve a relative path against the document, and `font-path` and
 * `package-path` leave one relative for the working directory of the compile to
 * decide. Conflating the two reads a file from the wrong directory in every
 * project whose documents are not at its root.
 *
 * No `vscode` here, the way nothing under `src/utils/typst/` imports it, so both
 * the metadata reader and the command line builder can use the same rule.
 */

import * as path from "node:path";

/** Where one document sits, which is what every path here resolves against. */
export interface TypstPaths {
	/** The project root that owns the document, when one does. */
	projectRoot?: string;
	/** The directory holding the document, when it is a file on disk. */
	documentDirectory?: string;
}

/**
 * A path Quarto resolves against a document or a project,
 * `_modules/paths.lua:34-48` and `src/project/project-shared.ts:574-584`.
 *
 * A leading `/` means the project root, and every other path is relative to the
 * directory passed in. Undefined when there is no directory to resolve against,
 * which is a document that lives outside every project root.
 */
export function resolveQuartoPath(
	quartoPath: string,
	from: string | undefined,
	projectRoot: string | undefined,
): string | undefined {
	const fromProjectRoot = quartoPath.startsWith("/");
	const base = fromProjectRoot ? projectRoot : from;
	return base === undefined ? undefined : path.join(base, fromProjectRoot ? quartoPath.slice(1) : quartoPath);
}

/**
 * A `font-path` or `package-path` as the filter resolves it,
 * `_modules/paths.lua:34-48`.
 *
 * A leading `/` means the project root, and every other path is returned
 * unchanged: the filter leaves it relative, so it resolves against the working
 * directory of the compile. `compileCwd` is what makes that the same directory
 * here as it is under a render.
 */
export function resolveProjectPath(quartoPath: string, projectRoot: string | undefined): string {
	if (!quartoPath.startsWith("/")) {
		return quartoPath;
	}
	return path.join(projectRoot ?? "", quartoPath.slice(1));
}

/**
 * The compile root, `typst-render.lua:1195` and `:931-953`.
 *
 * The `root` option, resolved the way `preamble` and `file` are: a leading `/`
 * means the project root, and every other value is relative to the document
 * directory. The default is `.`, which is the document directory itself.
 *
 * Undefined when the value names a place this cannot find, which is a document
 * that is neither in a project nor a file on disk. The root confines every read
 * a compile makes, so a guess would either widen it past the document or point
 * it somewhere the document never names.
 */
export function resolveCompileRoot(root: string | undefined, paths: TypstPaths): string | undefined {
	const value = root === undefined || root === "" ? "." : root;
	return resolveQuartoPath(value, paths.documentDirectory ?? paths.projectRoot, paths.projectRoot);
}

/**
 * The directory a compile runs from.
 *
 * The project root, because that is where Quarto runs Typst from under a render
 * and because a relative `font-path` is left relative and resolves against it.
 */
export function compileCwd(paths: TypstPaths): string | undefined {
	return paths.projectRoot ?? paths.documentDirectory;
}
