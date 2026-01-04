import * as vscode from "vscode";
import type { DiscoveredExtension } from "@quarto-wizard/core";

/**
 * QuickPick item for extension selection.
 */
interface ExtensionSelectionItem extends vscode.QuickPickItem {
	extension: DiscoveredExtension;
}

/**
 * Show a QuickPick dialog for selecting which extension(s) to install
 * when a repository contains multiple extensions.
 *
 * @param extensions - Array of discovered extensions in the source
 * @returns Selected extensions to install, or null if cancelled
 */
export async function showExtensionSelectionQuickPick(
	extensions: DiscoveredExtension[],
): Promise<DiscoveredExtension[] | null> {
	const items: ExtensionSelectionItem[] = extensions.map((ext) => {
		const label = ext.id.owner ? `${ext.id.owner}/${ext.id.name}` : ext.id.name;
		return {
			label,
			description: ext.relativePath,
			picked: false,
			extension: ext,
		};
	});

	const selected = await vscode.window.showQuickPick(items, {
		title: "Select Extension(s) to Install",
		placeHolder: "This repository contains multiple extensions. Select which to install.",
		canPickMany: true,
	});

	if (!selected || selected.length === 0) {
		return null;
	}

	return selected.map((item) => item.extension);
}
