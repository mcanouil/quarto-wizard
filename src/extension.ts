import * as vscode from "vscode";
import { QW_LOG, STORAGE_KEY_RECENTLY_INSTALLED, STORAGE_KEY_RECENTLY_USED } from "./constants";
import { logMessage, showMessageWithLogs } from "./utils/log";
import {
	installQuartoExtensionCommand,
	useQuartoTemplateCommand,
	installExtensionFromRegistryCommand,
	installExtensionFromURLCommand,
	installExtensionFromGitHubCommand,
	installExtensionFromLocalCommand,
} from "./commands/installQuartoExtension";
import { newQuartoReprexCommand } from "./commands/newQuartoReprex";
import { useBrandCommand } from "./commands/useBrand";
import { ExtensionsInstalled } from "./ui/extensionsInstalled";
import { getExtensionsDetails, clearExtensionsCache } from "./utils/extensionDetails";
import { handleUri } from "./utils/handleUri";
import { setManualToken, clearManualToken } from "./utils/auth";
import { SchemaCache } from "@quarto-wizard/schema";
import { registerYamlProviders } from "./providers/registerYamlProviders";
import { registerShortcodeCompletionProvider } from "./providers/shortcodeCompletionProvider";
import { registerElementAttributeProviders } from "./providers/elementAttributeCompletionProvider";
import { registerInlineAttributeDiagnostics } from "./providers/inlineAttributeDiagnosticsProvider";

/**
 * This method is called when the extension is activated.
 * It registers various commands and initialises the ExtensionsInstalled class that defines the installed extensions view.
 * It also registers a URI handler for extension protocol links.
 *
 * @param context - The context in which the extension is running.
 */
export function activate(context: vscode.ExtensionContext) {
	// Register command to show the extension's output log
	context.subscriptions.push(vscode.commands.registerCommand("quartoWizard.showOutput", () => QW_LOG.show()));
	logMessage("Quarto Wizard, your magical assistant, is now active!", "info");

	// Register command to clear the recently installed/used extensions cache
	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.clearRecent", () => {
			context.globalState.update(STORAGE_KEY_RECENTLY_INSTALLED, []);
			context.globalState.update(STORAGE_KEY_RECENTLY_USED, []);
			const message = "Recently installed Quarto extensions have been cleared.";
			logMessage(message, "info");
			showMessageWithLogs(message, "info");
		}),
	);

	// Register command to clear all cached extension data (registry + recent lists)
	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.clearCache", () => clearExtensionsCache(context)),
	);

	// Register main extension installation command
	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.installExtension", async () =>
			installQuartoExtensionCommand(context),
		),
	);

	// Register template installation command
	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.useTemplate", async () => useQuartoTemplateCommand(context)),
	);

	// Register brand application command
	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.useBrand", async () => useBrandCommand(context)),
	);

	// Register reproducible document creation command
	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.newQuartoReprex", () => newQuartoReprexCommand(context)),
	);

	// Register command to fetch and display extension details from GitHub
	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.getExtensionsDetails", () => getExtensionsDetails(context)),
	);

	// Register command to set a manual GitHub token
	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.setGitHubToken", async () => {
			const token = await vscode.window.showInputBox({
				prompt: "Enter GitHub Personal Access Token",
				password: true,
				placeHolder: "ghp_xxxx or github_pat_xxxx",
				ignoreFocusOut: true,
			});
			if (token) {
				await setManualToken(context, token);
				showMessageWithLogs("GitHub token stored securely.", "info");
			}
		}),
	);

	// Register command to clear the manual GitHub token
	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.clearGitHubToken", async () => {
			await clearManualToken(context);
			showMessageWithLogs("Manual token cleared. Will use VSCode GitHub session or environment variables.", "info");
		}),
	);

	// Register direct source installation commands
	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.installExtensionFromRegistry", async () =>
			installExtensionFromRegistryCommand(context),
		),
	);
	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.installExtensionFromURL", async () =>
			installExtensionFromURLCommand(context),
		),
	);
	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.installExtensionFromGitHub", async () =>
			installExtensionFromGitHubCommand(context),
		),
	);
	context.subscriptions.push(
		vscode.commands.registerCommand("quartoWizard.installExtensionFromLocal", async (resource?: vscode.Uri) =>
			installExtensionFromLocalCommand(context, resource),
		),
	);

	// Shared schema cache for all providers and tree view
	const schemaCache = new SchemaCache();

	// Initialise the Extensions Installed tree view provider
	new ExtensionsInstalled(context, schemaCache);

	// Register YAML completion and diagnostics providers for extension schemas
	registerYamlProviders(context, schemaCache);

	// Register shortcode completion provider for Quarto documents
	registerShortcodeCompletionProvider(context, schemaCache);

	// Register element attribute completion and hover providers for Quarto documents
	registerElementAttributeProviders(context, schemaCache);

	// Register inline attribute diagnostics for spaces around = and schema validation
	registerInlineAttributeDiagnostics(context, schemaCache);

	// Register URI handler for browser-based extension installation (e.g., vscode://mcanouil.quarto-wizard/install?repo=owner/repo)
	context.subscriptions.push(
		vscode.window.registerUriHandler({
			handleUri: (uri: vscode.Uri) => handleUri(uri, context),
		}),
	);
}

/**
 * This method is called when the extension is deactivated.
 * Currently, it does not perform any specific action.
 */
export function deactivate() {
	// No cleanup necessary
}
