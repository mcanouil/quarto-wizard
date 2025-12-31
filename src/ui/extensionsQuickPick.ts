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
	/** Alternative source type (for non-registry items). */
	_sourceType?: "github" | "url" | "local";
	/** Alternative source value (for non-registry items). */
	_sourceValue?: string;
}

/**
 * Result from the type filter QuickPick.
 * Either a filter selection or an alternative source.
 */
export type TypeFilterPickerResult =
	| { type: "filter"; value: string | null }
	| { type: "github"; source: string }
	| { type: "url"; source: string }
	| { type: "local"; source: string }
	| { type: "cancelled" };

/**
 * Create a source item for the type filter picker.
 * @param detected - The detected source type.
 * @returns A TypeFilterItem for the source, or null if registry.
 */
function createTypeFilterSourceItem(detected: DetectedSource): TypeFilterItem | null {
	switch (detected.type) {
		case "github":
			return {
				label: "$(github) Install from GitHub",
				description: detected.value,
				detail: "Press Enter to install this extension from GitHub",
				alwaysShow: true,
				filterValue: null,
				_sourceType: "github",
				_sourceValue: detected.value,
			};
		case "url":
			return {
				label: "$(link) Install from URL",
				description: detected.value,
				detail: "Press Enter to install this extension from URL",
				alwaysShow: true,
				filterValue: null,
				_sourceType: "url",
				_sourceValue: detected.value,
			};
		case "local":
			return {
				label: "$(folder) Install from Local",
				description: detected.value,
				detail: "Press Enter to install this extension from local path",
				alwaysShow: true,
				filterValue: null,
				_sourceType: "local",
				_sourceValue: detected.value,
			};
		default:
			return null;
	}
}

/**
 * Shows a QuickPick for selecting extension type filter.
 * Supports smart input detection for alternative sources (GitHub, URL, local path).
 * @param extensionsList - List of all extensions to derive available types.
 * @returns The picker result (filter selection or alternative source).
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

	// Build registry ID set for source detection
	const registryIds = new Set(extensionsList.map((ext) => ext.id));

	// Build base filter items
	const baseFilterItems: TypeFilterItem[] = [
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
			baseFilterItems.push({
				label: `${typeInfo.icon} ${typeInfo.label}`,
				description: `${count} extensions`,
				filterValue: type,
			});
		}
	}

	// Add template filter if templates exist
	if (templateCount > 0) {
		baseFilterItems.push({
			label: "$(file-code) Template",
			description: `${templateCount} extensions`,
			filterValue: "template",
		});
	}

	const quickPick = vscode.window.createQuickPick<TypeFilterItem>();
	quickPick.placeholder = "Filter by type, or enter: owner/repo, URL, or local path";
	quickPick.title = "Extension Type Filter";
	quickPick.matchOnDescription = true;

	// Function to rebuild items based on current input
	const updateItems = (value: string) => {
		const detected = detectSource(value, registryIds);
		const sourceItem = createTypeFilterSourceItem(detected);

		const items: TypeFilterItem[] = [];

		// Add source item at top if detected
		if (sourceItem) {
			items.push(sourceItem);
			items.push({ label: "", kind: vscode.QuickPickItemKind.Separator, filterValue: null });
		}

		// Add filter items
		items.push(...baseFilterItems);

		quickPick.items = items;
	};

	// Initial items
	updateItems("");

	// Update items on input change
	quickPick.onDidChangeValue(updateItems);

	return new Promise((resolve) => {
		let resolved = false;

		quickPick.onDidAccept(() => {
			if (resolved) return;
			resolved = true;

			const selected = quickPick.selectedItems[0];

			if (selected?._sourceType) {
				// User selected an alternative source item
				const sourceType = selected._sourceType;
				resolve({
					type: sourceType,
					source: selected._sourceValue!,
				} as TypeFilterPickerResult);
			} else {
				// User selected a filter item
				resolve({ type: "filter", value: selected?.filterValue ?? null });
			}
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
	/** Alternative source type (for non-registry items). */
	_sourceType?: "github" | "url" | "local";
	/** Alternative source value (for non-registry items). */
	_sourceValue?: string;
}

/**
 * Detected input source type.
 */
type DetectedSource =
	| { type: "registry" }
	| { type: "github"; value: string }
	| { type: "url"; value: string }
	| { type: "local"; value: string };

/**
 * Result from the extension QuickPick.
 * Either selected extensions from registry, or an alternative source string.
 */
export type ExtensionPickerResult =
	| { type: "registry"; items: readonly ExtensionQuickPickItem[] }
	| { type: "github"; source: string }
	| { type: "url"; source: string }
	| { type: "local"; source: string }
	| { type: "cancelled" };

/**
 * Detect the type of source from user input.
 * @param input - The user's input string.
 * @param registryIds - Set of known registry extension IDs.
 * @returns The detected source type.
 */
function detectSource(input: string, registryIds: Set<string>): DetectedSource {
	const trimmed = input.trim();

	if (!trimmed) {
		return { type: "registry" };
	}

	// URL detection: starts with http:// or https://
	if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
		return { type: "url", value: trimmed };
	}

	// Local path detection: starts with /, ~, or drive letter (Windows)
	if (trimmed.startsWith("/") || trimmed.startsWith("~") || /^[a-zA-Z]:[/\\]/.test(trimmed)) {
		return { type: "local", value: trimmed };
	}

	// GitHub detection: contains / but not in registry
	// Handles: owner/repo, owner/repo@version, owner/repo@branch
	if (trimmed.includes("/")) {
		const baseId = trimmed.split("@")[0]; // Remove version/tag suffix
		if (!registryIds.has(baseId)) {
			return { type: "github", value: trimmed };
		}
	}

	// Default: search registry
	return { type: "registry" };
}

/**
 * Create a QuickPick item for an alternative source.
 * @param detected - The detected source type.
 * @returns A QuickPick item for the source, or null if registry.
 */
function createSourceItem(detected: DetectedSource): ExtensionQuickPickItem | null {
	switch (detected.type) {
		case "github":
			return {
				label: "$(github) Install from GitHub",
				description: detected.value,
				detail: "Press Enter to install this extension from GitHub",
				alwaysShow: true,
				_sourceType: "github",
				_sourceValue: detected.value,
			};
		case "url":
			return {
				label: "$(link) Install from URL",
				description: detected.value,
				detail: "Press Enter to install this extension from URL",
				alwaysShow: true,
				_sourceType: "url",
				_sourceValue: detected.value,
			};
		case "local":
			return {
				label: "$(folder) Install from Local",
				description: detected.value,
				detail: "Press Enter to install this extension from local path",
				alwaysShow: true,
				_sourceType: "local",
				_sourceValue: detected.value,
			};
		default:
			return null;
	}
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

	// Build registry ID set for source detection
	const registryIds = new Set(filteredExtensions.map((ext) => ext.id));

	// Get the type label for the placeholder
	let filterLabel = "";
	if (typeFilter) {
		if (typeFilter === "template") {
			filterLabel = " (Templates)";
		} else if (CONTRIBUTION_TYPES[typeFilter]) {
			filterLabel = ` (${CONTRIBUTION_TYPES[typeFilter].label}s)`;
		}
	}

	// Create base items (cached for reuse during input changes)
	const recentItems = createExtensionItems(filteredExtensions.filter((ext) => recentlyInstalled.includes(ext.id)));
	const allItems = createExtensionItems(
		filteredExtensions.filter((ext) => !recentlyInstalled.includes(ext.id)),
	).sort((a, b) => a.label.localeCompare(b.label));

	const quickPick = vscode.window.createQuickPick<ExtensionQuickPickItem>();
	quickPick.placeholder = template
		? `Search registry, or enter: owner/repo, URL, or local path${filterLabel}`
		: `Search registry, or enter: owner/repo, URL, or local path${filterLabel}`;
	quickPick.canSelectMany = !template;
	quickPick.matchOnDescription = true;
	quickPick.matchOnDetail = true;

	// Function to rebuild items based on current input
	const updateItems = (value: string) => {
		const detected = detectSource(value, registryIds);
		const sourceItem = createSourceItem(detected);

		const items: ExtensionQuickPickItem[] = [];

		// Add source item at top if detected
		if (sourceItem) {
			items.push(sourceItem);
			items.push({ label: "", kind: vscode.QuickPickItemKind.Separator });
		}

		// Add registry items
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

		quickPick.items = items;
	};

	// Initial items
	updateItems("");

	// Update items on input change
	quickPick.onDidChangeValue(updateItems);

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

			if (selected.length === 1 && selected[0]._sourceType) {
				// User selected an alternative source item
				const item = selected[0];
				const sourceType = item._sourceType;
				resolve({
					type: sourceType,
					source: item._sourceValue!,
				} as ExtensionPickerResult);
			} else {
				// User selected registry items
				const registryItems = selected.filter((item) => !item._sourceType);
				resolve({ type: "registry", items: registryItems });
			}
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
