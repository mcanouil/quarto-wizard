import * as vscode from "vscode";
import {
	install,
	remove,
	removeMultiple,
	use,
	useBrand,
	parseInstallSource,
	parseExtensionId,
	createAuthConfig,
	CancellationError,
	isCancellationError,
	type UseResult,
	type UseBrandResult,
	type UseBrandOptions,
	type FileSelectionCallback,
	type SelectTargetSubdirCallback,
	type AuthConfig,
	type SourceType,
	type DiscoveredExtension,
	type ExtensionManifest,
	type RemoveResult,
	type ExtensionId,
	getErrorMessage,
} from "@quarto-wizard/core";
import { logMessage } from "./log";
import { handleAuthError } from "./auth";
import { formatExtensionId } from "./extensions";
import { getQuartoVersionInfo } from "../services/quartoVersion";
import { validateQuartoRequirement } from "./versionValidation";
import { showExtensionSelectionQuickPick } from "../ui/extensionSelectionQuickPick";

type ParsedInstallSource = ReturnType<typeof parseInstallSource>;

/**
 * Optional parameters for {@link installQuartoExtension}.
 */
export interface InstallOptions {
	auth?: AuthConfig;
	sourceDisplay?: string;
	skipOverwritePrompt?: boolean;
	cancellationToken?: vscode.CancellationToken;
	sourceType?: SourceType;
}

/**
 * Optional parameters for {@link useQuartoExtension}.
 */
export interface UseOptions {
	selectFiles?: FileSelectionCallback;
	selectTargetSubdir?: SelectTargetSubdirCallback;
	auth?: AuthConfig;
	sourceDisplay?: string;
	cancellationToken?: vscode.CancellationToken;
	sourceType?: SourceType;
}

/**
 * Optional parameters for {@link useQuartoBrand}.
 */
export interface BrandOptions {
	auth?: AuthConfig;
	sourceDisplay?: string;
	cancellationToken?: vscode.CancellationToken;
}

/**
 * Wraps an async callback with a cancellation check that runs before the callback is invoked.
 * Returns the original callback if no cancellation token is provided.
 */
function wrapWithCancellation<TArgs extends unknown[], TResult>(
	fn: (...args: TArgs) => Promise<TResult>,
	cancellationToken: vscode.CancellationToken | undefined,
	cancelledValue: TResult,
): (...args: TArgs) => Promise<TResult> {
	if (!cancellationToken) {
		return fn;
	}
	return async (...args: TArgs) => {
		if (cancellationToken.isCancellationRequested) {
			logMessage(`Callback skipped: operation cancelled by the user.`, "debug");
			return cancelledValue;
		}
		return fn(...args);
	};
}

/**
 * Obtains a fresh GitHub auth config from the current session.
 */
async function getFreshAuth(): Promise<AuthConfig> {
	const session = await vscode.authentication.getSession("github", ["repo"], { silent: true });
	return session ? createAuthConfig({ githubToken: session.accessToken }) : createAuthConfig();
}

/**
 * Handles the retry-after-authentication pattern.
 * If the error triggers a successful auth flow, retries the operation with fresh credentials.
 *
 * @param prefix - Log prefix for messages.
 * @param error - The caught error.
 * @param cancellationToken - Optional cancellation token.
 * @param retryFn - The operation to retry, receiving fresh auth.
 * @param fallbackValue - Value to return when retry is not attempted or fails.
 * @returns The result of the retry, or the fallback value.
 */
async function retryWithFreshAuth<T>(
	prefix: string,
	error: unknown,
	cancellationToken: vscode.CancellationToken | undefined,
	retryFn: (freshAuth: AuthConfig) => Promise<T>,
	fallbackValue: T,
): Promise<T> {
	const signedIn = await handleAuthError(prefix, error);
	if (!signedIn) {
		return fallbackValue;
	}
	if (cancellationToken?.isCancellationRequested) {
		logMessage(`${prefix} Operation cancelled by the user.`, "info");
		return fallbackValue;
	}
	logMessage(`${prefix} Retrying after successful authentication.`, "info");
	try {
		const freshAuth = await getFreshAuth();
		return await retryFn(freshAuth);
	} catch (retryError) {
		logMessage(`${prefix} Retry failed: ${getErrorMessage(retryError)}.`, "error");
		return fallbackValue;
	}
}

/**
 * Parses source, runs the operation, and retries with fresh auth on failure.
 */
async function runWithParsedSourceAndAuthRetry<T>(
	sourceInput: string,
	initialAuth: AuthConfig | undefined,
	prefix: string,
	cancellationToken: vscode.CancellationToken | undefined,
	run: (source: ParsedInstallSource, authConfig?: AuthConfig) => Promise<T>,
	fallbackValue: T,
): Promise<T> {
	try {
		const source = parseInstallSource(sourceInput);
		return await run(source, initialAuth);
	} catch (error) {
		logMessage(`${prefix} Error: ${getErrorMessage(error)}.`, "error");
		return retryWithFreshAuth(
			prefix,
			error,
			cancellationToken,
			async (freshAuth) => {
				const source = parseInstallSource(sourceInput);
				return run(source, freshAuth);
			},
			fallbackValue,
		);
	}
}

/**
 * Creates a callback for confirming extension overwrite.
 *
 * @param prefix - Log prefix for messages
 * @param skipPrompt - If true, return true without prompting
 * @returns Callback function
 */
function createConfirmOverwriteCallback(
	prefix: string,
	skipPrompt: boolean,
): (extension: DiscoveredExtension) => Promise<boolean> {
	return async (extension: DiscoveredExtension): Promise<boolean> => {
		if (skipPrompt) {
			return true;
		}
		const extId = formatExtensionId(extension.id);
		const action = await vscode.window.showWarningMessage(
			`Extension "${extId}" already exists. Overwrite?`,
			{ modal: true },
			"Overwrite",
		);
		if (action !== "Overwrite") {
			logMessage(`${prefix} Installation cancelled - extension already exists.`, "info");
			return false;
		}
		return true;
	};
}

/**
 * Creates a callback for validating Quarto version requirements.
 *
 * @param prefix - Log prefix for messages
 * @returns Callback function
 */
function createValidateQuartoVersionCallback(
	prefix: string,
): (required: string, manifest: ExtensionManifest) => Promise<boolean> {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	return async (required: string, _manifest: ExtensionManifest): Promise<boolean> => {
		const quartoInfo = await getQuartoVersionInfo();
		const validation = validateQuartoRequirement(required, quartoInfo.version);

		if (!validation.valid) {
			logMessage(`${prefix} Version requirement not met: ${validation.message}.`, "warn");

			const action = await vscode.window.showWarningMessage(
				`${validation.message}`,
				{ modal: true, detail: "The extension may not work correctly with your current Quarto version." },
				"Install Anyway",
			);

			if (action !== "Install Anyway") {
				logMessage(`${prefix} Installation cancelled by user due to version mismatch.`, "info");
				return false;
			}

			logMessage(`${prefix} User chose to install despite version mismatch.`, "info");
		}
		return true;
	};
}

/**
 * Installs a Quarto extension using the core library.
 * Uses single-pass installation with interactive callbacks for overwrite and version validation.
 *
 * @param extension - The name of the extension to install (e.g., "owner/repo" or "owner/repo@version").
 * @param workspaceFolder - The workspace folder path.
 * @param options - Optional installation parameters.
 * @returns A promise that resolves to true if successful, false if failed, or null if cancelled by user.
 */
export async function installQuartoExtension(
	extension: string,
	workspaceFolder: string,
	options: InstallOptions = {},
): Promise<boolean | null> {
	const { auth, sourceDisplay, skipOverwritePrompt, cancellationToken, sourceType } = options;
	const prefix = `[${sourceDisplay ?? extension}]`;
	logMessage(`${prefix} Installing ...`, "info");

	if (!workspaceFolder) {
		logMessage(`${prefix} No workspace folder specified.`, "error");
		return false;
	}

	const selectExtension = wrapWithCancellation(showExtensionSelectionQuickPick, cancellationToken, null);

	const doInstall = async (source: ParsedInstallSource, authConfig?: AuthConfig): Promise<boolean | null> => {
		const result = await install(source, {
			projectDir: workspaceFolder,
			force: true,
			auth: authConfig,
			sourceDisplay,
			sourceType,
			selectExtension,
			confirmOverwrite: createConfirmOverwriteCallback(prefix, skipOverwritePrompt ?? false),
			validateQuartoVersion: createValidateQuartoVersionCallback(prefix),
			onProgress: (progress) => {
				logMessage(`${prefix} [${progress.phase}] ${progress.message}`, "debug");
			},
		});

		if (result.cancelled) {
			logMessage(`${prefix} Installation cancelled by user.`, "info");
			return null;
		}

		if (result.success) {
			if (result.additionalInstallFailures && result.additionalInstallFailures.length > 0) {
				const failed = result.additionalInstallFailures.map((f) => formatExtensionId(f.extensionId)).join(", ");
				logMessage(
					`${prefix} Installed, but failed to install ${result.additionalInstallFailures.length} additional extension(s): ${failed}.`,
					"warn",
				);
			} else {
				logMessage(`${prefix} Successfully installed.`, "info");
			}
			void vscode.commands.executeCommand("quartoWizard.extensionsInstalled.refresh");
			return true;
		} else {
			logMessage(`${prefix} Failed to install.`, "error");
			return false;
		}
	};

	return runWithParsedSourceAndAuthRetry(extension, auth, prefix, cancellationToken, doInstall, false);
}

/**
 * Removes a Quarto extension using the core library.
 *
 * @param {string} extension - The name of the extension to remove (e.g., "owner/name").
 * @param {string} workspaceFolder - The workspace folder path.
 * @returns {Promise<boolean>} - A promise that resolves to true if the extension is removed successfully, otherwise false.
 */
export async function removeQuartoExtension(extension: string, workspaceFolder: string): Promise<boolean> {
	const prefix = `[${extension}]`;
	logMessage(`${prefix} Removing ...`, "info");

	if (!workspaceFolder) {
		logMessage(`${prefix} No workspace folder specified.`, "error");
		return false;
	}

	try {
		const extensionId = parseExtensionId(extension);

		const result = await remove(extensionId, {
			projectDir: workspaceFolder,
			cleanupEmpty: true,
		});

		if (result.success) {
			logMessage(`${prefix} Successfully removed.`, "info");
			void vscode.commands.executeCommand("quartoWizard.extensionsInstalled.refresh");
			return true;
		} else {
			logMessage(`${prefix} Failed to remove.`, "error");
			return false;
		}
	} catch (error) {
		logMessage(`${prefix} Error: ${getErrorMessage(error)}.`, "error");
		return false;
	}
}

/**
 * Batch removal result for tracking success/failure.
 */
export interface BatchRemoveResult {
	successCount: number;
	failedExtensions: string[];
}

/**
 * Removes multiple Quarto extensions using the core library.
 *
 * @param extensions - Array of extension names to remove (e.g., "owner/name").
 * @param workspaceFolder - The workspace folder path.
 * @returns A promise that resolves to the batch remove result.
 */
export async function removeQuartoExtensions(
	extensions: string[],
	workspaceFolder: string,
): Promise<BatchRemoveResult> {
	const prefix = `[batch-remove]`;
	logMessage(`${prefix} Removing ${extensions.length} extension(s): ${extensions.join(", ")}.`, "info");

	if (!workspaceFolder) {
		logMessage(`${prefix} No workspace folder specified.`, "error");
		return { successCount: 0, failedExtensions: extensions };
	}

	try {
		const extensionIds = extensions.map((ext) => parseExtensionId(ext));

		const results = await removeMultiple(extensionIds, {
			projectDir: workspaceFolder,
			cleanupEmpty: true,
		});

		const isRemoveError = (
			r: RemoveResult | { extensionId: ExtensionId; error: string },
		): r is { extensionId: ExtensionId; error: string } => "error" in r;

		const successCount = results.filter((r) => !isRemoveError(r) && r.success).length;
		const failedExtensions = results.filter(isRemoveError).map((r) => formatExtensionId(r.extensionId));

		if (successCount > 0) {
			logMessage(`${prefix} Successfully removed ${successCount} extension(s).`, "info");
		}
		if (failedExtensions.length > 0) {
			logMessage(`${prefix} Failed to remove: ${failedExtensions.join(", ")}.`, "error");
		}

		void vscode.commands.executeCommand("quartoWizard.extensionsInstalled.refresh");

		return { successCount, failedExtensions };
	} catch (error) {
		logMessage(`${prefix} Error: ${getErrorMessage(error)}.`, "error");
		return { successCount: 0, failedExtensions: extensions };
	}
}

/**
 * Callback to confirm overwriting existing extensions.
 * Shows a VS Code dialog for each extension that already exists.
 *
 * @param extensions - Extensions that already exist in the project.
 * @returns Extensions to overwrite, or null to cancel.
 */
async function showExtensionOverwriteConfirmation(
	extensions: DiscoveredExtension[],
): Promise<DiscoveredExtension[] | null> {
	if (extensions.length === 0) {
		return [];
	}

	const extNames = extensions.map((ext) => formatExtensionId(ext.id)).join(", ");

	const message =
		extensions.length === 1
			? `Extension "${extNames}" already exists. Overwrite?`
			: `${extensions.length} extensions already exist: ${extNames}. Overwrite all?`;

	const action = await vscode.window.showWarningMessage(message, { modal: true }, "Overwrite", "Skip");

	if (action === "Overwrite") {
		return extensions;
	} else if (action === "Skip") {
		return [];
	}
	// User cancelled (dismissed the dialog)
	return null;
}

/**
 * Uses a Quarto template extension: installs it and copies template files to the project.
 *
 * The flow is:
 * 1. File selection dialog (which files to copy from template).
 * 2. Extension selection dialog (if source contains multiple extensions).
 * 3. Overwrite confirmation (for extensions that already exist).
 * 4. Install selected extensions and copy selected files.
 *
 * @param extension - The name of the extension to use (e.g., "owner/repo" or "owner/repo@version").
 * @param workspaceFolder - The workspace folder path.
 * @param options - Optional use parameters.
 * @returns A promise that resolves to the use result, or null on failure.
 */
export async function useQuartoExtension(
	extension: string,
	workspaceFolder: string,
	options: UseOptions = {},
): Promise<UseResult | null> {
	const { selectFiles, selectTargetSubdir, auth, sourceDisplay, cancellationToken, sourceType } = options;
	const prefix = `[${sourceDisplay ?? extension}]`;
	logMessage(`${prefix} Using template ...`, "info");

	if (!workspaceFolder) {
		logMessage(`${prefix} No workspace folder specified.`, "error");
		return null;
	}

	const wrappedSelectFiles = selectFiles ? wrapWithCancellation(selectFiles, cancellationToken, null) : undefined;
	const wrappedSelectTargetSubdir = selectTargetSubdir
		? wrapWithCancellation(selectTargetSubdir, cancellationToken, undefined)
		: undefined;
	const wrappedSelectExtension = wrapWithCancellation(showExtensionSelectionQuickPick, cancellationToken, null);

	const doUse = async (source: ParsedInstallSource, authConfig?: AuthConfig): Promise<UseResult | null> => {
		const result = await use(source, {
			projectDir: workspaceFolder,
			selectFiles: wrappedSelectFiles,
			selectTargetSubdir: wrappedSelectTargetSubdir,
			selectFilesFirst: true,
			selectExtension: wrappedSelectExtension,
			confirmExtensionOverwrite: showExtensionOverwriteConfirmation,
			auth: authConfig,
			sourceDisplay,
			sourceType,
			onProgress: (progress) => {
				if (progress.file) {
					logMessage(`${prefix} [${progress.phase}] ${progress.message} (${progress.file})`, "debug");
				} else {
					logMessage(`${prefix} [${progress.phase}] ${progress.message}`, "debug");
				}
			},
		});

		if (result.cancelled) {
			logMessage(`${prefix} Template usage cancelled by user.`, "info");
			return null;
		}

		if (result.install.success) {
			logMessage(`${prefix} Successfully installed template.`, "info");

			if (result.templateFiles.length > 0) {
				logMessage(`${prefix} Copied ${result.templateFiles.length} template file(s):`, "info");
				result.templateFiles.forEach((file) => logMessage(`${prefix}   - ${file}`, "info"));
			}

			if (result.skippedFiles.length > 0) {
				logMessage(`${prefix} Skipped ${result.skippedFiles.length} existing file(s):`, "info");
				result.skippedFiles.forEach((file) => logMessage(`${prefix}   - ${file}`, "info"));
			}

			void vscode.commands.executeCommand("quartoWizard.extensionsInstalled.refresh");
			return result;
		} else {
			logMessage(`${prefix} Failed to use template.`, "error");
			return null;
		}
	};

	return runWithParsedSourceAndAuthRetry(extension, auth, prefix, cancellationToken, doUse, null);
}

/**
 * Downloads and applies a Quarto brand to the project's _brand/ directory.
 *
 * @param source - Brand source (e.g., "owner/repo" or local path).
 * @param workspaceFolder - The workspace folder path.
 * @param options - Optional parameters.
 * @returns Brand result, or null on failure.
 */
export async function useQuartoBrand(
	source: string,
	workspaceFolder: string,
	options: BrandOptions = {},
): Promise<UseBrandResult | null> {
	const { auth, sourceDisplay, cancellationToken } = options;
	const prefix = `[${sourceDisplay ?? source}]`;
	logMessage(`${prefix} Applying brand ...`, "info");

	if (!workspaceFolder) {
		logMessage(`${prefix} No workspace folder specified.`, "error");
		return null;
	}

	// Interactive callbacks (confirmOverwrite, cleanupExtra) throw CancellationError
	// when the token fires so that useBrand aborts cleanly before any destructive
	// action. The onProgress callback only logs; throwing from it could interrupt a
	// file copy mid-write and leave _brand/ in a partially-written state.
	const brandOptions: UseBrandOptions = {
		projectDir: workspaceFolder,
		auth,
		confirmOverwrite: async (files: string[]) => {
			if (cancellationToken?.isCancellationRequested) {
				throw new CancellationError();
			}
			const fileList = files.join(", ");
			const message =
				files.length === 1
					? `File "${fileList}" already exists in _brand/. Overwrite?`
					: `${files.length} files already exist in _brand/: ${fileList}. Overwrite all?`;
			const action = await vscode.window.showWarningMessage(message, { modal: true }, "Overwrite");
			return action === "Overwrite";
		},
		cleanupExtra: async (files: string[]) => {
			if (cancellationToken?.isCancellationRequested) {
				throw new CancellationError();
			}
			const fileList = files.map((f) => `  - ${f}`).join("\n");
			const message = `${files.length} extra file(s) in _brand/ not present in the brand source:\n${fileList}\n\nRemove them?`;
			const action = await vscode.window.showWarningMessage(message, { modal: true }, "Remove", "Keep");
			return action === "Remove";
		},
		onProgress: (progress) => {
			if (cancellationToken?.isCancellationRequested) {
				return;
			}
			if (progress.file) {
				logMessage(`${prefix} [${progress.phase}] ${progress.message} (${progress.file})`, "debug");
			} else {
				logMessage(`${prefix} [${progress.phase}] ${progress.message}`, "debug");
			}
		},
	};

	function logBrandResult(result: UseBrandResult): void {
		logMessage(`${prefix} Brand applied successfully.`, "info");
		if (result.created.length > 0) {
			logMessage(`${prefix} Created ${result.created.length} file(s):`, "info");
			result.created.forEach((file) => logMessage(`${prefix}   - ${file}`, "info"));
		}
		if (result.overwritten.length > 0) {
			logMessage(`${prefix} Overwritten ${result.overwritten.length} file(s):`, "info");
			result.overwritten.forEach((file) => logMessage(`${prefix}   - ${file}`, "info"));
		}
		if (result.skipped.length > 0) {
			logMessage(`${prefix} Skipped ${result.skipped.length} file(s):`, "info");
			result.skipped.forEach((file) => logMessage(`${prefix}   - ${file}`, "info"));
		}
		if (result.cleaned.length > 0) {
			logMessage(`${prefix} Removed ${result.cleaned.length} extra file(s):`, "info");
			result.cleaned.forEach((file) => logMessage(`${prefix}   - ${file}`, "info"));
		}
	}

	const doBrand = async (authConfig?: AuthConfig): Promise<UseBrandResult | null> => {
		try {
			const result = await useBrand(source, { ...brandOptions, auth: authConfig });
			logBrandResult(result);
			return result;
		} catch (error) {
			if (isCancellationError(error)) {
				logMessage(`${prefix} ${error.message}`, "info");
				return null;
			}
			throw error;
		}
	};

	try {
		if (cancellationToken?.isCancellationRequested) {
			logMessage(`${prefix} Operation cancelled by the user.`, "info");
			return null;
		}

		return await doBrand(auth);
	} catch (error) {
		if (isCancellationError(error)) {
			logMessage(`${prefix} ${error.message}`, "info");
			return null;
		}
		logMessage(`${prefix} Error: ${getErrorMessage(error)}.`, "error");
		return retryWithFreshAuth(prefix, error, cancellationToken, (freshAuth) => doBrand(freshAuth), null);
	}
}
