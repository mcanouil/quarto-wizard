import * as vscode from "vscode";
import { ExtensionDetails } from "../utils/extensionDetails";

/**
 * Normalise contributes values from plural to singular form.
 * Handles transition period where registry may still have plural forms.
 */
const CONTRIBUTES_TO_SINGULAR: Record<string, string> = {
	filters: "filter",
	shortcodes: "shortcode",
	formats: "format",
	projects: "project",
	"revealjs-plugins": "revealjs-plugin",
};

/**
 * Normalise a contributes value to singular form.
 */
function normaliseContributes(value: string): string {
	const lower = value.toLowerCase();
	return CONTRIBUTES_TO_SINGULAR[lower] ?? lower;
}

/**
 * Contribution type definitions with icons and labels.
 * These map the "contributes" field values from the registry (singular forms).
 */
const CONTRIBUTION_TYPES: Record<string, { icon: string; label: string }> = {
	filter: { icon: "$(filter)", label: "Filter" },
	shortcode: { icon: "$(code)", label: "Shortcode" },
	format: { icon: "$(file-text)", label: "Format" },
	project: { icon: "$(project)", label: "Project" },
	"revealjs-plugin": { icon: "$(play)", label: "Reveal.js Plugin" },
	metadata: { icon: "$(note)", label: "Metadata" },
};

/**
 * Interface for type filter items.
 */
interface TypeFilterItem extends vscode.QuickPickItem {
	filterValue: string | null;
}

/**
 * Shows a QuickPick for selecting extension type filter.
 * @param extensionsList - List of all extensions to derive available types.
 * @returns The selected filter value or null for "All".
 */
export async function showTypeFilterQuickPick(extensionsList: ExtensionDetails[]): Promise<string | null | undefined> {
	// Count extensions by type
	const typeCounts: Record<string, number> = {};
	let templateCount = 0;

	for (const ext of extensionsList) {
		if (ext.template) {
			templateCount++;
		}
		for (const contrib of ext.contributes) {
			const normalised = normaliseContributes(contrib);
			if (CONTRIBUTION_TYPES[normalised]) {
				typeCounts[normalised] = (typeCounts[normalised] || 0) + 1;
			}
		}
	}

	// Build filter items
	const filterItems: TypeFilterItem[] = [
		{
			label: "$(list-unordered) All Extensions",
			description: `${extensionsList.length} extensions`,
			filterValue: null,
		},
	];

	// Add type filters sorted by count
	const sortedTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
	for (const [type, count] of sortedTypes) {
		const typeInfo = CONTRIBUTION_TYPES[type];
		if (typeInfo) {
			filterItems.push({
				label: `${typeInfo.icon} ${typeInfo.label}`,
				description: `${count} extensions`,
				filterValue: type,
			});
		}
	}

	// Add template filter if templates exist
	if (templateCount > 0) {
		filterItems.push({
			label: "$(file-code) Template",
			description: `${templateCount} extensions`,
			filterValue: "template",
		});
	}

	const selected = await vscode.window.showQuickPick(filterItems, {
		placeHolder: "Filter by extension type (optional, press Enter to skip)",
		title: "Extension Type Filter",
	});

	return selected?.filterValue;
}

/**
 * Derives extension type badges from the contributes field.
 * @param contributes - What the extension contributes (filters, formats, etc.).
 * @param isTemplate - Whether the extension is a template.
 * @returns Array of type badges as strings.
 */
function getExtensionTypeBadges(contributes: string[], isTemplate: boolean): string[] {
	const badges: string[] = [];
	const seen = new Set<string>();

	// Check for known contribution types (deduplicate after normalisation)
	for (const contrib of contributes) {
		const normalised = normaliseContributes(contrib);
		if (CONTRIBUTION_TYPES[normalised] && !seen.has(normalised)) {
			seen.add(normalised);
			const type = CONTRIBUTION_TYPES[normalised];
			badges.push(`${type.icon} ${type.label}`);
		}
	}

	// Add template badge if it's a template
	if (isTemplate) {
		badges.push("$(file-code) Template");
	}

	return badges;
}

/**
 * Interface representing a QuickPick item for an extension.
 */
export interface ExtensionQuickPickItem extends vscode.QuickPickItem {
	url?: string;
	id?: string;
	tag?: string;
	template?: boolean;
	contributes?: string[];
}

/**
 * Creates QuickPick items from extension details.
 * @param {ExtensionDetails[]} extensions - The list of extension details.
 * @returns {ExtensionQuickPickItem[]} - An array of QuickPick items.
 */
export function createExtensionItems(extensions: ExtensionDetails[]): ExtensionQuickPickItem[] {
	return extensions.map((ext) => {
		const typeBadges = getExtensionTypeBadges(ext.contributes, ext.template);
		const typeBadgeStr = typeBadges.length > 0 ? `${typeBadges.join(" ")} ` : "";

		return {
			label: ext.name,
			description: `${typeBadgeStr}$(star) ${ext.stars} $(repo) ${ext.full_name}`,
			detail: `${ext.description}${ext.version ? ` (v${ext.version})` : ""}`,
			buttons: [
				{
					iconPath: new vscode.ThemeIcon("github"),
					tooltip: "Open GitHub Repository",
				},
			],
			url: ext.html_url,
			id: ext.id,
			tag: ext.tag,
			template: ext.template,
			contributes: ext.contributes,
		};
	});
}

/**
 * Filters extensions by type.
 * @param extensions - List of extensions to filter.
 * @param typeFilter - The type filter to apply (null for all).
 * @returns Filtered list of extensions.
 */
function filterExtensionsByType(extensions: ExtensionDetails[], typeFilter: string | null): ExtensionDetails[] {
	if (!typeFilter) {
		return extensions;
	}

	if (typeFilter === "template") {
		return extensions.filter((ext) => ext.template);
	}

	return extensions.filter((ext) => ext.contributes.some((c) => normaliseContributes(c) === typeFilter));
}

/**
 * Shows a QuickPick for selecting Quarto extensions.
 * @param {ExtensionDetails[]} extensionsList - The list of extension details.
 * @param {string[]} recentlyInstalled - The list of recently installed or used extensions.
 * @param {boolean} [template=false] - Whether this is for template selection. If true, only one template can be selected.
 * @param {string | null} [typeFilter=null] - Optional type filter to apply.
 * @returns {Promise<readonly ExtensionQuickPickItem[]>} - A promise that resolves to the selected QuickPick items.
 */
export async function showExtensionQuickPick(
	extensionsList: ExtensionDetails[],
	recentlyInstalled: string[],
	template = false,
	typeFilter: string | null = null,
): Promise<readonly ExtensionQuickPickItem[]> {
	// Apply type filter if specified
	const filteredExtensions = filterExtensionsByType(extensionsList, typeFilter);

	// Get the type label for the placeholder
	let filterLabel = "";
	if (typeFilter) {
		if (typeFilter === "template") {
			filterLabel = " (Templates)";
		} else if (CONTRIBUTION_TYPES[typeFilter]) {
			filterLabel = ` (${CONTRIBUTION_TYPES[typeFilter].label}s)`;
		}
	}

	const groupedExtensions: ExtensionQuickPickItem[] = [
		{
			label: template ? "Recently Used" : "Recently Installed",
			kind: vscode.QuickPickItemKind.Separator,
		},
		...createExtensionItems(filteredExtensions.filter((ext) => recentlyInstalled.includes(ext.id))),
		{
			label: typeFilter ? `${filterLabel.trim()} Extensions` : "All Extensions",
			kind: vscode.QuickPickItemKind.Separator,
		},
		...createExtensionItems(filteredExtensions.filter((ext) => !recentlyInstalled.includes(ext.id))).sort((a, b) =>
			a.label.localeCompare(b.label),
		),
	];

	const quickPick = vscode.window.createQuickPick<ExtensionQuickPickItem>();
	quickPick.items = groupedExtensions;
	quickPick.placeholder = template
		? `Search and select a Quarto template to use${filterLabel}`
		: `Search and select Quarto extensions to install${filterLabel}`;
	quickPick.canSelectMany = !template;
	quickPick.matchOnDescription = true;
	quickPick.matchOnDetail = true;
	quickPick.onDidTriggerItemButton((e) => {
		const url = e.item.url;
		if (url) {
			vscode.env.openExternal(vscode.Uri.parse(url));
		}
	});

	return new Promise((resolve) => {
		quickPick.onDidAccept(() => {
			resolve(quickPick.selectedItems);
			quickPick.hide();
		});
		quickPick.show();
	});
}
