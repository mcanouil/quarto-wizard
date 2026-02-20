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
 * 9. Updates docs/_environment with the current version from package.json.
 *
 * @module process-api-docs
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync, readdirSync, mkdirSync, rmSync } from "node:fs";
import { basename, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { OptionDefaults } from "typedoc";

// =============================================================================
// Configuration
// =============================================================================

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

const rawConfig = JSON.parse(readFileSync(resolve(__dirname, "docs-config.json"), "utf-8"));

const config = {
	...rawConfig,
	packages: rawConfig.packages.map((pkg) => ({
		...pkg,
		sourceDir: resolve(rootDir, pkg.sourceDir),
		outputDir: resolve(rootDir, pkg.outputDir),
	})),
	envVarSources: rawConfig.envVarSources.map((src) => ({
		...src,
		path: resolve(rootDir, src.path),
	})),
	paths: Object.fromEntries(Object.entries(rawConfig.paths).map(([key, value]) => [key, resolve(rootDir, value)])),
};

const typedocBlockTags = [...OptionDefaults.blockTags, "@title", "@description", "@envvar", "@pattern", "@note"];
config.paths.rootDir = rootDir;

const { packages, languageFilenames, envVarSources, commandGroups, configGroups, paths } = config;
const {
	docsDir,
	docsApiDir,
	docsRefDir,
	templatesDir,
	packageJsonPath,
	envVariablesPath,
	changelogMdPath,
	changelogQmdPath,
} = paths;

/** Shared style for HTML links in generated documentation. */
const HTML_LINK_STYLE =
	"text-decoration-line: underline; text-decoration-style: dashed; text-decoration-thickness: 1px; text-decoration-color: currentColor;";
const TYPE_DOC_SYMBOL_KINDS =
	"Class|Interface|TypeAlias|Function|Variable|Enumeration|Enum|Namespace|Constructor|Property|Method|Accessor";

// =============================================================================
// Utility Functions
// =============================================================================

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
 * Build a stable anchor id for merged TypeDoc symbol sections.
 * @param {string} kind - TypeDoc symbol kind (e.g., Interface, Function).
 * @param {string} symbolName - Symbol name.
 * @returns {string} Anchor id.
 */
function buildSymbolAnchorId(kind, symbolName) {
	return `symbol-${normaliseAnchorToken(kind)}-${normaliseAnchorToken(symbolName)}`;
}

/**
 * Normalise a token so it can be used safely in anchor IDs.
 * @param {string} value - Raw token value.
 * @returns {string} Normalised anchor token.
 */
function normaliseAnchorToken(value) {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/**
 * Build a stable anchor id for symbol members (constructor, properties, methods).
 * @param {string} kind - TypeDoc symbol kind (e.g., Class, Interface).
 * @param {string} symbolName - Symbol name.
 * @param {string} memberName - Member heading/fragment.
 * @returns {string} Member anchor id.
 */
function buildSymbolMemberAnchorId(kind, symbolName, memberName) {
	return `symbol-${normaliseAnchorToken(kind)}-${normaliseAnchorToken(symbolName)}-${normaliseAnchorToken(memberName)}`;
}

/**
 * Parse a merged TypeDoc symbol file name.
 * @param {string} moduleName - Top-level module name.
 * @param {string} fileBaseName - File base name without extension.
 * @returns {{kind: string, name: string, anchorId: string} | null} Parsed symbol info.
 */
function parseSymbolFileName(moduleName, fileBaseName) {
	const symbolPattern = new RegExp(`^${moduleName}\\.(${TYPE_DOC_SYMBOL_KINDS})\\.(.+)$`);
	const match = fileBaseName.match(symbolPattern);
	if (!match) return null;
	const kind = match[1];
	const name = match[2];
	return { kind, name, anchorId: buildSymbolAnchorId(kind, name) };
}

/**
 * Read a template file from the templates directory.
 * @param {string} templateName - Name of the template file (e.g., "api-index.qmd").
 * @returns {string} Template content.
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
 * @param {string} templateName - Name of the template file.
 * @param {string} outputPath - Path to write the output file.
 * @param {Record<string, string>} replacements - Placeholder replacements.
 */
function writeFromTemplate(templateName, outputPath, replacements = {}) {
	let content = readTemplate(templateName);
	for (const [placeholder, value] of Object.entries(replacements)) {
		content = content.replace(new RegExp(`\\{\\{${placeholder}\\}\\}`, "g"), value);
	}
	writeFileSync(outputPath, content, "utf-8");
}

/**
 * Read and parse package.json.
 * @returns {object} Parsed package.json content.
 */
function readPackageJson() {
	return JSON.parse(readFileSync(packageJsonPath, "utf-8"));
}

// =============================================================================
// Content Transformation Functions
// =============================================================================

/**
 * Convert code blocks from standard markdown to Quarto format.
 * @param {string} content - The file content.
 * @returns {string} The processed content.
 */
function convertCodeBlocks(content) {
	return content.replace(/```(\w+)\n/g, (match, lang) => {
		const filename = languageFilenames[lang.toLowerCase()];
		return filename ? `\`\`\`{.${lang} filename="${filename}"}\n` : match;
	});
}

/**
 * Fix array type formatting from TypeDoc.
 * TypeDoc outputs "`string`[]" but we want "`string[]`".
 * @param {string} content - The file content.
 * @returns {string} The processed content.
 */
function fixArrayTypes(content) {
	return content.replace(/`([^`]+)`\[\]/g, "`$1[]`");
}

/**
 * Convert linked array types to raw HTML to prevent markdown table corruption.
 * TypeDoc outputs [`Type`](url)[] which can corrupt markdown tables.
 * Converts to Quarto raw HTML: `<code>...</code>`{=html}.
 * @param {string} content - The file content.
 * @returns {string} The processed content.
 */
function fixLinkedArrayTypes(content) {
	const linkedArrayPattern = /\[`([^`]+)`\]\(([^)]+)\)\[\]/g;
	return content.replace(linkedArrayPattern, (_match, typeName, url) => {
		return `\`<code><a href="${url}" style="${HTML_LINK_STYLE}">${typeName}</a>[]</code>\`{=html}`;
	});
}

/**
 * Update internal links from .md to .qmd and fix cross-module paths.
 * Handles both dot-separated (archive.extract.qmd) and hyphen-numbered (archive-1.qmd) patterns.
 * @param {string} content - The file content.
 * @param {string[]} moduleNames - List of known module names.
 * @returns {string} The processed content.
 */
function updateLinks(content, moduleNames) {
	// Update .md extensions to .qmd
	content = content.replace(/\.md([)#"'])/g, ".qmd$1");

	// Update README references to index.qmd
	content = content.replace(/README\.qmd/g, "index.qmd");

	// Fix cross-module links
	for (const mod of moduleNames) {
		// Match submodule links like (archive.extract.qmd#anchor)
		// Use [^.\s)]+ to prevent matching across lines or multiple parentheses
		const subModulePattern = new RegExp(`\\(${mod}\\.([^.\\s)]+)\\.qmd(#[^)]+)?\\)`, "g");
		content = content.replace(subModulePattern, `(${mod}.qmd$2)`);

		// Match hyphen-numbered links like (github-1.qmd#anchor)
		const hyphenPattern = new RegExp(`\\(${mod}-\\d+\\.qmd(#[^)]+)?\\)`, "g");
		content = content.replace(hyphenPattern, `(${mod}.qmd$1)`);
	}

	// Rewrite TypeDoc symbol page links to merged module anchors.
	// Example: types.Interface.FieldDescriptor.qmd -> types.qmd#symbol-interface-fielddescriptor
	const symbolLinkPattern = new RegExp(
		`([A-Za-z0-9_\\/-]+?)\\.(${TYPE_DOC_SYMBOL_KINDS})\\.([A-Za-z0-9_%-]+)\\.qmd(#[A-Za-z0-9_\\-]+)?`,
		"g",
	);
	content = content.replace(symbolLinkPattern, (_match, modulePath, kind, symbolName, symbolMemberAnchor) => {
		if (symbolMemberAnchor) {
			return `${modulePath}.qmd#${buildSymbolMemberAnchorId(kind, symbolName, symbolMemberAnchor.slice(1))}`;
		}
		return `${modulePath}.qmd#${buildSymbolAnchorId(kind, symbolName)}`;
	});

	return content;
}

/**
 * Convert escaped TypeDoc type expressions to cleaner format.
 * Handles both simple types and types with links.
 *
 * Examples:
 * - `Promise`\<`void`\> -> `Promise<void>`
 * - `Promise`\<[`Registry`](types.qmd#registry)\> -> HTML with proper link.
 *
 * @param {string} content - The file content.
 * @returns {string} The processed content.
 */
function cleanTypeExpressions(content) {
	const typePattern = /`([A-Za-z]+)`\\<(.+?)\\>/g;

	return content.replace(typePattern, (_match, typeName, innerContent) => {
		const hasLinks = innerContent.includes("](");

		if (!hasLinks) {
			// Simple case: clean up escapes
			const cleaned = innerContent.replace(/`([^`]+)`/g, "$1").replace(/\\/g, "");
			return `\`${typeName}<${cleaned}>\``;
		}

		// Complex case with links: convert to inline raw HTML code.
		const htmlContent = innerContent
			.replace(/\[`([^`]+)`\]\(([^)]+)\)/g, `<a href="$2" style="${HTML_LINK_STYLE}">$1</a>`)
			.replace(/`([^`]+)`/g, "$1")
			.replace(/\s*\\\|\s*/g, " | ")
			.replace(/\\/g, "");

		return `\`<code>${typeName}&lt;${htmlContent}&gt;</code>\`{=html}`;
	});
}

/**
 * Fix trailing escaped generic closers left after HTML type conversion.
 * @param {string} content - The file content.
 * @returns {string} The processed content.
 */
function fixTrailingEscapedGenericClosers(content) {
	const trailingCloserPattern = /`<code>([\s\S]*?)<\/code>`\{=html\}((?:\\>)+)/g;
	return content.replace(trailingCloserPattern, (_match, htmlContent, trailingClosers) => {
		const extraClosers = trailingClosers.replaceAll("\\>", "&gt;");
		return `\`<code>${htmlContent}${extraClosers}</code>\`{=html}`;
	});
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

		if (isListItem && !inList) {
			if (output.length > 0 && !prevLineEmpty) {
				output.push("");
			}
			inList = true;
		}

		if (!isListItem && !currentLineEmpty && inList) {
			output.push("");
			inList = false;
		}

		if (currentLineEmpty && inList) {
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
 * Remove the "References" section (re-exports) from content.
 * @param {string} content - The file content.
 * @returns {string} The cleaned content.
 */
function removeReferencesSection(content) {
	return content.replace(/^## References\n+(?:###[^\n]+\n+Re-exports[^\n]+\n+)+/m, "");
}

/**
 * Apply all content transformations in sequence.
 * @param {string} content - The raw content.
 * @param {string[]} moduleNames - List of known module names for link fixing.
 * @returns {string} The transformed content.
 */
function applyContentTransformations(content, moduleNames) {
	content = convertCodeBlocks(content);
	content = fixArrayTypes(content);
	content = updateLinks(content, moduleNames);
	content = cleanTypeExpressions(content);
	content = fixTrailingEscapedGenericClosers(content);
	content = fixLinkedArrayTypes(content);
	content = addBlankLinesAroundLists(content);
	return content;
}

// =============================================================================
// TypeDoc Content Processing
// =============================================================================

/**
 * Transform TypeDoc content for a submodule.
 * Extracts title and description, removes their sections, and cleans up formatting.
 * @param {string} content - The raw TypeDoc content.
 * @param {string} packageName - The package name (e.g., "@quarto-wizard/core").
 * @returns {{title: string, description: string, content: string}} Transformed result.
 */
function transformSubmoduleContent(content, packageName) {
	const escapedPkg = packageName.replace(/[.*+?^${}()|[\]\\/@-]/g, "\\$&");

	// Remove breadcrumb header
	const breadcrumbPattern = new RegExp(
		`^\\[?\\*?\\*?${escapedPkg}\\*?\\*?\\]?\\([^)]*\\)\\n+\\*{3}\\n+(?:\\[${escapedPkg}\\]\\([^)]+\\) / [^\\n]+\\n+)?`,
		"",
	);
	content = content.replace(breadcrumbPattern, "");

	// Remove standalone horizontal rules
	content = content.replace(/^\*{3}\n+/gm, "\n");

	// Remove H1 heading (module name goes to YAML title)
	content = content.replace(/^# [^\n]+\n+/m, "");

	// Extract and remove ## Title
	let title = "";
	const titleMatch = content.match(/^## Title\n+([^\n]+)/m);
	if (titleMatch) {
		title = titleMatch[1].trim();
		content = content.replace(/^## Title\n+[^\n]+\n+/m, "");
	}

	// Extract and remove ## Description
	let description = "";
	const descMatch = content.match(/^## Description\n+([\s\S]*?)(?=^##|\n*$)/m);
	if (descMatch) {
		description = descMatch[1].trim();
		content = content.replace(/^## Description\n+[\s\S]*?(?=^##|\n*$)/m, "");
	}

	// Remove References section (re-exports)
	content = removeReferencesSection(content);

	// Clean up multiple consecutive blank lines
	content = content.replace(/\n{3,}/g, "\n\n");

	return { title, description, content: content.trim() };
}

/**
 * Generate YAML frontmatter for a module page.
 * @param {string} title - The module title.
 * @returns {string} The YAML frontmatter.
 */
function generateFrontmatter(title) {
	return `---\ntitle: "${title}"\n---\n\n`;
}

/**
 * Find all markdown files in a directory.
 * @param {string} [dir=docsApiDir] - Directory to search.
 * @returns {string[]} Array of file paths.
 */
function findMarkdownFiles(dir = docsApiDir) {
	if (!existsSync(dir)) {
		return [];
	}
	return readdirSync(dir)
		.filter((f) => f.endsWith(".md"))
		.map((f) => join(dir, f));
}

/**
 * Group files by top-level module.
 * Handles both dot-separated (archive.extract.md) and hyphen-numbered (archive-1.md) patterns.
 * @param {string[]} files - Array of file paths.
 * @returns {Map<string, string[]>} Map of module name to file paths.
 */
function groupFilesByModule(files) {
	const groups = new Map();

	for (const file of files) {
		const name = basename(file, ".md");

		if (name === "README" || name === "index") {
			continue;
		}

		// Extract top-level module name
		let topLevel = name.split(".")[0];
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
 * @param {string} packageName - The package name for breadcrumb removal.
 * @returns {string} The merged content.
 */
function mergeModuleFiles(moduleName, files, allModuleNames, packageName) {
	// Sort files: main module first, then submodules alphabetically
	files.sort((a, b) => {
		const nameA = basename(a, ".md");
		const nameB = basename(b, ".md");
		if (nameA === moduleName) return -1;
		if (nameB === moduleName) return 1;
		return nameA.localeCompare(nameB);
	});

	const sections = [];
	const moduleTitle = capitalise(moduleName);

	for (const file of files) {
		const fileBaseName = basename(file, ".md");
		const symbolInfo = parseSymbolFileName(moduleName, fileBaseName);
		const rawContent = readFileSync(file, "utf-8");
		const transformed = transformSubmoduleContent(rawContent, packageName);

		let content = applyContentTransformations(transformed.content, allModuleNames);

		if (content.trim()) {
			// Demote all headings by one level (must replace in reverse order)
			content = content.replace(/^#### /gm, "##### ");
			content = content.replace(/^### /gm, "#### ");
			content = content.replace(/^## /gm, "### ");

			if (symbolInfo) {
				content = content.replace(/^#### ([^\n{]+)$/gm, (_match, headingText) => {
					return `#### ${headingText} {#${buildSymbolMemberAnchorId(symbolInfo.kind, symbolInfo.name, headingText)}}`;
				});
			}

			// Build section with H2 title and description
			const sectionTitle = symbolInfo?.name || transformed.title || capitalise(moduleName);
			const sectionAnchor = symbolInfo ? ` {#${symbolInfo.anchorId}}` : "";
			let sectionContent = `## ${sectionTitle}${sectionAnchor}\n\n`;
			if (transformed.description) {
				sectionContent += `${transformed.description}\n\n`;
			}
			sectionContent += content;

			sections.push(sectionContent);
		}
	}

	return generateFrontmatter(moduleTitle) + sections.join("\n\n") + "\n";
}

// =============================================================================
// API Documentation Generation
// =============================================================================

/**
 * Create the API landing page with Quarto listing.
 */
function createApiIndex() {
	writeFromTemplate("api-index.qmd", join(docsApiDir, "index.qmd"), {});
	console.log("  Created api/index.qmd");
}

/**
 * Create a package index page with Quarto listing.
 * @param {object} pkg - Package configuration.
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
 * Generate the API sidebar configuration.
 * @param {Array<{pkg: object, moduleNames: string[]}>} packagesWithModules - Packages with their modules.
 */
function generateApiSidebar(packagesWithModules) {
	const sortedPackages = [...packagesWithModules].sort((a, b) => a.pkg.name.localeCompare(b.pkg.name));

	const packageSections = sortedPackages
		.map(({ pkg, moduleNames }) => {
			const sortedModules = [...moduleNames].sort();
			const moduleEntries = sortedModules.map((mod) => `                - api/${pkg.shortName}/${mod}.qmd`).join("\n");

			return `            - section: "${pkg.name}"
              href: api/${pkg.shortName}/index.qmd
              contents:
${moduleEntries}`;
		})
		.join("\n");

	const content = `website:
  sidebar:
    - id: api
      align: center
      collapse-level: 2
      contents:
        - section: "API Reference"
          href: api/index.qmd
          contents:
${packageSections}
`;

	writeFileSync(join(docsDir, "_sidebar-api.yml"), content, "utf-8");
	console.log("  Created _sidebar-api.yml");
}

/**
 * Main API documentation processing function.
 */
function processApiDocs() {
	mkdirSync(docsApiDir, { recursive: true });

	const packagesWithModules = [];
	let totalModules = 0;

	for (const pkg of packages) {
		console.log(`\nProcessing package: ${pkg.name}`);

		// Run TypeDoc for this package using its own tsconfig.
		// Use a temp directory so TypeDoc does not wipe previously generated output.
		const packageDir = join(rootDir, "packages", pkg.shortName);
		const typedocTmpDir = join(rootDir, ".typedoc-tmp");
		if (existsSync(typedocTmpDir)) {
			rmSync(typedocTmpDir, { recursive: true });
		}
		console.log(`  Running TypeDoc for ${pkg.name}...`);
		const blockTagsArgs = typedocBlockTags.map((tag) => `--blockTags ${tag}`).join(" ");
		execSync(
			`npx typedoc --entryPointStrategy expand --entryPoints src --tsconfig tsconfig.json --out "${typedocTmpDir}" --plugin typedoc-plugin-markdown --flattenOutputFiles --readme none --excludePrivate --excludeProtected --excludeInternal --hideGenerator --useCodeBlocks --parametersFormat table --interfacePropertiesFormat table --exclude "**/index.ts" ${blockTagsArgs}`,
			{ cwd: packageDir, stdio: "inherit" },
		);

		const mdFiles = findMarkdownFiles(typedocTmpDir);

		if (mdFiles.length === 0) {
			console.log(`  Skipping ${pkg.name}: no markdown files found.`);
			continue;
		}

		console.log(`  Found ${mdFiles.length} TypeDoc-generated files.`);

		const moduleGroups = groupFilesByModule(mdFiles);
		const allModuleNames = [...moduleGroups.keys()];

		console.log(`  Merging into ${moduleGroups.size} module pages...`);

		// Create package output directory
		if (existsSync(pkg.outputDir)) {
			rmSync(pkg.outputDir, { recursive: true });
		}
		mkdirSync(pkg.outputDir, { recursive: true });

		// Process each module
		const moduleNames = [];
		for (const [moduleName, files] of moduleGroups) {
			const merged = mergeModuleFiles(moduleName, files, allModuleNames, pkg.name);
			writeFileSync(join(pkg.outputDir, `${moduleName}.qmd`), merged, "utf-8");
			moduleNames.push(moduleName);
			console.log(`    ${moduleName}.qmd (merged ${files.length} files)`);
		}

		createPackageIndex(pkg);

		packagesWithModules.push({ pkg, moduleNames });
		totalModules += moduleGroups.size;

		// Clean up TypeDoc temp directory
		console.log("  Cleaning up TypeDoc output...");
		if (existsSync(typedocTmpDir)) {
			rmSync(typedocTmpDir, { recursive: true });
		}
	}

	if (packagesWithModules.length === 0) {
		console.error("Error: No markdown files found for any package.");
		process.exit(1);
	}

	createApiIndex();
	generateApiSidebar(packagesWithModules);

	console.log(`\nProcessed ${totalModules} modules across ${packagesWithModules.length} package(s) successfully.`);
}

// =============================================================================
// Reference Documentation Generation
// =============================================================================

/**
 * Get all commands from package.json.
 * @param {object} pkg - Parsed package.json.
 * @returns {Map<string, object>} Map of command ID to command object.
 */
function getDocumentedCommands(pkg) {
	const commands = new Map();
	for (const cmd of pkg.contributes?.commands || []) {
		commands.set(cmd.command, cmd);
	}
	return commands;
}

/**
 * Generate a description for a command.
 * @param {object} cmd - Command object from package.json.
 * @returns {string} Generated description.
 */
function generateCommandDescription(cmd) {
	return cmd.description || "";
}

/**
 * Generate a human-readable title from a setting key.
 * @param {string} key - Setting key.
 * @param {object} prop - Property object.
 * @returns {string} Human-readable title.
 */
function generateSettingTitle(key, prop) {
	return prop.title || key.split(".").pop();
}

/**
 * Generate a quick description for a setting.
 * @param {object} prop - Property object.
 * @returns {string} Quick description.
 */
function generateSettingQuickDesc(prop) {
	return prop.description || "";
}

/**
 * Generate a description for an enum value.
 * @param {string} value - Enum value.
 * @param {string} defaultValue - Default value.
 * @param {string} description - Description from enumDescriptions.
 * @returns {string} Description.
 */
function generateEnumDescription(value, defaultValue, description) {
	const isDefault = value === defaultValue;
	const defaultSuffix = isDefault ? " (default)." : ".";
	return description ? description + defaultSuffix : capitalise(value) + defaultSuffix;
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
 * Generate the configuration reference page.
 * @param {object} pkg - Parsed package.json.
 */
function generateConfigurationPage(pkg) {
	const properties = pkg.contributes?.configuration?.properties || {};

	const sectionLines = [];
	for (const group of configGroups) {
		const groupProps = Object.entries(properties).filter(([key]) => key.startsWith(group.prefix));
		if (groupProps.length === 0) continue;

		sectionLines.push(`## ${group.title}`, "");

		for (const [key, prop] of groupProps) {
			const title = generateSettingTitle(key, prop);
			sectionLines.push(`### ${title}`, "");
			sectionLines.push(`**Setting**: \`${key}\``, "");

			const desc = prop.markdownDescription || prop.description || "";
			if (desc) {
				// Convert absolute docs URLs to relative paths for generated documentation
				const relativizedDesc = desc
					.replace(/https:\/\/m\.canouil\.dev\/quarto-wizard/g, "")
					.replace(/\.html([#)])/g, ".qmd$1");
				sectionLines.push(relativizedDesc.replace(/`([^`]+)`/g, "`$1`"), "");
			}

			// Generate property table based on type
			if (prop.enum) {
				sectionLines.push("| Value | Description |", "|-------|-------------|");
				for (let i = 0; i < prop.enum.length; i++) {
					const value = prop.enum[i];
					const valueDesc = generateEnumDescription(value, prop.default, prop.enumDescriptions?.[i]);
					sectionLines.push(`| \`${value}\` | ${valueDesc} |`);
				}
				sectionLines.push("");
			} else if (prop.type === "number") {
				sectionLines.push("| Property | Value |", "|----------|-------|");
				sectionLines.push(`| Type | Number |`);
				if (prop.default !== undefined) sectionLines.push(`| Default | \`${prop.default}\` |`);
				if (prop.minimum !== undefined) sectionLines.push(`| Minimum | \`${prop.minimum}\` |`);
				if (prop.maximum !== undefined) {
					const maxLabel = prop.maximum === 1440 ? `\`1440\` (24 hours)` : `\`${prop.maximum}\``;
					sectionLines.push(`| Maximum | ${maxLabel} |`);
				}
				sectionLines.push("");
			} else if (prop.type === "string" && prop.format === "uri") {
				sectionLines.push("| Property | Value |", "|----------|-------|");
				sectionLines.push(`| Type | String (URI) |`);
				if (prop.default) sectionLines.push(`| Default | \`${prop.default}\` |`);
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
		exampleLines.push(`  "${key}": ${value}${index < lastIndex ? "," : ""}`);
	});
	exampleLines.push("}", "```", "");

	writeFromTemplate("reference-configuration.qmd", join(docsRefDir, "configuration.qmd"), {
		CONFIG_SECTIONS: sectionLines.join("\n"),
		EXAMPLE_CONFIG: exampleLines.join("\n"),
	});
	console.log("  Created reference/configuration.qmd");
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
	for (const group of [commandGroups[0], commandGroups[1]]) {
		for (const cmdId of group.commands) {
			const cmd = commands.get(cmdId);
			if (!cmd) continue;
			const desc = generateCommandDescription(cmd);
			if (desc) {
				commandsLines.push(`| ${cmd.title} | ${desc} |`);
			}
		}
	}

	// Generate configuration table
	const configLines = ["| Setting | Default | Description |", "|---------|---------|-------------|"];
	const sortedProps = Object.entries(properties).sort(([, a], [, b]) => (a.order || 99) - (b.order || 99));
	for (const [key, prop] of sortedProps) {
		const defaultVal =
			key === "quartoWizard.registry.url" ? "[see docs](configuration.qmd#registry-url)" : `\`${prop.default}\``;
		configLines.push(`| \`${key}\` | ${defaultVal} | ${generateSettingQuickDesc(prop)} |`);
	}

	writeFromTemplate("reference-index.qmd", join(docsRefDir, "index.qmd"), {
		COMMANDS_TABLE: commandsLines.join("\n"),
		CONFIGURATION_TABLE: configLines.join("\n"),
	});
	console.log("  Created reference/index.qmd");
}

/**
 * Generate the reference sidebar configuration.
 */
function generateReferenceSidebar() {
	const content = `website:
  sidebar:
    - id: reference
      align: center
      collapse-level: 2
      contents:
        - section: "Reference"
          href: reference/index.qmd
          contents:
            - reference/commands.qmd
            - reference/configuration.qmd
            - reference/schema-specification.qmd
            - reference/environment-variables.qmd
`;

	writeFileSync(join(docsDir, "_sidebar-reference.yml"), content, "utf-8");
	console.log("  Created _sidebar-reference.yml");
}

// =============================================================================
// Environment Variables Documentation
// =============================================================================

/**
 * Parse environment variable documentation from a TypeScript source file.
 * Extracts @envvar, @example, @pattern, and @note tags from JSDoc.
 * @param {string} filePath - Path to the TypeScript file.
 * @returns {object|null} Parsed documentation or null if not found.
 */
function parseEnvVarDocumentation(filePath) {
	const content = readFileSync(filePath, "utf-8");

	const jsdocMatch = content.match(/^\/\*\*[\s\S]*?\*\//m);
	if (!jsdocMatch) return null;

	const jsdoc = jsdocMatch[0];

	// Extract description (lines before first @tag)
	const descLines = [];
	for (const line of jsdoc.split("\n")) {
		const trimmed = line.replace(/^\s*\*\s?/, "").trim();
		if (trimmed.startsWith("@") || trimmed === "/**" || trimmed === "*/") continue;
		if (trimmed) descLines.push(trimmed);
	}
	const description = descLines.slice(0, 2).join(" ");

	// Extract @envvar tags
	const envvars = [];
	const envvarRegex = /@envvar\s+(\S+)\s+-\s+(.+)/g;
	let match;
	while ((match = envvarRegex.exec(jsdoc)) !== null) {
		envvars.push({ name: match[1], description: match[2].trim() });
	}

	// Extract @example tags with code blocks
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

	// Extract precedence note
	let precedenceNote = "";
	for (const pattern of [/\b\w+\s+takes precedence[^@]*/, /The uppercase variants[^@]*/]) {
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
 * @param {object} source - Source configuration { path, section, id }.
 * @returns {string[]} Lines of markdown documentation.
 */
function generateEnvVarSection(source) {
	const doc = parseEnvVarDocumentation(source.path);
	if (!doc || doc.envvars.length === 0) return [];

	const lines = [`## ${source.section}`, ""];

	if (doc.description) {
		lines.push(doc.description, "");
	}

	// Environment variables table
	lines.push("### Variables", "", "| Variable | Description |", "|----------|-------------|");

	// Group by base name for case variants
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

	if (doc.precedenceNote) {
		lines.push(doc.precedenceNote, "");
	}

	// Examples
	if (doc.examples.length > 0) {
		lines.push("### Examples", "", `\`\`\`${doc.examples[0].language}`);
		for (const example of doc.examples) {
			lines.push(`# ${example.title}`, example.code, "");
		}
		if (lines[lines.length - 1] === "") lines.pop();
		lines.push("```", "");
	}

	// Patterns table
	if (doc.patterns.length > 0) {
		lines.push("### NO_PROXY Patterns", "", "The `NO_PROXY` variable supports several pattern formats.", "");
		lines.push("| Pattern | Matches |", "|---------|---------|");
		for (const p of doc.patterns) {
			lines.push(`| \`${p.pattern}\` | ${p.description} |`);
		}
		lines.push("");
	}

	// Notes as callouts
	for (const note of doc.notes) {
		lines.push("::: {.callout-note}", note, ":::", "");
	}

	return lines;
}

/**
 * Generate the environment variables reference page.
 */
function generateEnvironmentVariablesPage() {
	const sectionLines = [];
	for (const source of envVarSources) {
		sectionLines.push(...generateEnvVarSection(source));
	}

	writeFromTemplate("reference-environment-variables.qmd", join(docsRefDir, "environment-variables.qmd"), {
		ENV_VAR_SECTIONS: sectionLines.join("\n"),
	});
	console.log("  Created reference/environment-variables.qmd");
}

/**
 * Main reference documentation processing function.
 * @param {object} pkg - Parsed package.json content.
 */
function processReferenceDocs(pkg) {
	console.log("\nGenerating reference documentation...");

	if (!existsSync(docsRefDir)) {
		mkdirSync(docsRefDir, { recursive: true });
	}

	generateCommandsPage(pkg);
	generateConfigurationPage(pkg);
	generateEnvironmentVariablesPage();
	generateReferenceIndex(pkg);
	generateReferenceSidebar();

	console.log("Reference documentation generated successfully.");
}

// =============================================================================
// Changelog and Variables
// =============================================================================

/**
 * Update the _environment file with the current version.
 * @param {object} pkg - Parsed package.json content.
 */
function updateVariablesYml(pkg) {
	console.log("\nUpdating _environment...");

	if (!pkg.version) {
		console.error("Error: No version found in package.json.");
		return;
	}

	writeFileSync(envVariablesPath, `VERSION=${pkg.version}\n`, "utf-8");
	console.log(`  Updated _environment with version: ${pkg.version}`);
}

/**
 * Generate changelog.qmd from CHANGELOG.md with nested version headers.
 * Transforms headings to proper hierarchy with explicit IDs for Quarto.
 *
 * Input structure (CHANGELOG.md):
 *   ## major.minor.patch (date)
 *   ### Sub heading
 *   #### Sub sub heading
 *
 * Output structure (changelog.qmd):
 *   ## major {#version-major}
 *   ### major.minor {#version-major-minor}
 *   #### major.minor.patch (date) {#version-major-minor-patch}
 *   ##### Sub heading
 *   ###### Sub sub heading
 */
function generateChangelog() {
	console.log("\nGenerating changelog.qmd...");

	if (!existsSync(changelogMdPath)) {
		console.error(`Error: ${changelogMdPath} not found.`);
		return;
	}

	const content = readFileSync(changelogMdPath, "utf-8");
	const lines = content.split("\n");
	const output = ["---", 'title: "Changelog"', "---", ""];

	let currentMajor = null;
	let currentMinor = null;
	let inVersionBlock = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Skip the main "# Changelog" heading
		if (i === 0 && line === "# Changelog") continue;

		// Handle "## Unreleased" section
		if (line === "## Unreleased") {
			output.push("", `## Unreleased {#unreleased}`, "");
			inVersionBlock = false;
			continue;
		}

		// Match version headers like "## 1.0.2 (2025-12-06)"
		const versionMatch = line.match(/^## (\d+)\.(\d+)\.(\d+)\s*(\(.*\))?/);
		if (versionMatch) {
			const major = versionMatch[1];
			const minorNum = versionMatch[2];
			const patchNum = versionMatch[3];
			const minor = `${major}.${minorNum}`;
			const patch = `${major}.${minorNum}.${patchNum}`;
			const datePart = versionMatch[4] ? ` ${versionMatch[4]}` : "";

			if (currentMajor !== major) {
				output.push("", `## ${major} {#version-${major}}`, "");
				currentMajor = major;
				currentMinor = null;
			}

			if (currentMinor !== minor) {
				output.push(`### ${minor} {#version-${major}-${minorNum}}`, "");
				currentMinor = minor;
			}

			output.push(`#### ${patch}${datePart} {#version-${major}-${minorNum}-${patchNum}}`);
			inVersionBlock = true;
			continue;
		}

		// Demote sub-headings within version blocks
		if (inVersionBlock) {
			// Convert ### to ##### (demote by 2 levels)
			if (line.startsWith("### ")) {
				output.push(`##### ${line.substring(4)}`);
				continue;
			}
			// Convert #### to ###### (demote by 2 levels)
			if (line.startsWith("#### ")) {
				output.push(`###### ${line.substring(5)}`);
				continue;
			}
		}

		output.push(line);
	}

	writeFileSync(changelogQmdPath, output.join("\n"), "utf-8");
	console.log("  Created changelog.qmd");
}

// =============================================================================
// Main Entry Point
// =============================================================================

processApiDocs();
const pkg = readPackageJson();
processReferenceDocs(pkg);
updateVariablesYml(pkg);
generateChangelog();
