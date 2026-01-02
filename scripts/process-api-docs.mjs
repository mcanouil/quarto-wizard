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
import { dirname, basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	packages,
	languageFilenames,
	envVarSources,
	commandGroups,
	configGroups,
	paths,
} from "./docs-config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const {
	docsDir,
	docsApiDir,
	docsRefDir,
	templatesDir,
	packageJsonPath,
	variablesYmlPath,
	changelogMdPath,
	changelogQmdPath,
} = paths;

// Get the first (core) package output directory
const corePackage = packages[0];
const coreOutputDir = corePackage.outputDir;

/**
 * Read a template file from the templates directory.
 *
 * @param {string} templateName - Name of the template file (e.g., "api-index.qmd")
 * @returns {string} Template content
 */
function readTemplate(templateName) {
	const templatePath = join(templatesDir, templateName);
	if (!existsSync(templatePath)) {
		throw new Error(`Template not found: ${templatePath}`);
	}
	return readFileSync(templatePath, "utf-8");
}

/**
 * Write content from a template with placeholder replacements.
 *
 * @param {string} templateName - Name of the template file
 * @param {string} outputPath - Path to write the output file
 * @param {Record<string, string>} replacements - Placeholder replacements
 */
function writeFromTemplate(templateName, outputPath, replacements = {}) {
	let content = readTemplate(templateName);
	for (const [placeholder, value] of Object.entries(replacements)) {
		content = content.replace(new RegExp(`\\{\\{${placeholder}\\}\\}`, "g"), value);
	}
	writeFileSync(outputPath, content, "utf-8");
}

/**
 * Parse @description tag from a TypeScript source file's module-level JSDoc.
 *
 * @param {string} filePath - Path to the TypeScript file
 * @returns {string|null} Description text or null if not found
 */
function parseDescriptionFromSource(filePath) {
	if (!existsSync(filePath)) {
		return null;
	}

	const content = readFileSync(filePath, "utf-8");

	// Extract the module-level JSDoc comment
	const jsdocMatch = content.match(/^\/\*\*[\s\S]*?\*\//m);
	if (!jsdocMatch) {
		return null;
	}

	const jsdoc = jsdocMatch[0];

	// Extract @description tag
	const descMatch = jsdoc.match(/@description\s+([^\n@]+)/);
	if (descMatch) {
		return descMatch[1].trim();
	}

	return null;
}

// ENV_VAR_SOURCES is now imported from docs-config.mjs as envVarSources

/**
 * Parse environment variable documentation from a TypeScript source file.
 * Extracts @envvar, @example, @pattern, and @note tags from JSDoc.
 *
 * @param {string} filePath - Path to the TypeScript file
 * @returns {object|null} Parsed documentation or null if not found
 */
function parseEnvVarDocumentation(filePath) {
	const content = readFileSync(filePath, "utf-8");

	// Extract the module-level JSDoc comment
	const jsdocMatch = content.match(/^\/\*\*[\s\S]*?\*\//m);
	if (!jsdocMatch) {
		return null;
	}

	const jsdoc = jsdocMatch[0];

	// Extract description (lines before first @tag)
	const descLines = [];
	const lines = jsdoc.split("\n");
	for (const line of lines) {
		const trimmed = line.replace(/^\s*\*\s?/, "").trim();
		if (trimmed.startsWith("@") || trimmed === "/**" || trimmed === "*/") continue;
		if (trimmed) descLines.push(trimmed);
	}
	const description = descLines.slice(0, 2).join(" "); // First two meaningful lines

	// Extract @envvar tags
	const envvars = [];
	const envvarRegex = /@envvar\s+(\S+)\s+-\s+(.+)/g;
	let match;
	while ((match = envvarRegex.exec(jsdoc)) !== null) {
		envvars.push({ name: match[1], description: match[2].trim() });
	}

	// Extract @example tags with their code blocks
	const examples = [];
	const exampleRegex = /@example\s+([^\n]+)\n\s*\*\s*```(\w+)\n([\s\S]*?)\n\s*\*\s*```/g;
	while ((match = exampleRegex.exec(jsdoc)) !== null) {
		examples.push({
			title: match[1].trim(),
			language: match[2],
			code: match[3]
				.split("\n")
				.map((l) => l.replace(/^\s*\*\s?/, ""))
				.join("\n")
				.trim(),
		});
	}

	// Extract @pattern tags
	const patterns = [];
	const patternRegex = /@pattern\s+(\S+)\s+-\s+(.+)/g;
	while ((match = patternRegex.exec(jsdoc)) !== null) {
		patterns.push({ pattern: match[1], description: match[2].trim() });
	}

	// Extract @note tags
	const notes = [];
	const noteRegex = /@note\s+(.+)/g;
	while ((match = noteRegex.exec(jsdoc)) !== null) {
		notes.push(match[1].trim());
	}

	// Extract precedence note (standalone line mentioning precedence)
	const precedencePatterns = [/\b\w+\s+takes precedence[^@]*/, /The uppercase variants[^@]*/];
	let precedenceNote = "";
	for (const pattern of precedencePatterns) {
		const precedenceMatch = jsdoc.match(pattern);
		if (precedenceMatch) {
			precedenceNote = precedenceMatch[0].replace(/\s*\*\s*/g, " ").trim();
			break;
		}
	}

	return { description, envvars, examples, patterns, notes, precedenceNote };
}

/**
 * Generate a section for a single environment variable source.
 *
 * @param {object} source - Source configuration { path, section, id }
 * @returns {string[]} Lines of markdown documentation
 */
function generateEnvVarSection(source) {
	const doc = parseEnvVarDocumentation(source.path);
	if (!doc || doc.envvars.length === 0) {
		return [];
	}

	const lines = [`## ${source.section}`, ""];

	// Description
	if (doc.description) {
		lines.push(doc.description, "");
	}

	// Environment variables table
	lines.push("### Variables", "");
	lines.push("| Variable | Description |");
	lines.push("|----------|-------------|");

	// Group by base name for case variants (HTTP_PROXY/http_proxy, etc.)
	const grouped = new Map();
	for (const env of doc.envvars) {
		const baseName = env.name.toUpperCase();
		if (!grouped.has(baseName)) {
			grouped.set(baseName, { upper: null, lower: null, description: "" });
		}
		const entry = grouped.get(baseName);
		if (env.name === env.name.toUpperCase()) {
			entry.upper = env.name;
			entry.description = env.description;
		} else {
			entry.lower = env.name;
		}
	}

	for (const [, entry] of grouped) {
		const varName = entry.lower ? `\`${entry.upper}\` or \`${entry.lower}\`` : `\`${entry.upper}\``;
		lines.push(`| ${varName} | ${entry.description} |`);
	}
	lines.push("");

	// Precedence note
	if (doc.precedenceNote) {
		lines.push(doc.precedenceNote, "");
	}

	// Examples
	if (doc.examples.length > 0) {
		lines.push("### Examples", "");
		lines.push(`\`\`\`${doc.examples[0].language}`);
		for (const example of doc.examples) {
			lines.push(`# ${example.title}`);
			lines.push(example.code);
			lines.push("");
		}
		// Remove trailing empty line inside code block
		if (lines[lines.length - 1] === "") {
			lines.pop();
		}
		lines.push("```", "");
	}

	// Patterns table (for proxy NO_PROXY patterns)
	if (doc.patterns.length > 0) {
		lines.push("### NO_PROXY Patterns", "");
		lines.push("The `NO_PROXY` variable supports several pattern formats.", "");
		lines.push("| Pattern | Matches |");
		lines.push("|---------|---------|");
		for (const p of doc.patterns) {
			lines.push(`| \`${p.pattern}\` | ${p.description} |`);
		}
		lines.push("");
	}

	// Notes as callouts
	for (const note of doc.notes) {
		lines.push("::: {.callout-note}");
		lines.push(note);
		lines.push(":::", "");
	}

	return lines;
}

/**
 * Generate the environment variables reference page.
 */
function generateEnvironmentVariablesPage() {
	// Generate sections from each source
	const sectionLines = [];
	for (const source of envVarSources) {
		sectionLines.push(...generateEnvVarSection(source));
	}

	writeFromTemplate("reference-environment-variables.qmd", join(docsRefDir, "environment-variables.qmd"), {
		ENV_VAR_SECTIONS: sectionLines.join("\n"),
	});
	console.log("  Created reference/environment-variables.qmd");
}

// LANGUAGE_FILENAMES is now imported from docs-config.mjs as languageFilenames

/**
 * Create a package index page with Quarto listing.
 * @param {object} pkg - Package configuration from docs-config.mjs.
 */
function createPackageIndex(pkg) {
	writeFromTemplate("api-package-index.qmd", join(pkg.outputDir, "index.qmd"), {
		PACKAGE_NAME: pkg.name,
		PACKAGE_DESCRIPTION: pkg.description,
		PACKAGE_OVERVIEW: pkg.overview,
	});
	console.log(`  Created ${pkg.shortName}/index.qmd`);
}

/**
 * Create the API landing page with Quarto listing.
 */
function createApiIndex() {
	writeFromTemplate("api-index.qmd", join(docsApiDir, "index.qmd"), {});
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
 * Convert a code block from standard markdown to Quarto format.
 * @param {string} content - The file content.
 * @returns {string} The processed content.
 */
function convertCodeBlocks(content) {
	return content.replace(/```(\w+)\n/g, (match, lang) => {
		const filename = languageFilenames[lang.toLowerCase()];
		if (filename) {
			return `\`\`\`{.${lang} filename="${filename}"}\n`;
		}
		return match;
	});
}

/**
 * Fix array type formatting from TypeDoc.
 * TypeDoc outputs "`string`[]" but we want "`string[]`".
 * @param {string} content - The file content.
 * @returns {string} The processed content.
 */
function fixArrayTypes(content) {
	// Fix patterns like `Type`[] to `Type[]`
	return content.replace(/`([^`]+)`\[\]/g, "`$1[]`");
}

/**
 * Add blank lines before and after lists for proper markdown formatting.
 * @param {string} content - The file content.
 * @returns {string} The processed content.
 */
function addBlankLinesAroundLists(content) {
	const lines = content.split("\n");
	const output = [];
	let inList = false;
	let prevLineEmpty = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();
		const isListItem = /^[-*+]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed);
		const currentLineEmpty = trimmed === "";

		// Entering a list
		if (isListItem && !inList) {
			// Add blank line before list if previous line wasn't empty
			if (output.length > 0 && !prevLineEmpty) {
				output.push("");
			}
			inList = true;
		}

		// Exiting a list
		if (!isListItem && !currentLineEmpty && inList) {
			// Add blank line after list
			output.push("");
			inList = false;
		}

		// Reset list state on empty line (but keep going)
		if (currentLineEmpty && inList) {
			// Check if next line is also a list item
			const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : "";
			const nextIsListItem = /^[-*+]\s/.test(nextLine) || /^\d+\.\s/.test(nextLine);
			if (!nextIsListItem) {
				inList = false;
			}
		}

		output.push(line);
		prevLineEmpty = currentLineEmpty;
	}

	return output.join("\n");
}

/**
 * Convert escaped TypeDoc type expressions to cleaner format.
 * Handles both simple types and types with links.
 *
 * Examples:
 * - `Promise`\<`void`\> -> `Promise<void>`
 * - `Promise`\<[`Registry`](types.qmd#registry)\> -> HTML with proper link
 *
 * @param {string} content - The file content.
 * @returns {string} The processed content.
 */
function cleanTypeExpressions(content) {
	// Pattern for escaped generic types with potential links
	// Matches: `TypeName`\<...\>
	const typePattern = /`([A-Za-z]+)`\\<(.+?)\\>/g;

	return content.replace(typePattern, (_match, typeName, innerContent) => {
		// Check if inner content has markdown links
		const hasLinks = innerContent.includes("](");

		if (!hasLinks) {
			// Simple case: just clean up the escapes
			// Convert `void` to void, remove \ escapes
			let cleaned = innerContent.replace(/`([^`]+)`/g, "$1").replace(/\\/g, "");
			return `\`${typeName}<${cleaned}>\``;
		}

		// Complex case with links: convert to HTML
		// Parse the inner content for links and types
		let htmlContent = innerContent
			// Convert markdown links to HTML: [`Type`](url) -> <a href="url">Type</a>
			.replace(/\[`([^`]+)`\]\(([^)]+)\)/g, '<a href="$2" style="text-decoration-line: underline; text-decoration-style: dashed; text-decoration-thickness: 1px; text-decoration-color: currentColor;">$1</a>')
			// Convert remaining backtick types to plain text
			.replace(/`([^`]+)`/g, "$1")
			// Convert escaped pipes to HTML entity
			.replace(/\s*\\\|\s*/g, " | ")
			// Remove remaining backslashes
			.replace(/\\/g, "")

		// Escape < and > for HTML
		return "```{=html}\n<code>" + typeName + "&lt;" + htmlContent + "&gt;</code>\n```";
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
 * Transform TypeDoc content for a submodule.
 * Extracts title and description, removes their sections, and demotes headings.
 *
 * @param {string} content - The raw TypeDoc content.
 * @returns {{title: string, description: string, content: string}} Transformed result.
 */
function transformSubmoduleContent(content) {
	// Remove breadcrumb header (link to package + horizontal rule + breadcrumb path)
	content = content.replace(
		/^\[?\*?\*?@quarto-wizard\/core\*?\*?\]?\([^)]*\)\n+\*{3}\n+(?:\[@quarto-wizard\/core\]\([^)]+\) \/ [^\n]+\n+)?/,
		"",
	);

	// Remove standalone horizontal rules
	content = content.replace(/^\*{3}\n+/gm, "\n");

	// Remove H1 heading (module name goes to YAML title)
	content = content.replace(/^# [^\n]+\n+/m, "");

	// Extract ## Title content
	let title = "";
	const titleMatch = content.match(/^## Title\n+([^\n]+)/m);
	if (titleMatch) {
		title = titleMatch[1].trim();
		// Remove the ## Title section
		content = content.replace(/^## Title\n+[^\n]+\n+/m, "");
	}

	// Extract ## Description content (may be multiple paragraphs until next ##)
	let description = "";
	const descMatch = content.match(/^## Description\n+([\s\S]*?)(?=^##|\n*$)/m);
	if (descMatch) {
		description = descMatch[1].trim();
		// Remove the ## Description section
		content = content.replace(/^## Description\n+[\s\S]*?(?=^##|\n*$)/m, "");
	}

	// Remove References section (re-exports)
	content = removeReferencesSection(content);

	// Clean up multiple consecutive blank lines
	content = content.replace(/\n{3,}/g, "\n\n");

	return { title, description, content: content.trim() };
}

/**
 * Update internal links from .md to .qmd and fix paths.
 * Handles both dot-separated (archive.extract.qmd) and hyphen-numbered (archive-1.qmd) patterns.
 *
 * @param {string} content - The file content.
 * @param {string[]} moduleNames - List of known module names.
 * @returns {string} The processed content.
 */
function updateLinks(content, moduleNames) {
	// Update .md extensions to .qmd
	content = content.replace(/\.md([)#])/g, ".qmd$1");

	// Update README.md/README.qmd references to index.qmd
	content = content.replace(/README\.qmd/g, "index.qmd");

	// Fix cross-module links with dot separator (e.g., archive.extract.qmd -> archive.qmd)
	for (const mod of moduleNames) {
		const subModulePattern = new RegExp(`\\(${mod}\\.([^.]+)\\.qmd(#[^)]+)?\\)`, "g");
		content = content.replace(subModulePattern, `(${mod}.qmd$2)`);
	}

	// Fix cross-module links with hyphen-number suffix (e.g., github-1.qmd -> github.qmd)
	for (const mod of moduleNames) {
		const hyphenPattern = new RegExp(`\\(${mod}-\\d+\\.qmd(#[^)]+)?\\)`, "g");
		content = content.replace(hyphenPattern, `(${mod}.qmd$1)`);
	}

	return content;
}

/**
 * Generate frontmatter for a module page.
 * @param {string} title - The module title.
 * @returns {string} The YAML frontmatter.
 */
function generateFrontmatter(title) {
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
 * Handles both dot-separated names (archive.extract.md) and
 * hyphen-numbered names (archive-1.md) from TypeDoc's flattenOutputFiles.
 *
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

		// Extract top-level module name:
		// - "archive.extract" -> "archive" (dot separator)
		// - "archive-1" -> "archive" (hyphen-number suffix from flattenOutputFiles)
		// - "archive" -> "archive" (plain name)
		let topLevel = name.split(".")[0];
		// Remove -N suffix if present (e.g., "archive-1" -> "archive")
		topLevel = topLevel.replace(/-\d+$/, "");

		if (!groups.has(topLevel)) {
			groups.set(topLevel, []);
		}
		groups.get(topLevel).push(file);
	}

	return groups;
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

	for (const file of files) {
		const rawContent = readFileSync(file, "utf-8");

		// Transform the content - extract title, description, and clean content
		const transformed = transformSubmoduleContent(rawContent);

		// Process the content
		let content = transformed.content;
		content = convertCodeBlocks(content);
		content = fixArrayTypes(content);
		content = updateLinks(content, allModuleNames);
		content = cleanTypeExpressions(content);
		content = addBlankLinesAroundLists(content);

		if (content.trim()) {
			// Demote all headings by one level (must replace in reverse order)
			content = content.replace(/^#### /gm, "##### ");
			content = content.replace(/^### /gm, "#### ");
			content = content.replace(/^## /gm, "### ");

			// Build section with H2 title and description
			const sectionTitle = transformed.title || capitalise(moduleName);
			const sectionDesc = transformed.description;

			let sectionContent = `## ${sectionTitle}\n\n`;
			if (sectionDesc) {
				sectionContent += `${sectionDesc}\n\n`;
			}
			sectionContent += content;

			sections.push(sectionContent);
		}
	}

	// Generate frontmatter and combine sections
	const frontmatter = generateFrontmatter(moduleTitle);
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

// commandGroups and configGroups are now imported from docs-config.mjs as commandGroups and configGroups

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

	// Generate command sections
	const sectionLines = [];
	for (const group of commandGroups) {
		sectionLines.push(`## ${group.title}`, "");
		if (group.description) {
			sectionLines.push(group.description, "");
		}

		for (const cmdId of group.commands) {
			const cmd = commands.get(cmdId);
			if (!cmd) continue;

			sectionLines.push(`### ${cmd.title}`, "");
			sectionLines.push(`**Command**: \`${cmd.category}: ${cmd.title}\``, "");

			const desc = generateCommandDescription(cmd);
			if (desc) {
				sectionLines.push(desc, "");
			}
		}
	}

	// Generate command identifiers table
	const identifierLines = [];
	for (const group of commandGroups) {
		const groupCommands = group.commands.map((id) => commands.get(id)).filter(Boolean);
		if (groupCommands.length === 0) continue;

		identifierLines.push(`### ${group.title}`, "");
		identifierLines.push("| Display Name | Command ID |");
		identifierLines.push("|--------------|------------|");

		for (const cmd of groupCommands) {
			identifierLines.push(`| ${cmd.title} | \`${cmd.command}\` |`);
		}
		identifierLines.push("");
	}

	writeFromTemplate("reference-commands.qmd", join(docsRefDir, "commands.qmd"), {
		COMMAND_SECTIONS: sectionLines.join("\n"),
		COMMAND_IDENTIFIERS_TABLE: identifierLines.join("\n"),
	});
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

	// Generate config sections
	const sectionLines = [];
	for (const group of configGroups) {
		const groupProps = Object.entries(properties).filter(([key]) => key.startsWith(group.prefix));

		if (groupProps.length === 0) continue;

		sectionLines.push(`## ${group.title}`, "");

		for (const [key, prop] of groupProps) {
			const title = generateSettingTitle(key);
			sectionLines.push(`### ${title}`, "");
			sectionLines.push(`**Setting**: \`${key}\``, "");

			// Add description
			const desc = prop.markdownDescription || prop.description || "";
			if (desc) {
				const cleanDesc = desc.replace(/`([^`]+)`/g, "`$1`");
				sectionLines.push(cleanDesc, "");
			}

			// Generate property table based on type
			if (prop.enum) {
				sectionLines.push("| Value | Description |");
				sectionLines.push("|-------|-------------|");
				for (const value of prop.enum) {
					const valueDesc = generateEnumDescription(key, value, prop.default);
					sectionLines.push(`| \`${value}\` | ${valueDesc} |`);
				}
				sectionLines.push("");
			} else if (prop.type === "number") {
				sectionLines.push("| Property | Value |");
				sectionLines.push("|----------|-------|");
				sectionLines.push(`| Type | Number |`);
				if (prop.default !== undefined) {
					sectionLines.push(`| Default | \`${prop.default}\` |`);
				}
				if (prop.minimum !== undefined) {
					sectionLines.push(`| Minimum | \`${prop.minimum}\` |`);
				}
				if (prop.maximum !== undefined) {
					const maxLabel = prop.maximum === 1440 ? `\`1440\` (24 hours)` : `\`${prop.maximum}\``;
					sectionLines.push(`| Maximum | ${maxLabel} |`);
				}
				sectionLines.push("");
			} else if (prop.type === "string" && prop.format === "uri") {
				sectionLines.push("| Property | Value |");
				sectionLines.push("|----------|-------|");
				sectionLines.push(`| Type | String (URI) |`);
				if (prop.default) {
					sectionLines.push(`| Default | \`${prop.default}\` |`);
				}
				sectionLines.push("");
			}

			// Add example JSON
			const exampleValue = prop.type === "string" ? `"${prop.default}"` : prop.default;
			sectionLines.push("```json", "{", `  "${key}": ${exampleValue}`, "}", "```", "");
		}
	}

	// Generate example configuration
	const exampleLines = ["```json", "{"];
	const allProps = Object.entries(properties).sort(([, a], [, b]) => (a.order || 99) - (b.order || 99));
	const lastIndex = allProps.length - 1;
	allProps.forEach(([key, prop], index) => {
		const value = prop.type === "string" ? `"${prop.default}"` : prop.default;
		const comma = index < lastIndex ? "," : "";
		exampleLines.push(`  "${key}": ${value}${comma}`);
	});
	exampleLines.push("}", "```", "");

	writeFromTemplate("reference-configuration.qmd", join(docsRefDir, "configuration.qmd"), {
		CONFIG_SECTIONS: sectionLines.join("\n"),
		EXAMPLE_CONFIG: exampleLines.join("\n"),
	});
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

	// Generate commands table
	const commandsLines = ["| Command | Description |", "|---------|-------------|"];

	// Add quick reference for primary commands
	const primaryCommands = commandGroups[0].commands;
	for (const cmdId of primaryCommands) {
		const cmd = commands.get(cmdId);
		if (!cmd) continue;
		const desc = generateCommandDescription(cmd);
		if (desc) {
			commandsLines.push(`| ${cmd.title} | ${desc} |`);
		}
	}

	// Add installation commands
	const installCommands = commandGroups[1].commands;
	for (const cmdId of installCommands) {
		const cmd = commands.get(cmdId);
		if (!cmd) continue;
		const desc = generateCommandDescription(cmd);
		if (desc) {
			commandsLines.push(`| ${cmd.title} | ${desc} |`);
		}
	}

	// Generate configuration table
	const configLines = ["| Setting | Default | Description |", "|---------|---------|-------------|"];
	const sortedProps = Object.entries(properties).sort(([, a], [, b]) => (a.order || 99) - (b.order || 99));
	for (const [key, prop] of sortedProps) {
		const defaultVal = key === "quartoWizard.registry.url" ? "(see docs)" : `\`${prop.default}\``;
		const desc = generateSettingQuickDesc(key);
		configLines.push(`| \`${key}\` | ${defaultVal} | ${desc} |`);
	}

	writeFromTemplate("reference-index.qmd", join(docsRefDir, "index.qmd"), {
		COMMANDS_TABLE: commandsLines.join("\n"),
		CONFIGURATION_TABLE: configLines.join("\n"),
	});
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
            - reference/environment-variables.qmd
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
	generateEnvironmentVariablesPage();
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

/**
 * Generate changelog.qmd from CHANGELOG.md with nested version headers.
 * Converts version headers to nested structure:
 * - ## X.Y.Z -> # X, ## X.Y, ### X.Y.Z
 */
function generateChangelog() {
	console.log("\nGenerating changelog.qmd...");

	if (!existsSync(changelogMdPath)) {
		console.error(`Error: ${changelogMdPath} not found.`);
		return;
	}

	const content = readFileSync(changelogMdPath, "utf-8");
	const lines = content.split("\n");
	const output = [];

	// Add frontmatter
	output.push("---");
	output.push('title: "Changelog"');
	output.push("---");
	output.push("");

	let currentMajor = null;
	let currentMinor = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Skip the main "# Changelog" heading
		if (i === 0 && line === "# Changelog") {
			continue;
		}

		// Match version headers like "## 1.0.2 (2025-12-06)"
		const versionMatch = line.match(/^## (\d+)\.(\d+)\.(\d+)\s*\(.*\)/);
		if (versionMatch) {
			const major = versionMatch[1];
			const minor = `${major}.${versionMatch[2]}`;

			// Add major version header if it's new
			if (currentMajor !== major) {
				output.push("");
				output.push(`# ${major}`);
				output.push("");
				currentMajor = major;
				currentMinor = null;
			}

			// Add minor version header if it's new
			if (currentMinor !== minor) {
				output.push(`## ${minor}`);
				output.push("");
				currentMinor = minor;
			}

			// Add patch version header
			output.push(`### ${line.substring(3)}`); // Remove "## " prefix
			continue;
		}

		// Pass through all other lines
		output.push(line);
	}

	// Write the file
	writeFileSync(changelogQmdPath, output.join("\n"), "utf-8");
	console.log("  Created changelog.qmd");
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
	createPackageIndex(corePackage);
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
generateChangelog();
