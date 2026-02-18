/**
 * TypeDoc configuration with custom block tags.
 *
 * This extends the default TypeDoc configuration with custom JSDoc tags
 * used in the @quarto-wizard/core package documentation.
 */

import { OptionDefaults } from "typedoc";

/** @type {Partial<import("typedoc").TypeDocOptions>} */
const config = {
	entryPoints: ["packages/schema/src", "packages/core/src"],
	entryPointStrategy: "expand",
	exclude: ["**/index.ts"],
	tsconfig: "packages/core/tsconfig.json",
	out: "docs/api",
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

export default config;
