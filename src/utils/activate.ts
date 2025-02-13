import * as vscode from "vscode";
import { QUARTO_WIZARD_LOG } from "../constants";

export async function activateExtensions(extensionsToActivate: string[]): Promise<void> {
	extensionsToActivate.forEach(async (extensionId) => {
		const extension = await vscode.extensions.getExtension(extensionId);
		console.log(`Activating ${extensionId}...`);
		if (extension) {
			if (!extension.isActive) {
				await extension.activate();
			}
			QUARTO_WIZARD_LOG.appendLine(`${extensionId} activated.`);
		} else {
			QUARTO_WIZARD_LOG.appendLine(`Failed to activate ${extensionId}.`);
		}
	});
}
