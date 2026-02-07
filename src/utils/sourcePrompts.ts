import * as vscode from "vscode";
import * as path from "path";
import { parseInstallSource } from "@quarto-wizard/core";

/**
 * Source type display names for logging.
 */
const SOURCE_TYPE_NAMES: Record<string, string> = {
	url: "URL",
	local: "local path",
	github: "GitHub",
};

/**
 * Options for customising the source prompt labels.
 */
interface SourcePromptOptions {
	/** Title prefix for the input box (e.g., "Brand" or empty). */
	titlePrefix?: string;
	/** Context label for input descriptions (e.g., "brand archive" or "extension archive"). */
	archiveLabel?: string;
	/** Label for the file picker dialog title. */
	selectTitle?: string;
	/** Label for the file picker open button. */
	openLabel?: string;
}

/**
 * Prompts the user to enter a GitHub reference.
 *
 * @param options - Optional customisation for prompt labels.
 * @returns The entered reference or undefined if cancelled.
 */
export async function promptForGitHubReference(options?: SourcePromptOptions): Promise<string | undefined> {
	const titlePrefix = options?.titlePrefix ? `${options.titlePrefix} ` : "";
	return vscode.window.showInputBox({
		title: `${titlePrefix}GitHub Reference`,
		prompt: `Enter a GitHub reference${titlePrefix ? ` for the ${titlePrefix.toLowerCase().trim()}` : ""}`,
		placeHolder: "owner/repo or owner/repo@version",
		ignoreFocusOut: true,
		validateInput: (value) => {
			if (!value?.trim()) {
				return "GitHub reference is required.";
			}
			if (!value.includes("/")) {
				return "Use format: owner/repo or owner/repo@version";
			}
			return null;
		},
	});
}

/**
 * Prompts the user to enter a URL.
 *
 * @param options - Optional customisation for prompt labels.
 * @returns The entered URL or undefined if cancelled.
 */
export async function promptForURL(options?: SourcePromptOptions): Promise<string | undefined> {
	const archiveLabel = options?.archiveLabel ?? "extension archive";
	return vscode.window.showInputBox({
		title: options?.titlePrefix ? `${options.titlePrefix} URL` : "URL",
		prompt: `Enter URL to ${archiveLabel}`,
		placeHolder: "https://example.com/extension.zip",
		ignoreFocusOut: true,
		validateInput: (value) => {
			if (!value?.trim()) {
				return "URL is required.";
			}
			if (!value.startsWith("http://") && !value.startsWith("https://")) {
				return "URL must start with http:// or https://";
			}
			return null;
		},
	});
}

/**
 * Prompts the user to select a local file or folder.
 *
 * @param options - Optional customisation for prompt labels.
 * @returns The selected path or undefined if cancelled.
 */
export async function promptForLocalPath(options?: SourcePromptOptions): Promise<string | undefined> {
	const uris = await vscode.window.showOpenDialog({
		canSelectFiles: true,
		canSelectFolders: true,
		canSelectMany: false,
		title: options?.selectTitle ?? "Select Extension",
		openLabel: options?.openLabel ?? "Install",
		filters: {
			"Archive files": ["zip", "tar.gz", "tgz"],
			"All files": ["*"],
		},
	});

	if (!uris || uris.length === 0) {
		return undefined;
	}

	return uris[0].fsPath;
}

/**
 * Resolve a source path relative to the workspace folder if needed.
 *
 * @param source - The source string (might be relative path).
 * @param workspaceFolder - The workspace folder for resolving relative paths.
 * @returns Object with resolved source path, original source for display, and type name.
 */
export function resolveSourcePath(
	source: string,
	workspaceFolder: string,
): { resolved: string; display: string | undefined; type: string } {
	try {
		const parsed = parseInstallSource(source);
		const type = SOURCE_TYPE_NAMES[parsed.type] ?? "unknown";

		if (parsed.type === "local" && !path.isAbsolute(parsed.path)) {
			const resolved = path.resolve(workspaceFolder, parsed.path);
			return { resolved, display: source, type };
		}

		return { resolved: source, display: undefined, type };
	} catch {
		return { resolved: source, display: undefined, type: "unknown" };
	}
}
