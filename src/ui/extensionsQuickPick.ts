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
 * Result from the source picker.
 */
export type SourcePickerResult =
	| { type: "registry" }
	| { type: "github" }
	| { type: "url" }
	| { type: "local" }
	| { type: "cancelled" };

/**
 * Interface for source picker items.
 */
interface SourcePickerItem extends vscode.QuickPickItem {
	sourceType: "registry" | "github" | "url" | "local";
}

/**
 * Shows a QuickPick for selecting the installation source.
 * @returns The selected source type or cancelled.
 */
export async function showSourcePicker(): Promise<SourcePickerResult> {
	const items: SourcePickerItem[] = [
		{
			label: "$(cloud-download) Registry",
			description: "Browse the Quarto extensions registry",
			sourceType: "registry",
		},
		{
			label: "$(github) GitHub",
			description: "Install from owner/repo or owner/repo@version",
			sourceType: "github",
		},
		{
			label: "$(link) URL",
			description: "Install from a direct URL",
			sourceType: "url",
		},
		{
			label: "$(folder) Local",
			description: "Install from a local path",
			sourceType: "local",
		},
	];

	const selected = await vscode.window.showQuickPick(items, {
		title: "Install From",
		placeHolder: "Select where to install from",
	});

	if (!selected) {
		return { type: "cancelled" };
	}

	return { type: selected.sourceType };
}

/**
 * Interface for type filter items.
 */
interface TypeFilterItem extends vscode.QuickPickItem {
	filterValue: string | null;
}

/**
 * Result from the type filter QuickPick.
 */
export type TypeFilterPickerResult = { type: "filter"; value: string | null } | { type: "cancelled" };

/**
 * Shows a QuickPick for selecting extension type filter.
 * @param extensionsList - List of all extensions to derive available types.
 * @returns The picker result (filter selection or cancelled).
 */
export async function showTypeFilterQuickPick(extensionsList: ExtensionDetails[]): Promise<TypeFilterPickerResult> {
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
		title: "Extension Type Filter",
		placeHolder: "Filter by type",
		matchOnDescription: true,
	});

	if (!selected) {
		return { type: "cancelled" };
	}

	return { type: "filter", value: selected.filterValue };
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
 * Result from the extension QuickPick.
 */
export type ExtensionPickerResult =
	| { type: "registry"; items: readonly ExtensionQuickPickItem[] }
	| { type: "cancelled" };

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
 * Supports smart input detection for alternative sources (GitHub, URL, local path).
 *
 * @param extensionsList - The list of extension details.
 * @param recentlyInstalled - The list of recently installed or used extensions.
 * @param template - Whether this is for template selection. If true, only one template can be selected.
 * @param typeFilter - Optional type filter to apply.
 * @returns A promise that resolves to the picker result.
 */
export async function showExtensionQuickPick(
	extensionsList: ExtensionDetails[],
	recentlyInstalled: string[],
	template = false,
	typeFilter: string | null = null,
): Promise<ExtensionPickerResult> {
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

	// Create items
	const recentItems = createExtensionItems(filteredExtensions.filter((ext) => recentlyInstalled.includes(ext.id)));
	const allItems = createExtensionItems(filteredExtensions.filter((ext) => !recentlyInstalled.includes(ext.id))).sort(
		(a, b) => a.label.localeCompare(b.label),
	);

	// Build the items list
	const items: ExtensionQuickPickItem[] = [];

	if (recentItems.length > 0) {
		items.push({
			label: template ? "Recently Used" : "Recently Installed",
			kind: vscode.QuickPickItemKind.Separator,
		});
		items.push(...recentItems);
	}

	items.push({
		label: typeFilter ? `${filterLabel.trim()} Extensions` : "All Extensions",
		kind: vscode.QuickPickItemKind.Separator,
	});
	items.push(...allItems);

	const quickPick = vscode.window.createQuickPick<ExtensionQuickPickItem>();
	quickPick.placeholder = template ? `Search templates${filterLabel}` : `Search extensions${filterLabel}`;
	quickPick.canSelectMany = !template;
	quickPick.matchOnDescription = true;
	quickPick.matchOnDetail = true;
	quickPick.items = items;

	// Handle item button clicks (GitHub link)
	quickPick.onDidTriggerItemButton((e) => {
		const url = e.item.url;
		if (url) {
			vscode.env.openExternal(vscode.Uri.parse(url));
		}
	});

	return new Promise((resolve) => {
		let resolved = false;

		quickPick.onDidAccept(() => {
			if (resolved) return;
			resolved = true;

			const selected = quickPick.selectedItems;
			resolve({ type: "registry", items: selected });
			quickPick.hide();
		});

		quickPick.onDidHide(() => {
			if (resolved) return;
			resolved = true;
			resolve({ type: "cancelled" });
		});

		quickPick.show();
	});
}
