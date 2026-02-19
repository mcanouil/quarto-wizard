/**
 * TypeDoc configuration with custom block tags.
 *
 * This extends the default TypeDoc configuration with custom JSDoc tags
 * used in the @quarto-wizard packages documentation.
 *
 * Exports both a default config (core) and a factory function for per-package configs.
 */

import { OptionDefaults } from "typedoc";

/** Shared TypeDoc options across all packages. */
const sharedOptions = {
	entryPointStrategy: "expand",
	exclude: ["**/index.ts"],
	plugin: ["typedoc-plugin-markdown"],
	membersWithOwnFile: [],
	flattenOutputFiles: true,
	readme: "none",
	excludePrivate: true,
	excludeProtected: true,
	excludeInternal: true,
	hideGenerator: true,
	useCodeBlocks: true,
	parametersFormat: "table",
	interfacePropertiesFormat: "table",

	// Extend default block tags with custom ones
	blockTags: [
		...OptionDefaults.blockTags,
		"@title",
		"@description",
		"@envvar",
		"@pattern",
		"@note",
	],
};

/**
 * Create a TypeDoc config for a specific package.
 *
 * @param {string} packageDir - Relative path to the package (e.g., "packages/schema").
 * @param {string} outDir - Output directory for the generated docs.
 * @returns {Partial<import("typedoc").TypeDocOptions>}
 */
export function createConfig(packageDir, outDir = "docs/api") {
	return {
		...sharedOptions,
		entryPoints: [`${packageDir}/src`],
		tsconfig: `${packageDir}/tsconfig.json`,
		out: outDir,
	};
}

/** @type {Partial<import("typedoc").TypeDocOptions>} */
const config = createConfig("packages/core");

export default config;
