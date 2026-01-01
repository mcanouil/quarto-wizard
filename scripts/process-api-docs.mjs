#!/usr/bin/env node
/**
 * Post-process TypeDoc-generated API documentation for Quarto compatibility.
 *
 * This script:
 * 1. Merges flat TypeDoc output files into module-level pages.
 * 2. Extracts titles and descriptions from TypeDoc output.
 * 3. Removes breadcrumbs, horizontal rules, and re-export references.
 * 4. Adds submodule headers for hierarchy.
 * 5. Converts code blocks to Quarto format.
 * 6. Creates landing pages with Quarto listing.
 * 7. Generates the sidebar configuration files.
 * 8. Generates reference documentation from package.json.
 * 9. Updates docs/_variables.yml with the current version from package.json.
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync, readdirSync, mkdirSync, rmSync } from "node:fs";
import { resolve, dirname, basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const docsDir = resolve(rootDir, "docs");
const docsApiDir = resolve(docsDir, "api");
const docsRefDir = resolve(docsDir, "reference");
const coreOutputDir = resolve(docsApiDir, "core");
const packageJsonPath = resolve(rootDir, "package.json");
const variablesYmlPath = resolve(docsDir, "_variables.yml");

/**
 * Language to filename mapping for code blocks.
 */
const LANGUAGE_FILENAMES = {
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
 * Create the core package index page with Quarto listing.
 */
function createCoreIndex() {
	const content = `---
title: "@quarto-wizard/core"
description: "Core library for Quarto extension management."
listing:
  - id: modules
    contents: "*.qmd"
    type: table
    fields: [title, description]
    sort: title
    filter-ui: false
    sort-ui: false
---

The \`@quarto-wizard/core\` package provides the core functionality for managing Quarto extensions.
It handles archive extraction, filesystem operations, GitHub integration, registry access, and extension lifecycle operations.

## Modules

::: {#modules}
:::
`;

	writeFileSync(join(coreOutputDir, "index.qmd"), content, "utf-8");
	console.log("  Created core/index.qmd");
}

/**
 * Create the API landing page with Quarto listing.
 */
function createApiIndex() {
	const content = `---
title: "API Reference"
description: "Complete API reference for the Quarto Wizard packages."
listing:
  - id: packages
    contents: "*/index.qmd"
    type: table
    fields: [title, description]
    filter-ui: false
    sort-ui: false
---

This section contains the API documentation for the Quarto Wizard packages.

## Packages

::: {#packages}
:::
`;

	writeFileSync(join(docsApiDir, "index.qmd"), content, "utf-8");
	console.log("  Created api/index.qmd");
}

/**
 * Capitalise a string (first letter uppercase).
 * @param {string} str - The string to capitalise.
 * @returns {string} The capitalised string.
 */
function capitalise(str) {
	if (!str) return str;
	return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Extract metadata from TypeDoc markdown content.
 * @param {string} content - The file content.
 * @returns {{title: string, description: string}} Extracted metadata.
 */
function extractMetadata(content) {
	// First, clean up breadcrumbs to find the actual H1
	content = content.replace(
		/^\[?\*?\*?@quarto-wizard\/core\*?\*?\]?\([^)]*\)\n+\*{3}\n+(?:\[@quarto-wizard\/core\]\([^)]+\) \/ [^\n]+\n+)?/,
		"",
	);

	// Extract H1 title (e.g., "# archive" or "# archive/extract")
	const titleMatch = content.match(/^# ([^\n]+)/m);
	let title = titleMatch ? titleMatch[1].trim() : "";

	// Clean up title: remove path separators and capitalise
	// "archive/extract" -> "Extract", "archive" -> "Archive"
	const parts = title.split("/");
	title = capitalise(parts[parts.length - 1]);

	// Extract first paragraph after H1 as description (if any)
	// Skip lines that are not meaningful descriptions
	let description = "";
	const afterH1 = content.replace(/^[\s\S]*?^# [^\n]+\n+/m, "");
	const lines = afterH1.split("\n");
	for (const line of lines) {
		const trimmed = line.trim();
		// Skip empty lines, headings, markdown links, re-export lines, and markers
		if (
			!trimmed ||
			trimmed.startsWith("#") ||
			trimmed.startsWith("[") ||
			trimmed.startsWith("Re-exports") ||
			trimmed.startsWith("Defined in:") ||
			trimmed.startsWith("***") ||
			trimmed.startsWith("---") ||
			trimmed.startsWith("|") ||
			trimmed.startsWith("```")
		) {
			continue;
		}
		// Found a potential description line - must be actual text
		if (trimmed.length > 10) {
			description = trimmed;
			// Truncate long descriptions
			if (description.length > 100) {
				description = description.slice(0, 97) + "...";
			}
			break;
		}
	}

	return { title, description };
}

/**
 * Convert a code block from standard markdown to Quarto format.
 * @param {string} content - The file content.
 * @returns {string} The processed content.
 */
function convertCodeBlocks(content) {
	return content.replace(/```(\w+)\n/g, (match, lang) => {
		const filename = LANGUAGE_FILENAMES[lang.toLowerCase()];
		if (filename) {
			return `\`\`\`{.${lang} filename="${filename}"}\n`;
		}
		return match;
	});
}

/**
 * Remove the "References" section (re-exports) from content.
 * @param {string} content - The file content.
 * @returns {string} The cleaned content.
 */
function removeReferencesSection(content) {
	// Remove the entire "## References" section including all its ### subsections
	return content.replace(/^## References\n+(?:###[^\n]+\n+Re-exports[^\n]+\n+)+/m, "");
}

/**
 * Remove breadcrumbs and clutter from content.
 * @param {string} content - The file content.
 * @returns {string} The cleaned content.
 */
function removeClutter(content) {
	// Remove breadcrumb header (link to package + horizontal rule + breadcrumb path)
	content = content.replace(
		/^\[?\*?\*?@quarto-wizard\/core\*?\*?\]?\([^)]*\)\n+\*{3}\n+(?:\[@quarto-wizard\/core\]\([^)]+\) \/ [^\n]+\n+)?/,
		"",
	);

	// Remove standalone horizontal rules
	content = content.replace(/^\*{3}\n+/gm, "\n");

	// Remove H1 heading (we use frontmatter title instead)
	content = content.replace(/^# [^\n]+\n+/, "");

	// Remove References section (re-exports)
	content = removeReferencesSection(content);

	// Clean up multiple consecutive blank lines
	content = content.replace(/\n{3,}/g, "\n\n");

	return content.trim();
}

/**
 * Update internal links from .md to .qmd and fix paths.
 * @param {string} content - The file content.
 * @param {string[]} moduleNames - List of known module names.
 * @returns {string} The processed content.
 */
function updateLinks(content, moduleNames) {
	// Update .md extensions to .qmd
	content = content.replace(/\.md([)#])/g, ".qmd$1");

	// Update README.md/README.qmd references to index.qmd
	content = content.replace(/README\.qmd/g, "index.qmd");

	// Fix cross-module links (e.g., archive.extract.qmd -> archive.qmd)
	for (const mod of moduleNames) {
		const subModulePattern = new RegExp(`\\(${mod}\\.([^.]+)\\.qmd(#[^)]+)?\\)`, "g");
		content = content.replace(subModulePattern, `(${mod}.qmd$2)`);
	}

	return content;
}

/**
 * Generate frontmatter for a module page.
 * @param {string} title - The module title.
 * @param {string} description - The module description.
 * @returns {string} The YAML frontmatter.
 */
function generateFrontmatter(title, description) {
	if (description) {
		return `---
title: "${title}"
description: "${description}"
---

`;
	}

	return `---
title: "${title}"
---

`;
}

/**
 * Find all markdown files in the docs/api directory.
 * @returns {string[]} Array of file paths.
 */
function findMarkdownFiles() {
	if (!existsSync(docsApiDir)) {
		return [];
	}

	return readdirSync(docsApiDir)
		.filter((f) => f.endsWith(".md"))
		.map((f) => join(docsApiDir, f));
}

/**
 * Group files by top-level module.
 * @param {string[]} files - Array of file paths.
 * @returns {Map<string, string[]>} Map of module name to file paths.
 */
function groupFilesByModule(files) {
	const groups = new Map();

	for (const file of files) {
		const name = basename(file, ".md");

		// Skip README and index - handled separately
		if (name === "README" || name === "index") {
			continue;
		}

		// Extract top-level module (e.g., "archive" from "archive.extract")
		const topLevel = name.split(".")[0];

		if (!groups.has(topLevel)) {
			groups.set(topLevel, []);
		}
		groups.get(topLevel).push(file);
	}

	return groups;
}

/**
 * Get submodule header for a file.
 * @param {string} fileName - The file name without extension.
 * @param {string} moduleName - The parent module name.
 * @param {string} content - The raw file content (for extracting title).
 * @returns {{header: string|null, title: string}} The header and extracted title.
 */
function getSubmoduleInfo(fileName, moduleName, content) {
	// Main module file has no submodule header
	if (fileName === moduleName) {
		return { header: null, title: "" };
	}

	// Extract title from TypeDoc H1
	const { title } = extractMetadata(content);
	const displayName = title || capitalise(fileName.split(".").pop());

	return { header: `## ${displayName}`, title: displayName };
}

/**
 * Merge multiple files into a single module page.
 * @param {string} moduleName - The module name.
 * @param {string[]} files - Files to merge.
 * @param {string[]} allModuleNames - All module names for link fixing.
 * @returns {string} The merged content.
 */
function mergeModuleFiles(moduleName, files, allModuleNames) {
	// Sort files: main module first, then submodules alphabetically
	files.sort((a, b) => {
		const nameA = basename(a, ".md");
		const nameB = basename(b, ".md");

		// Main module file comes first
		if (nameA === moduleName) return -1;
		if (nameB === moduleName) return 1;

		return nameA.localeCompare(nameB);
	});

	const sections = [];
	let moduleTitle = capitalise(moduleName);
	let moduleDescription = "";

	for (const file of files) {
		const fileName = basename(file, ".md");
		const rawContent = readFileSync(file, "utf-8");

		// Extract metadata from main module file
		if (fileName === moduleName) {
			const meta = extractMetadata(rawContent);
			moduleTitle = meta.title || moduleTitle;
			moduleDescription = meta.description;
		}

		// Clean up the content
		let content = removeClutter(rawContent);
		content = convertCodeBlocks(content);
		content = updateLinks(content, allModuleNames);

		if (content.trim()) {
			const { header } = getSubmoduleInfo(fileName, moduleName, rawContent);
			if (header) {
				// Add submodule header and indent existing headings
				// Must replace in reverse order to avoid double replacement
				content = content.replace(/^### /gm, "#### ");
				content = content.replace(/^## /gm, "### ");
				sections.push(`${header}\n\n${content}`);
			} else {
				sections.push(content);
			}
		}
	}

	// Generate frontmatter and combine sections
	const frontmatter = generateFrontmatter(moduleTitle, moduleDescription);
	return frontmatter + sections.join("\n\n") + "\n";
}

/**
 * Generate the sidebar configuration file.
 * @param {string[]} moduleNames - List of module names.
 */
function generateSidebar(moduleNames) {
	const sortedModules = [...moduleNames].sort();
	const moduleEntries = sortedModules.map((mod) => `                - api/core/${mod}.qmd`).join("\n");

	const content = `website:
  sidebar:
    - id: api
      style: docked
      collapse-level: 2
      contents:
        - section: "API Reference"
          href: api/index.qmd
          contents:
            - section: "@quarto-wizard/core"
              href: api/core/index.qmd
              contents:
${moduleEntries}
`;

	writeFileSync(join(docsDir, "_sidebar-api.yml"), content, "utf-8");
	console.log("  Created _sidebar-api.yml");
}

// =============================================================================
// Reference Documentation Generation
// =============================================================================

/**
 * Command grouping configuration.
 * Commands are grouped by their ID prefix patterns.
 */
const COMMAND_GROUPS = [
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
 * Configuration grouping by setting prefix.
 */
const CONFIG_GROUPS = [
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
 * Read and parse package.json.
 * @returns {object} Parsed package.json content.
 */
function readPackageJson() {
	const content = readFileSync(packageJsonPath, "utf-8");
	return JSON.parse(content);
}

/**
 * Get all commands from package.json.
 * @param {object} pkg - Parsed package.json.
 * @returns {Map<string, object>} Map of command ID to command object.
 */
function getDocumentedCommands(pkg) {
	const commands = new Map();

	// Build map of all commands
	for (const cmd of pkg.contributes?.commands || []) {
		commands.set(cmd.command, cmd);
	}

	return commands;
}

/**
 * Generate the commands reference page.
 * @param {object} pkg - Parsed package.json.
 */
function generateCommandsPage(pkg) {
	const commands = getDocumentedCommands(pkg);
	const lines = [
		"---",
		'title: "Commands Reference"',
		"---",
		"",
		"This page documents all commands provided by Quarto Wizard.",
		"",
	];

	// Generate sections for each command group
	for (const group of COMMAND_GROUPS) {
		lines.push(`## ${group.title}`, "");
		if (group.description) {
			lines.push(group.description, "");
		}

		for (const cmdId of group.commands) {
			const cmd = commands.get(cmdId);
			if (!cmd) continue;

			lines.push(`### ${cmd.title}`, "");
			lines.push(`**Command**: \`${cmd.category}: ${cmd.title}\``, "");

			// Generate description from command metadata
			const desc = generateCommandDescription(cmd);
			if (desc) {
				lines.push(desc, "");
			}
		}
	}

	// Add keyboard shortcuts section
	lines.push(
		"## Keyboard Shortcuts",
		"",
		"By default, Quarto Wizard does not define keyboard shortcuts.",
		"You can add custom keybindings in VS Code's Keyboard Shortcuts settings.",
		"",
		"Example keybinding for installing extensions:",
		"",
		"```json",
		"{",
		'  "key": "ctrl+shift+q",',
		'  "command": "quartoWizard.installExtension"',
		"}",
		"```",
		"",
	);

	// Add command identifiers table
	lines.push("## Command Identifiers", "");
	lines.push("For scripting or keybinding purposes, here are the internal command identifiers:", "");

	for (const group of COMMAND_GROUPS) {
		const groupCommands = group.commands.map((id) => commands.get(id)).filter(Boolean);
		if (groupCommands.length === 0) continue;

		lines.push(`### ${group.title}`, "");
		lines.push("| Display Name | Command ID |");
		lines.push("|--------------|------------|");

		for (const cmd of groupCommands) {
			lines.push(`| ${cmd.title} | \`${cmd.command}\` |`);
		}
		lines.push("");
	}

	const content = lines.join("\n");
	writeFileSync(join(docsRefDir, "commands.qmd"), content, "utf-8");
	console.log("  Created reference/commands.qmd");
}

/**
 * Generate a description for a command based on its metadata.
 * @param {object} cmd - Command object from package.json.
 * @returns {string} Generated description.
 */
function generateCommandDescription(cmd) {
	const descriptions = {
		"quartoWizard.installExtension":
			"Opens the extension browser to browse and install Quarto extensions from the registry.",
		"quartoWizard.useTemplate": "Opens the template browser to select and install Quarto templates.",
		"quartoWizard.newQuartoReprex": "Creates a new reproducible example document for R, Python, or Julia.",
		"quartoWizard.showOutput": "Displays the extension's output log for debugging and troubleshooting.",
		"quartoWizard.clearRecent": "Clears the list of recently installed extensions and templates.",
		"quartoWizard.clearCache": "Clears the cached registry data to force a fresh download.",
		"quartoWizard.getExtensionsDetails": "Retrieves detailed information about extensions in the current workspace.",
		"quartoWizard.installExtensionFromRegistry": "Install an extension by entering its registry identifier.",
		"quartoWizard.installExtensionFromURL": "Install an extension from a direct URL to a `.zip` or `.tar.gz` archive.",
		"quartoWizard.installExtensionFromLocal": "Install an extension from a local directory or archive file.",
		"quartoWizard.setGitHubToken": "Manually set a GitHub personal access token for authentication.",
		"quartoWizard.clearGitHubToken": "Remove the manually set GitHub token.",
		"quartoWizard.extensionsInstalled.refresh": "Reload the list of installed extensions in the Explorer View.",
		"quartoWizard.extensionsInstalled.update": "Update a specific extension to its latest version.",
		"quartoWizard.extensionsInstalled.updateAll": "Update all outdated extensions in the workspace.",
		"quartoWizard.extensionsInstalled.remove": "Remove a specific extension from the workspace.",
		"quartoWizard.extensionsInstalled.removeMultiple": "Select and remove multiple extensions at once.",
		"quartoWizard.extensionsInstalled.openSource": "Open the extension's GitHub repository in a browser.",
		"quartoWizard.extensionsInstalled.revealInExplorer": "Open the extension's folder in the file explorer.",
	};

	return descriptions[cmd.command] || "";
}

/**
 * Generate the configuration reference page.
 * @param {object} pkg - Parsed package.json.
 */
function generateConfigurationPage(pkg) {
	const properties = pkg.contributes?.configuration?.properties || {};
	const lines = [
		"---",
		'title: "Configuration Reference"',
		"---",
		"",
		"Quarto Wizard can be configured through VS Code settings.",
		'Access these through **File** > **Preferences** > **Settings** (or **Code** > **Preferences** > **Settings** on macOS) and search for "Quarto Wizard".',
		"",
	];

	// Group properties by prefix
	for (const group of CONFIG_GROUPS) {
		const groupProps = Object.entries(properties).filter(([key]) => key.startsWith(group.prefix));

		if (groupProps.length === 0) continue;

		lines.push(`## ${group.title}`, "");

		for (const [key, prop] of groupProps) {
			const title = generateSettingTitle(key);
			lines.push(`### ${title}`, "");
			lines.push(`**Setting**: \`${key}\``, "");

			// Add description
			const desc = prop.markdownDescription || prop.description || "";
			if (desc) {
				// Clean up markdown description
				const cleanDesc = desc.replace(/`([^`]+)`/g, "`$1`");
				lines.push(cleanDesc, "");
			}

			// Generate property table based on type
			if (prop.enum) {
				lines.push("| Value | Description |");
				lines.push("|-------|-------------|");
				for (const value of prop.enum) {
					const valueDesc = generateEnumDescription(key, value, prop.default);
					lines.push(`| \`${value}\` | ${valueDesc} |`);
				}
				lines.push("");
			} else if (prop.type === "number") {
				lines.push("| Property | Value |");
				lines.push("|----------|-------|");
				lines.push(`| Type | Number |`);
				if (prop.default !== undefined) {
					lines.push(`| Default | \`${prop.default}\` |`);
				}
				if (prop.minimum !== undefined) {
					lines.push(`| Minimum | \`${prop.minimum}\` |`);
				}
				if (prop.maximum !== undefined) {
					const maxLabel = prop.maximum === 1440 ? `\`1440\` (24 hours)` : `\`${prop.maximum}\``;
					lines.push(`| Maximum | ${maxLabel} |`);
				}
				lines.push("");
			} else if (prop.type === "string" && prop.format === "uri") {
				lines.push("| Property | Value |");
				lines.push("|----------|-------|");
				lines.push(`| Type | String (URI) |`);
				if (prop.default) {
					lines.push(`| Default | \`${prop.default}\` |`);
				}
				lines.push("");
			}

			// Add example JSON
			const exampleValue = prop.type === "string" ? `"${prop.default}"` : prop.default;
			lines.push("```json", "{", `  "${key}": ${exampleValue}`, "}", "```", "");
		}
	}

	// Add workspace vs user settings section
	lines.push(
		"## Workspace vs User Settings",
		"",
		'All Quarto Wizard settings are scoped to "resource", meaning they can be configured at:',
		"",
		"- **User level**: Applies to all workspaces.",
		"- **Workspace level**: Applies only to the current workspace.",
		"- **Folder level**: Applies only to a specific folder in a multi-root workspace.",
		"",
		"Folder settings override workspace settings, which override user settings.",
		"",
	);

	// Add example configuration
	lines.push("## Example Configuration", "");
	lines.push("Here is an example `settings.json` with all Quarto Wizard settings:", "");
	lines.push("```json", "{");

	const allProps = Object.entries(properties).sort(([, a], [, b]) => (a.order || 99) - (b.order || 99));
	const lastIndex = allProps.length - 1;
	allProps.forEach(([key, prop], index) => {
		const value = prop.type === "string" ? `"${prop.default}"` : prop.default;
		const comma = index < lastIndex ? "," : "";
		lines.push(`  "${key}": ${value}${comma}`);
	});

	lines.push("}", "```", "");

	const content = lines.join("\n");
	writeFileSync(join(docsRefDir, "configuration.qmd"), content, "utf-8");
	console.log("  Created reference/configuration.qmd");
}

/**
 * Generate a human-readable title from a setting key.
 * @param {string} key - Setting key (e.g., "quartoWizard.ask.trustAuthors").
 * @returns {string} Human-readable title.
 */
function generateSettingTitle(key) {
	const titles = {
		"quartoWizard.ask.trustAuthors": "Trust Authors",
		"quartoWizard.ask.confirmInstall": "Confirm Installation",
		"quartoWizard.cache.ttlMinutes": "Cache Duration",
		"quartoWizard.registry.url": "Registry URL",
		"quartoWizard.log.level": "Log Level",
	};

	return titles[key] || key.split(".").pop();
}

/**
 * Generate a description for an enum value.
 * @param {string} key - Setting key.
 * @param {string} value - Enum value.
 * @param {string} defaultValue - Default value for the setting.
 * @returns {string} Description for the enum value.
 */
function generateEnumDescription(key, value, defaultValue) {
	const isDefault = value === defaultValue;
	const defaultSuffix = isDefault ? " (default)." : ".";

	const descriptions = {
		"quartoWizard.ask.trustAuthors": {
			ask: `Ask for confirmation each time${defaultSuffix}`,
			never: `Always trust authors without prompting${defaultSuffix}`,
		},
		"quartoWizard.ask.confirmInstall": {
			ask: `Ask for confirmation each time${defaultSuffix}`,
			never: `Install without prompting${defaultSuffix}`,
		},
		"quartoWizard.log.level": {
			error: `Only log errors${defaultSuffix}`,
			warn: `Log warnings and errors${defaultSuffix}`,
			info: `Log info, warnings, and errors${defaultSuffix}`,
			debug: `Log everything, including debug information${defaultSuffix}`,
		},
	};

	return descriptions[key]?.[value] || capitalise(value) + defaultSuffix;
}

/**
 * Generate the reference index page.
 * @param {object} pkg - Parsed package.json.
 */
function generateReferenceIndex(pkg) {
	const commands = getDocumentedCommands(pkg);
	const properties = pkg.contributes?.configuration?.properties || {};

	const lines = [
		"---",
		'title: "Reference"',
		"---",
		"",
		"This section provides detailed reference documentation for Quarto Wizard.",
		"",
		"## Commands",
		"",
		"Quarto Wizard provides a comprehensive set of commands for managing Quarto extensions.",
		"See [Commands Reference](commands.qmd) for the complete list.",
		"",
		"### Quick Reference",
		"",
		"| Command | Description |",
		"|---------|-------------|",
	];

	// Add quick reference for primary commands
	const primaryCommands = COMMAND_GROUPS[0].commands;
	for (const cmdId of primaryCommands) {
		const cmd = commands.get(cmdId);
		if (!cmd) continue;
		const desc = generateCommandDescription(cmd);
		if (desc) {
			lines.push(`| ${cmd.title} | ${desc} |`);
		}
	}

	// Add installation commands
	const installCommands = COMMAND_GROUPS[1].commands;
	for (const cmdId of installCommands) {
		const cmd = commands.get(cmdId);
		if (!cmd) continue;
		const desc = generateCommandDescription(cmd);
		if (desc) {
			lines.push(`| ${cmd.title} | ${desc} |`);
		}
	}

	lines.push(
		"",
		"## Configuration",
		"",
		"Customise Quarto Wizard's behaviour through VS Code settings.",
		"See [Configuration Reference](configuration.qmd) for all available options.",
		"",
		"### Quick Reference",
		"",
		"| Setting | Default | Description |",
		"|---------|---------|-------------|",
	);

	// Add configuration quick reference
	const sortedProps = Object.entries(properties).sort(([, a], [, b]) => (a.order || 99) - (b.order || 99));
	for (const [key, prop] of sortedProps) {
		const defaultVal = key === "quartoWizard.registry.url" ? "(see docs)" : `\`${prop.default}\``;
		const desc = generateSettingQuickDesc(key);
		lines.push(`| \`${key}\` | ${defaultVal} | ${desc} |`);
	}

	lines.push(
		"",
		"## API Reference",
		"",
		"For developers integrating with the `@quarto-wizard/core` package, see the [API Reference](../api/index.qmd).",
		"",
		"The API documentation is generated from TypeScript source code using TypeDoc.",
		"",
	);

	const content = lines.join("\n");
	writeFileSync(join(docsRefDir, "index.qmd"), content, "utf-8");
	console.log("  Created reference/index.qmd");
}

/**
 * Generate a quick description for a setting.
 * @param {string} key - Setting key.
 * @returns {string} Quick description.
 */
function generateSettingQuickDesc(key) {
	const descriptions = {
		"quartoWizard.ask.trustAuthors": "Prompt before trusting authors.",
		"quartoWizard.ask.confirmInstall": "Prompt before installing.",
		"quartoWizard.cache.ttlMinutes": "Cache duration in minutes.",
		"quartoWizard.registry.url": "Custom registry URL.",
		"quartoWizard.log.level": "Logging verbosity.",
	};

	return descriptions[key] || "";
}

/**
 * Generate the reference sidebar configuration.
 */
function generateReferenceSidebar() {
	const content = `website:
  sidebar:
    - id: reference
      style: docked
      collapse-level: 2
      contents:
        - section: "Reference"
          href: reference/index.qmd
          contents:
            - reference/commands.qmd
            - reference/configuration.qmd
`;

	writeFileSync(join(docsDir, "_sidebar-reference.yml"), content, "utf-8");
	console.log("  Created _sidebar-reference.yml");
}

/**
 * Process reference documentation.
 */
function processReferenceDocs() {
	console.log("\nGenerating reference documentation...");

	// Create reference output directory if it doesn't exist
	if (!existsSync(docsRefDir)) {
		mkdirSync(docsRefDir, { recursive: true });
	}

	// Read package.json
	const pkg = readPackageJson();

	// Generate reference pages
	generateCommandsPage(pkg);
	generateConfigurationPage(pkg);
	generateReferenceIndex(pkg);

	// Generate sidebar
	generateReferenceSidebar();

	console.log("Reference documentation generated successfully.");
}

/**
 * Update the _variables.yml file with the current version from package.json.
 */
function updateVariablesYml() {
	console.log("\nUpdating _variables.yml...");

	// Read package.json to get version
	const pkg = readPackageJson();
	const version = pkg.version;

	if (!version) {
		console.error("Error: No version found in package.json.");
		return;
	}

	// Create _variables.yml content
	const content = `version: ${version}\n`;

	// Write the file
	writeFileSync(variablesYmlPath, content, "utf-8");
	console.log(`  Updated _variables.yml with version: ${version}`);
}

// =============================================================================
// Main Processing
// =============================================================================

/**
 * Main processing function.
 */
function processApiDocs() {
	if (!existsSync(docsApiDir)) {
		console.error(`Error: ${docsApiDir} not found.`);
		console.error("Run 'npm run docs:api' first to generate TypeDoc output.");
		process.exit(1);
	}

	const mdFiles = findMarkdownFiles();

	if (mdFiles.length === 0) {
		console.error("Error: No markdown files found in docs/api.");
		console.error("Run 'npm run docs:api' first to generate TypeDoc output.");
		process.exit(1);
	}

	console.log(`Found ${mdFiles.length} TypeDoc-generated files.`);

	// Group files by module
	const moduleGroups = groupFilesByModule(mdFiles);
	const allModuleNames = [...moduleGroups.keys()];

	console.log(`Merging into ${moduleGroups.size} module pages...`);

	// Create core output directory
	if (existsSync(coreOutputDir)) {
		rmSync(coreOutputDir, { recursive: true });
	}
	mkdirSync(coreOutputDir, { recursive: true });

	// Process each module
	const moduleNames = [];
	for (const [moduleName, files] of moduleGroups) {
		const merged = mergeModuleFiles(moduleName, files, allModuleNames);
		const outputPath = join(coreOutputDir, `${moduleName}.qmd`);
		writeFileSync(outputPath, merged, "utf-8");
		moduleNames.push(moduleName);
		console.log(`  ${moduleName}.qmd (merged ${files.length} files)`);
	}

	// Create landing pages
	createCoreIndex();
	createApiIndex();

	// Generate sidebar
	generateSidebar(moduleNames);

	// Clean up original markdown files
	console.log("\nCleaning up original files...");
	for (const file of mdFiles) {
		unlinkSync(file);
	}

	// Also remove README.md if it exists
	const readmePath = join(docsApiDir, "README.md");
	if (existsSync(readmePath)) {
		unlinkSync(readmePath);
	}

	console.log(`\nProcessed ${moduleGroups.size} modules successfully.`);
}

processApiDocs();
processReferenceDocs();
updateVariablesYml();
