import * as vscode from "vscode";
import type { ExtensionSchema, FieldDescriptor, ShortcodeSchema } from "@quarto-wizard/schema";
import { formatType } from "@quarto-wizard/schema";
import type { SnippetCollection, SnippetDefinition, SnippetExtensionId } from "@quarto-wizard/snippets";
import { qualifySnippetPrefix } from "@quarto-wizard/snippets";
import { getExtensionRepository, type InstalledExtension } from "../utils/extensions";

/**
 * Represents a tree item for a workspace folder.
 */
export class WorkspaceFolderTreeItem extends vscode.TreeItem {
	public workspaceFolder: string;

	constructor(
		public readonly label: string,
		public readonly folderPath: string,
	) {
		super(label, vscode.TreeItemCollapsibleState.Expanded);
		this.contextValue = "quartoExtensionWorkspaceFolder";
		this.iconPath = new vscode.ThemeIcon("folder");
		this.tooltip = folderPath;
		this.workspaceFolder = folderPath;
	}
}

/**
 * Represents a tree item for a Quarto extension.
 */
export class ExtensionTreeItem extends vscode.TreeItem {
	public latestVersion?: string;
	public workspaceFolder: string;
	public repository?: string;

	constructor(
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly workspacePath: string,
		public readonly extension?: InstalledExtension,
		icon?: string,
		latestVersion?: string,
		hasIssue?: boolean,
	) {
		super(label, collapsibleState);
		const needsUpdate = latestVersion !== undefined && latestVersion !== "unknown";
		const noSource = extension && !extension.manifest.source;
		const baseContextValue = "quartoExtensionItem";
		let contextValue = baseContextValue;

		// Set context value based on extension state for VS Code context menus
		// This determines which commands are available when right-clicking
		if (needsUpdate) {
			contextValue = baseContextValue + "Outdated"; // Shows "update" option
		} else if (noSource) {
			contextValue = baseContextValue + "NoSource"; // Cannot be updated, shows limited options
		}

		// Build tooltip with warning if there are issues
		let tooltipText = `${this.label}`;
		if (hasIssue) {
			tooltipText += "\n\nCould not parse extension manifest";
		} else if (noSource) {
			tooltipText += "\n\nNo source in manifest (cannot check for updates)";
		}
		this.tooltip = tooltipText;
		this.description = this.extension
			? `${this.extension.manifest.version}${needsUpdate ? ` (latest: ${latestVersion})` : ""}`
			: "";
		this.contextValue = this.extension ? contextValue : "quartoExtensionItemDetails";

		// Show warning icon if there are issues preventing full functionality
		if (hasIssue || noSource) {
			this.iconPath = new vscode.ThemeIcon("warning", new vscode.ThemeColor("problemsWarningIcon.foreground"));
		} else if (icon) {
			this.iconPath = new vscode.ThemeIcon(icon);
		}

		// Store the clean version string (without '@' prefix) for display and commands.
		this.latestVersion = latestVersion !== "unknown" ? latestVersion : "";
		this.workspaceFolder = workspacePath;

		// Store repository for update commands
		if (extension) {
			this.repository = getExtensionRepository(extension);
		}

		// Set resource URI for the extension directory to enable "Reveal in Explorer" functionality
		if (this.extension) {
			this.resourceUri = vscode.Uri.joinPath(vscode.Uri.file(workspacePath), "_extensions", this.label);
		}
	}
}

/**
 * Represents the top-level "Schema" node under an extension.
 */
export class SchemaTreeItem extends vscode.TreeItem {
	contextValue = "quartoSchemaItem";

	constructor(
		public readonly extensionDir: string,
		public readonly schema: ExtensionSchema,
	) {
		super("Schema", vscode.TreeItemCollapsibleState.Collapsed);
		this.iconPath = new vscode.ThemeIcon("symbol-namespace");
		this.tooltip = "Extension schema";
	}
}

/**
 * Represents a schema file that failed to parse.
 */
export class SchemaErrorTreeItem extends vscode.TreeItem {
	contextValue = "quartoSchemaError";

	constructor(public readonly errorMessage: string) {
		super("Schema (invalid)", vscode.TreeItemCollapsibleState.None);
		this.iconPath = new vscode.ThemeIcon("warning", new vscode.ThemeColor("problemsWarningIcon.foreground"));
		this.tooltip = errorMessage;
	}
}

/**
 * Type of schema section, used to determine children and icons.
 */
export type SchemaSectionKind = "options" | "shortcodes" | "formats" | "projects" | "elementAttributes";

/**
 * Represents a section within the schema (Options, Shortcodes, etc.).
 */
export class SchemaSectionTreeItem extends vscode.TreeItem {
	contextValue = "quartoSchemaSection";

	constructor(
		label: string,
		public readonly kind: SchemaSectionKind,
		public readonly schema: ExtensionSchema,
		fieldCount: number,
	) {
		super(label, vscode.TreeItemCollapsibleState.Collapsed);
		this.description = `${fieldCount} ${fieldCount === 1 ? singularLabel(kind) : pluralLabel(kind)}`;

		const icons: Record<SchemaSectionKind, string> = {
			options: "symbol-field",
			shortcodes: "symbol-method",
			formats: "symbol-interface",
			projects: "symbol-property",
			elementAttributes: "symbol-class",
		};
		this.iconPath = new vscode.ThemeIcon(icons[kind]);
	}
}

/**
 * Represents an individual field or option within a schema section.
 */
export class SchemaFieldTreeItem extends vscode.TreeItem {
	contextValue = "quartoSchemaField";

	constructor(label: string, field: FieldDescriptor, deprecated: boolean, icon = "symbol-field") {
		super(label, vscode.TreeItemCollapsibleState.None);

		const parts: string[] = [];
		if (field.type) {
			parts.push(formatType(field.type));
		}
		if (field.required) {
			parts.push("required");
		}
		if (field.default !== undefined) {
			parts.push(`default: ${String(field.default)}`);
		}
		this.description = parts.join(", ");

		if (deprecated) {
			const reason = typeof field.deprecated === "string" ? field.deprecated : "Deprecated";
			this.iconPath = new vscode.ThemeIcon("warning", new vscode.ThemeColor("problemsWarningIcon.foreground"));
			this.tooltip = reason;
		} else {
			this.iconPath = new vscode.ThemeIcon(icon);
			this.tooltip = field.description ?? label;
		}
	}
}

/**
 * Represents an individual shortcode within the Shortcodes section.
 */
export class SchemaShortcodeTreeItem extends vscode.TreeItem {
	contextValue = "quartoSchemaField";

	constructor(
		label: string,
		public readonly shortcode: ShortcodeSchema,
	) {
		const argCount = shortcode.arguments?.length ?? 0;
		const attrCount = shortcode.attributes ? Object.keys(shortcode.attributes).length : 0;
		const hasChildren = argCount > 0 || attrCount > 0;
		super(label, hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);

		const parts: string[] = [];
		if (argCount > 0) {
			parts.push(`${argCount} arg${argCount === 1 ? "" : "s"}`);
		}
		if (attrCount > 0) {
			parts.push(`${attrCount} attr${attrCount === 1 ? "" : "s"}`);
		}
		this.description = parts.join(", ");

		this.iconPath = new vscode.ThemeIcon("symbol-method");
		this.tooltip = shortcode.description ?? label;
	}
}

/**
 * Represents a format group within the Formats section.
 */
export class SchemaFormatTreeItem extends vscode.TreeItem {
	contextValue = "quartoSchemaSection";

	constructor(
		label: string,
		public readonly fields: Record<string, FieldDescriptor>,
	) {
		const fieldCount = Object.keys(fields).length;
		super(label, vscode.TreeItemCollapsibleState.Collapsed);
		this.description = `${fieldCount} option${fieldCount === 1 ? "" : "s"}`;
		this.iconPath = new vscode.ThemeIcon("symbol-interface");
	}
}

/**
 * Represents the top-level "Snippets" node under an extension.
 */
export class SnippetsTreeItem extends vscode.TreeItem {
	contextValue = "quartoSnippetsItem";

	constructor(
		public readonly extensionId: SnippetExtensionId,
		public readonly snippets: SnippetCollection,
	) {
		const count = Object.keys(snippets).length;
		super("Snippets", vscode.TreeItemCollapsibleState.Collapsed);
		this.iconPath = new vscode.ThemeIcon("symbol-snippet");
		this.description = `${count} snippet${count === 1 ? "" : "s"}`;
		this.tooltip = "Extension-provided code snippets";
	}
}

/**
 * Represents a snippet file that failed to parse.
 */
export class SnippetsErrorTreeItem extends vscode.TreeItem {
	contextValue = "quartoSnippetsError";

	constructor(public readonly errorMessage: string) {
		super("Snippets (invalid)", vscode.TreeItemCollapsibleState.None);
		this.iconPath = new vscode.ThemeIcon("warning", new vscode.ThemeColor("problemsWarningIcon.foreground"));
		this.tooltip = errorMessage;
	}
}

/**
 * Represents an individual snippet within the Snippets section.
 */
export class SnippetItemTreeItem extends vscode.TreeItem {
	contextValue = "quartoSnippetItem";
	public readonly definition: SnippetDefinition;

	constructor(label: string, snippet: SnippetDefinition, namespace: string) {
		super(label, vscode.TreeItemCollapsibleState.None);
		this.definition = snippet;
		this.iconPath = new vscode.ThemeIcon("symbol-snippet");

		const prefixes = Array.isArray(snippet.prefix) ? snippet.prefix : [snippet.prefix];
		const qualifiedPrefixes = prefixes.map((p) => qualifySnippetPrefix(namespace, p));
		this.description = qualifiedPrefixes.join(", ");
		this.tooltip = buildSnippetTooltip(snippet);

		this.command = {
			command: "quartoWizard.extensionsInstalled.insertSnippet",
			title: "Insert Snippet",
			arguments: [snippet],
		};
	}
}

const SNIPPET_TOOLTIP_PREVIEW_MAX_LINES = 15;

function buildSnippetTooltip(snippet: SnippetDefinition): vscode.MarkdownString {
	const tooltip = new vscode.MarkdownString();
	if (snippet.description?.trim()) {
		tooltip.appendText(snippet.description);
		tooltip.appendMarkdown("\n\n");
	}

	const bodyLines = Array.isArray(snippet.body) ? snippet.body : snippet.body.split(/\r?\n/);
	const previewLines = bodyLines.slice(0, SNIPPET_TOOLTIP_PREVIEW_MAX_LINES);
	tooltip.appendCodeblock(previewLines.join("\n"), "markdown");

	if (bodyLines.length > SNIPPET_TOOLTIP_PREVIEW_MAX_LINES) {
		tooltip.appendMarkdown("\n\n_(Preview truncated)_");
	}

	return tooltip;
}

function singularLabel(kind: SchemaSectionKind): string {
	const labels: Record<SchemaSectionKind, string> = {
		options: "option",
		shortcodes: "shortcode",
		formats: "format",
		projects: "project option",
		elementAttributes: "attribute",
	};
	return labels[kind];
}

function pluralLabel(kind: SchemaSectionKind): string {
	const labels: Record<SchemaSectionKind, string> = {
		options: "options",
		shortcodes: "shortcodes",
		formats: "formats",
		projects: "project options",
		elementAttributes: "attributes",
	};
	return labels[kind];
}

/**
 * Union type for all tree item types used in the extensions tree view.
 */
export type TreeItemType =
	| WorkspaceFolderTreeItem
	| ExtensionTreeItem
	| SchemaTreeItem
	| SchemaErrorTreeItem
	| SchemaSectionTreeItem
	| SchemaFieldTreeItem
	| SchemaShortcodeTreeItem
	| SchemaFormatTreeItem
	| SnippetsTreeItem
	| SnippetsErrorTreeItem
	| SnippetItemTreeItem;

/**
 * Cached data for a workspace folder.
 */
export interface FolderCache {
	extensions: Record<string, InstalledExtension>;
	latestVersions: Record<string, string>;
	parseErrors: Set<string>;
}
