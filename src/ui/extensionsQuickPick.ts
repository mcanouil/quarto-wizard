import * as vscode from "vscode";
import { ExtensionDetails } from "../utils/extensionDetails";

/**
 * Contribution type definitions with icons and labels.
 * These map the "contributes" field values from the registry.
 */
const CONTRIBUTION_TYPES: Record<string, { icon: string; label: string }> = {
	filters: { icon: "$(filter)", label: "Filter" },
	shortcodes: { icon: "$(code)", label: "Shortcode" },
	formats: { icon: "$(file-text)", label: "Format" },
	projects: { icon: "$(project)", label: "Project" },
	revealjs: { icon: "$(play)", label: "Reveal.js" },
};

/**
 * Derives extension type badges from the contributes field.
 * @param contributes - What the extension contributes (filters, formats, etc.).
 * @param isTemplate - Whether the extension is a template.
 * @returns Array of type badges as strings.
 */
function getExtensionTypeBadges(contributes: string[], isTemplate: boolean): string[] {
	const badges: string[] = [];

	// Check for known contribution types
	for (const contrib of contributes) {
		const lowerContrib = contrib.toLowerCase();
		if (CONTRIBUTION_TYPES[lowerContrib]) {
			const type = CONTRIBUTION_TYPES[lowerContrib];
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
 * Shows a QuickPick for selecting Quarto extensions.
 * @param {ExtensionDetails[]} extensionsList - The list of extension details.
 * @param {string[]} recentlyInstalled - The list of recently installed or used extensions.
 * @param {boolean} [template=false] - Whether this is for template selection. If true, only one template can be selected.
 * @returns {Promise<readonly ExtensionQuickPickItem[]>} - A promise that resolves to the selected QuickPick items.
 */
export async function showExtensionQuickPick(
	extensionsList: ExtensionDetails[],
	recentlyInstalled: string[],
	template = false,
): Promise<readonly ExtensionQuickPickItem[]> {
	const groupedExtensions: ExtensionQuickPickItem[] = [
		{
			label: template ? "Recently Used" : "Recently Installed",
			kind: vscode.QuickPickItemKind.Separator,
		},
		...createExtensionItems(extensionsList.filter((ext) => recentlyInstalled.includes(ext.id))),
		{
			label: "All Extensions",
			kind: vscode.QuickPickItemKind.Separator,
		},
		...createExtensionItems(extensionsList.filter((ext) => !recentlyInstalled.includes(ext.id))).sort((a, b) =>
			a.label.localeCompare(b.label),
		),
	];

	const quickPick = vscode.window.createQuickPick<ExtensionQuickPickItem>();
	quickPick.items = groupedExtensions;
	quickPick.placeholder = template
		? "Search and select a Quarto template to use"
		: "Search and select Quarto extensions to install";
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
