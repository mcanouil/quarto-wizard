import * as vscode from "vscode";
import { getShowLogsLink, logMessage, showMessageWithLogs } from "../utils/log";
import { checkInternetConnection } from "../utils/network";
import { useQuartoBrand } from "../utils/quarto";
import { confirmTrustAuthors, confirmInstall } from "../utils/ask";
import { selectWorkspaceFolder } from "../utils/workspace";
import { getAuthConfig, logAuthStatus } from "../utils/auth";
import { promptForGitHubReference, promptForURL, promptForLocalPath, resolveSourcePath } from "../utils/sourcePrompts";
import { showSourcePicker } from "../ui/extensionsQuickPick";

/**
 * Brand-specific prompt options for shared source prompt helpers.
 */
const BRAND_PROMPT_OPTIONS = {
	github: { titlePrefix: "Brand" },
	url: { titlePrefix: "Brand", archiveLabel: "brand archive" },
	local: { selectTitle: "Select Brand Source", openLabel: "Use Brand" },
};

/**
 * Apply a brand from a specific source.
 *
 * @param context - Extension context for authentication.
 * @param source - Source string.
 * @param workspaceFolder - Target workspace folder.
 */
async function useBrandFromSource(
	context: vscode.ExtensionContext,
	source: string,
	workspaceFolder: string,
): Promise<void> {
	if (!(await confirmTrustAuthors())) return;
	if (!(await confirmInstall())) return;

	const { resolved, display, type } = resolveSourcePath(source, workspaceFolder);
	const auth = await getAuthConfig(context);

	logMessage(`Source: ${type}.`, "info");
	logMessage(`Brand: ${source}.`, "info");
	logAuthStatus(auth);

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `Applying brand from ${display ?? source} (${getShowLogsLink()})`,
			cancellable: true,
		},
		async (_progress, token) => {
			if (token.isCancellationRequested) {
				return;
			}

			const result = await useQuartoBrand(resolved, workspaceFolder, auth, display, token);

			if (result) {
				const totalFiles = result.created.length + result.overwritten.length;
				let message: string;
				if (totalFiles === 0 && result.skipped.length > 0) {
					message = `Brand files skipped, overwrite declined (${result.skipped.length} existing file(s) in _brand/).`;
				} else {
					message = `Brand applied successfully (${totalFiles} file(s) in _brand/).`;
				}
				logMessage(message, "info");
				showMessageWithLogs(message, "info");
			} else if (!token.isCancellationRequested) {
				// result === null without cancellation can mean either an actual error or
				// the user declining authentication. Show a neutral message and point to
				// logs where the specific reason is recorded.
				showMessageWithLogs("Brand operation did not complete. See logs for details.", "warning");
			}
		},
	);
}

/**
 * Command handler for "Quarto Wizard: Use Brand".
 *
 * @param context - Extension context.
 */
export async function useBrandCommand(context: vscode.ExtensionContext): Promise<void> {
	const workspaceFolder = await selectWorkspaceFolder();
	if (!workspaceFolder) {
		return;
	}

	const sourceResult = await showSourcePicker({
		title: "Use Brand From",
		placeHolder: "Select where to get the brand from",
		includeRegistry: false,
		actionVerb: "Use brand",
	});
	if (sourceResult.type === "cancelled") {
		return;
	}

	// Only check internet connectivity for remote sources (not local)
	if (sourceResult.type !== "local") {
		const isConnected = await checkInternetConnection("https://github.com/");
		if (!isConnected) {
			return;
		}
	}

	let source: string | undefined;

	switch (sourceResult.type) {
		case "github":
			source = await promptForGitHubReference(BRAND_PROMPT_OPTIONS.github);
			break;
		case "url":
			source = await promptForURL(BRAND_PROMPT_OPTIONS.url);
			break;
		case "local":
			source = await promptForLocalPath(BRAND_PROMPT_OPTIONS.local);
			break;
	}

	if (!source) {
		return;
	}

	await useBrandFromSource(context, source, workspaceFolder);
}
