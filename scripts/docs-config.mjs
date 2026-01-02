/**
 * Configuration for API documentation processing.
 *
 * This file centralises all configuration values used by process-api-docs.mjs
 * to make the script package-agnostic and easier to maintain.
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

/**
 * Package configurations for API documentation.
 * Each package entry defines where TypeDoc output is located and where
 * processed files should be written.
 */
export const packages = [
	{
		name: "@quarto-wizard/core",
		shortName: "core",
		sourceDir: resolve(rootDir, "packages/core/src"),
		outputDir: resolve(rootDir, "docs/api/core"),
		description: "Core library for Quarto extension management.",
		overview:
			"The `@quarto-wizard/core` package provides the core functionality for managing Quarto extensions.\n" +
			"It handles archive extraction, filesystem operations, GitHub integration, registry access, and extension lifecycle operations.",
	},
];

/**
 * Language to filename mapping for code blocks.
 * Used to convert standard markdown code blocks to Quarto format
 * with descriptive filename labels.
 */
export const languageFilenames = {
	ts: "TypeScript",
	typescript: "TypeScript",
	js: "JavaScript",
	javascript: "JavaScript",
	json: "JSON",
	yaml: "YAML",
	yml: "YAML",
	bash: "Terminal",
	sh: "Terminal",
	shell: "Terminal",
};

/**
 * Abbreviations that should not be treated as sentence endings.
 * Used when extracting first sentence from descriptions.
 */
export const knownAbbreviations = ["TAR.GZ", "ZIP", "API", "CLI", "URL", "HTTP", "HTTPS", "YAML", "JSON", "HTML"];

/**
 * Environment variable source files configuration.
 * Each entry specifies a TypeScript file and the section title for its env vars.
 */
export const envVarSources = [
	{
		path: resolve(rootDir, "packages/core/src/types/auth.ts"),
		section: "Authentication",
		id: "auth",
	},
	{
		path: resolve(rootDir, "packages/core/src/proxy/config.ts"),
		section: "Proxy",
		id: "proxy",
	},
];

/**
 * Command grouping configuration for reference documentation.
 * Commands are grouped by their functional purpose.
 */
export const commandGroups = [
	{
		id: "primary",
		title: "Primary Commands",
		description: "These commands are available from the Command Palette.",
		commands: [
			"quartoWizard.installExtension",
			"quartoWizard.useTemplate",
			"quartoWizard.newQuartoReprex",
			"quartoWizard.showOutput",
			"quartoWizard.clearRecent",
			"quartoWizard.clearCache",
			"quartoWizard.getExtensionsDetails",
		],
	},
	{
		id: "installation",
		title: "Installation Commands",
		description: "Commands for installing extensions from different sources.",
		commands: [
			"quartoWizard.installExtensionFromRegistry",
			"quartoWizard.installExtensionFromURL",
			"quartoWizard.installExtensionFromLocal",
		],
	},
	{
		id: "authentication",
		title: "Authentication Commands",
		description: "Commands for managing GitHub authentication.",
		commands: ["quartoWizard.setGitHubToken", "quartoWizard.clearGitHubToken"],
	},
	{
		id: "explorer",
		title: "Explorer View Commands",
		description: "These commands are available from the Explorer View context menu or toolbar.",
		commands: [
			"quartoWizard.extensionsInstalled.refresh",
			"quartoWizard.extensionsInstalled.update",
			"quartoWizard.extensionsInstalled.updateAll",
			"quartoWizard.extensionsInstalled.remove",
			"quartoWizard.extensionsInstalled.removeMultiple",
			"quartoWizard.extensionsInstalled.openSource",
			"quartoWizard.extensionsInstalled.revealInExplorer",
		],
	},
];

/**
 * Configuration grouping by setting prefix for reference documentation.
 */
export const configGroups = [
	{
		id: "installation",
		title: "Installation Behaviour",
		prefix: "quartoWizard.ask.",
	},
	{
		id: "cache",
		title: "Cache Settings",
		prefix: "quartoWizard.cache.",
	},
	{
		id: "registry",
		title: "Registry Settings",
		prefix: "quartoWizard.registry.",
	},
	{
		id: "logging",
		title: "Logging",
		prefix: "quartoWizard.log.",
	},
];

/**
 * Directory paths used throughout the documentation processing.
 */
export const paths = {
	rootDir,
	docsDir: resolve(rootDir, "docs"),
	docsApiDir: resolve(rootDir, "docs/api"),
	docsRefDir: resolve(rootDir, "docs/reference"),
	templatesDir: resolve(rootDir, "docs/_templates"),
	packageJsonPath: resolve(rootDir, "package.json"),
	variablesYmlPath: resolve(rootDir, "docs/_variables.yml"),
	changelogMdPath: resolve(rootDir, "CHANGELOG.md"),
	changelogQmdPath: resolve(rootDir, "docs/changelog.qmd"),
};
