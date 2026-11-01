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
	LocalEditsError,
	getInstalledState,
	formatLocalEdit,
	getExtensionInstallPath,
	isCancellationError,
	pluralise,
	type UseResult,
	type UseBrandResult,
	type UseBrandOptions,
	type FileSelectionCallback,
	type SelectTargetSubdirCallback,
	type AuthConfig,
	type SourceType,
	type DiscoveredExtension,
	type ExtensionManifest,
	type LocalEdit,
	type RemoveResult,
	type ExtensionId,
	getErrorMessage,
} from "@quarto-wizard/core";
import { logMessage } from "./log";
import { handleAuthError, GITHUB_SCOPES, type HandleAuthErrorOptions } from "./auth";
import { formatExtensionId, resolveLocalSourcePath } from "./extensions";
import { getQuartoVersionInfo } from "../services/quartoVersion";
import { validateQuartoRequirement } from "./versionValidation";
import { showExtensionSelectionQuickPick } from "../ui/extensionSelectionQuickPick";

type ParsedInstallSource = ReturnType<typeof parseInstallSource>;

/**
 * What an install did, filled in by {@link installQuartoExtension} for a caller that passes it.
 */
export interface InstallOutcome {
	/** Set in skip mode when the installed copy has local changes, so nothing was written. */
	localEdits?: LocalEditsError;
	/**
	 * Set when the install replaced a copy that had no install record.
	 * A caller that passes an outcome reports this itself, so no message opens.
	 */
	replacedUntracked?: boolean;
}

/**
 * Optional parameters for {@link installQuartoExtension}.
 */
export interface InstallOptions {
	auth?: AuthConfig;
	sourceDisplay?: string;
	skipOverwritePrompt?: boolean;
	cancellationToken?: vscode.CancellationToken;
	sourceType?: SourceType;
	/**
	 * Extension context used by the reactive private-repo 404 dialog to persist
	 * the session opt-in flag. Required when `offerSessionOnNotFound` is true.
	 */
	context?: vscode.ExtensionContext;
	/**
	 * When true, a 404/"not found" on an attempt that used no auth triggers a
	 * "may be private, sign in?" dialog. Only the explicit GitHub install
	 * entry points should set this.
	 */
	offerSessionOnNotFound?: boolean;
	/**
	 * The extension that an update replaces.
	 * When set, only that extension of the source is installed and no selection quick pick opens.
	 */
	expectedExtensionId?: ExtensionId;
	/**
	 * What to do when the installed copy has local changes.
	 * "ask" (the default) opens a dialog that offers Replace anyway.
	 * "skip" replaces nothing, opens no dialog and reports the changes in `outcome`.
	 */
	localEdits?: "ask" | "skip";
	/**
	 * Replace the installed copy even when it is at the same version.
	 * Needs `expectedExtensionId`: before it writes, a copy with local changes is shown in the Replace anyway dialog.
	 */
	force?: boolean;
	/**
	 * Replace the installed copy even when it is at the same version, as an update does.
	 * Unlike `force`, a copy with local changes is still refused, as `localEdits` says.
	 */
	replaceSameVersion?: boolean;
	/**
	 * Source to write in the install record in place of the installed source.
	 * An update or a reinstall of an extension installed without a ref sets it, so that the record stays unpinned.
	 */
	recordSource?: string;
	/** Receives what the install did, so that the caller can report it. */
	outcome?: InstallOutcome;
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
	/**
	 * Extension context used by the reactive private-repo 404 dialog to persist
	 * the session opt-in flag. Required when `offerSessionOnNotFound` is true.
	 */
	context?: vscode.ExtensionContext;
	/**
	 * When true, a 404/"not found" on an attempt that used no auth triggers a
	 * "may be private, sign in?" dialog. Only the explicit GitHub use-template
	 * entry points should set this.
	 */
	offerSessionOnNotFound?: boolean;
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
	const session = await vscode.authentication.getSession("github", GITHUB_SCOPES, { silent: true });
	return session ? createAuthConfig({ githubToken: session.accessToken }) : createAuthConfig();
}

/**
 * Handles the retry-after-authentication pattern.
 * If the error triggers a successful auth flow, retries the operation with fresh credentials.
 *
 * @param prefix - Log prefix for messages.
 * @param error - The caught error.
 * @param flags - Forwarded to {@link handleAuthError}.
 * @param cancellationToken - Optional cancellation token.
 * @param retryFn - The operation to retry, receiving fresh auth.
 * @param fallbackValue - Value to return when retry is not attempted or fails.
 * @param cancelledValue - Value to return when the user cancels before or during the retry.
 * @returns The result of the retry, or the fallback value.
 */
async function retryWithFreshAuth<T>(
	prefix: string,
	error: unknown,
	flags: HandleAuthErrorOptions,
	cancellationToken: vscode.CancellationToken | undefined,
	retryFn: (freshAuth: AuthConfig) => Promise<T>,
	fallbackValue: T,
	cancelledValue: T,
): Promise<T> {
	const signedIn = await handleAuthError(prefix, error, flags);
	if (cancellationToken?.isCancellationRequested) {
		logMessage(`${prefix} Operation cancelled by the user.`, "info");
		return cancelledValue;
	}
	if (!signedIn) {
		return fallbackValue;
	}
	logMessage(`${prefix} Retrying after successful authentication.`, "info");
	try {
		const freshAuth = await getFreshAuth();
		return await retryFn(freshAuth);
	} catch (retryError) {
		if (isCancellationError(retryError)) {
			logMessage(`${prefix} Operation cancelled by the user.`, "info");
			return cancelledValue;
		}
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
	cancelledValue: T,
	retryFlags: Omit<HandleAuthErrorOptions, "hadAuth"> = {},
): Promise<T> {
	try {
		const source = parseInstallSource(sourceInput);
		return await run(source, initialAuth);
	} catch (error) {
		if (isCancellationError(error)) {
			logMessage(`${prefix} Operation cancelled by the user.`, "info");
			return cancelledValue;
		}
		logMessage(`${prefix} Error: ${getErrorMessage(error)}.`, "error");
		const flags: HandleAuthErrorOptions = {
			...retryFlags,
			hadAuth: Boolean(initialAuth?.githubToken),
		};
		return retryWithFreshAuth(
			prefix,
			error,
			flags,
			cancellationToken,
			async (freshAuth) => {
				const source = parseInstallSource(sourceInput);
				return run(source, freshAuth);
			},
			fallbackValue,
			cancelledValue,
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

const MAX_LISTED_EDITS = 10;

/**
 * An extension that has local changes, with the files that differ.
 */
interface EditedExtension {
	id: ExtensionId;
	edits: LocalEdit[];
}

/**
 * Writes the files that differ from the install record, at most ten, then the number of the others.
 *
 * @param edits - Differences found in an installed extension
 * @returns For example "a.lua (modified), b.lua (added) and 3 more"
 */
export function formatLocalEdits(edits: readonly LocalEdit[]): string {
	const listed = edits.slice(0, MAX_LISTED_EDITS).map(formatLocalEdit);
	const rest = edits.length - listed.length;
	return rest > 0 ? `${listed.join(", ")} and ${rest} more` : listed.join(", ");
}

/**
 * Writes the files of several extensions, grouped by extension, at most ten files in all.
 */
function formatEditedExtensions(edited: readonly EditedExtension[]): string {
	if (edited.length === 1) {
		return formatLocalEdits(edited[0].edits);
	}
	let room = MAX_LISTED_EDITS;
	const groups: string[] = [];
	for (const { id, edits } of edited) {
		const listed = edits.slice(0, room);
		room -= listed.length;
		if (listed.length > 0) {
			groups.push(`${formatExtensionId(id)}: ${listed.map(formatLocalEdit).join(", ")}`);
		}
	}
	const rest = edited.reduce((total, { edits }) => total + edits.length, 0) - MAX_LISTED_EDITS;
	return rest > 0 ? `${groups.join("; ")} and ${rest} more` : groups.join("; ");
}

/**
 * Finds which of the extensions have local changes in the project folder.
 */
function findEditedExtensions(workspaceFolder: string, ids: readonly ExtensionId[]): EditedExtension[] {
	const edited: EditedExtension[] = [];
	for (const id of ids) {
		const state = getInstalledState(getExtensionInstallPath(workspaceFolder, id));
		if (state.kind === "modified") {
			edited.push({ id, edits: state.edits });
		}
	}
	return edited;
}

/**
 * Asks whether to replace extensions that have local changes.
 *
 * @param prefix - Log prefix for messages
 * @param edited - The extensions with local changes
 * @returns True when the user chose Replace anyway
 */
async function confirmReplaceLocalEdits(prefix: string, edited: readonly EditedExtension[]): Promise<boolean> {
	const names = edited.map(({ id }) => formatExtensionId(id)).join(", ");
	const action = await vscode.window.showWarningMessage(
		`${names} ${edited.length === 1 ? "has" : "have"} local changes that a reinstall would remove: ${formatEditedExtensions(edited)}.`,
		{ modal: true },
		"Replace anyway",
		"Cancel",
	);
	if (action !== "Replace anyway") {
		logMessage(`${prefix} Installation cancelled - extension has local changes.`, "info");
		return false;
	}
	logMessage(`${prefix} User chose to replace the extension despite local changes.`, "info");
	return true;
}

/**
 * Asks whether to replace the extensions after an install refused one of them for its local changes.
 * The dialog lists every extension of `ids` that has local changes, and the refused one.
 *
 * @param prefix - Log prefix for messages
 * @param workspaceFolder - The project folder
 * @param error - The refusal
 * @param ids - The extensions that the install writes
 * @returns True when the user chose Replace anyway
 */
async function confirmReplaceAfterRefusal(
	prefix: string,
	workspaceFolder: string,
	error: LocalEditsError,
	ids: readonly ExtensionId[],
): Promise<boolean> {
	const edited = findEditedExtensions(workspaceFolder, ids);
	if (!edited.some(({ id }) => formatExtensionId(id) === formatExtensionId(error.extensionId))) {
		edited.unshift({ id: error.extensionId, edits: error.edits });
	}
	return confirmReplaceLocalEdits(prefix, edited);
}

/**
 * Wraps a dialog so that a second call gives the first answer without a new dialog.
 *
 * @param ask - The dialog to show once
 * @returns The wrapped dialog
 */
function rememberFirstAnswer<TArgs extends unknown[], TResult>(
	ask: (...args: TArgs) => Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
	let answer: { value: TResult } | undefined;
	return async (...args: TArgs) => {
		if (!answer) {
			answer = { value: await ask(...args) };
		}
		return answer.value;
	};
}

/**
 * Wraps the extension selection so that a second call gives the first answer without a new quick pick.
 * A retry after Replace anyway then installs the same extensions.
 *
 * @param ask - The selection to ask once
 * @returns The wrapped selection, and the extensions that the user chose
 */
function rememberExtensionSelection(
	ask: (candidates: DiscoveredExtension[]) => Promise<DiscoveredExtension[] | null>,
): {
	select: (candidates: DiscoveredExtension[]) => Promise<DiscoveredExtension[] | null>;
	chosenIds: () => ExtensionId[] | undefined;
} {
	let chosenIds: ExtensionId[] | undefined;
	const select = async (candidates: DiscoveredExtension[]) => {
		if (chosenIds) {
			const names = chosenIds.map(formatExtensionId);
			return candidates.filter((candidate) => names.includes(formatExtensionId(candidate.id)));
		}
		const chosen = await ask(candidates);
		chosenIds = chosen?.map((candidate) => candidate.id);
		return chosen;
	};
	return { select, chosenIds: () => chosenIds };
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
	const {
		auth,
		sourceDisplay,
		skipOverwritePrompt,
		cancellationToken,
		sourceType,
		context,
		offerSessionOnNotFound,
		expectedExtensionId,
		localEdits = "ask",
		force = false,
		replaceSameVersion = false,
		recordSource,
		outcome,
	} = options;
	if (force && !expectedExtensionId) {
		throw new Error(
			"The force option needs the expectedExtensionId option, so that local changes are shown before they are replaced.",
		);
	}

	const prefix = `[${sourceDisplay ?? extension}]`;
	logMessage(`${prefix} Installing ...`, "info");

	if (!workspaceFolder) {
		logMessage(`${prefix} No workspace folder specified.`, "error");
		return false;
	}

	const { select: selectExtension, chosenIds } = rememberExtensionSelection(
		wrapWithCancellation(showExtensionSelectionQuickPick, cancellationToken, null),
	);
	const resolvedSource = sourceType === "local" ? resolveLocalSourcePath(extension, workspaceFolder) : extension;

	const controller = new AbortController();
	if (cancellationToken?.isCancellationRequested) {
		controller.abort();
	}
	const cancellation = cancellationToken?.onCancellationRequested(() => controller.abort());

	const runInstall = (source: ParsedInstallSource, authConfig: AuthConfig | undefined, forceInstall: boolean) =>
		install(source, {
			signal: controller.signal,
			projectDir: workspaceFolder,
			auth: authConfig,
			sourceType,
			selectExtension,
			expectedExtensionId,
			recordSource,
			force: forceInstall,
			replaceSameVersion,
			confirmOverwrite: createConfirmOverwriteCallback(prefix, forceInstall || (skipOverwritePrompt ?? false)),
			validateQuartoVersion: createValidateQuartoVersionCallback(prefix),
			onProgress: (progress) => {
				logMessage(`${prefix} [${progress.phase}] ${progress.message}`, "debug");
			},
		});

	let forceConfirmed = false;
	const doInstall = async (source: ParsedInstallSource, authConfig?: AuthConfig): Promise<boolean | null> => {
		if (force && localEdits === "ask" && !forceConfirmed) {
			const edited = expectedExtensionId ? findEditedExtensions(workspaceFolder, [expectedExtensionId]) : [];
			if (edited.length > 0 && !(await confirmReplaceLocalEdits(prefix, edited))) {
				return null;
			}
			forceConfirmed = true;
		}
		let result;
		try {
			result = await runInstall(source, authConfig, force);
		} catch (error) {
			if (!(error instanceof LocalEditsError)) {
				throw error;
			}
			if (localEdits === "skip") {
				if (outcome) {
					outcome.localEdits = error;
				}
				return null;
			}
			const selected = chosenIds() ?? (expectedExtensionId ? [expectedExtensionId] : []);
			if (!(await confirmReplaceAfterRefusal(prefix, workspaceFolder, error, selected))) {
				return null;
			}
			result = await runInstall(source, authConfig, true);
		}

		if (result.cancelled) {
			logMessage(`${prefix} Installation cancelled by user.`, "info");
			return null;
		}

		const additionalInstalls = (result.additionalInstalls ?? []).filter((installed) => !installed.unchanged);
		if (result.success && result.unchanged) {
			const version = result.extension.manifest.version;
			logMessage(`${prefix} Already at version ${version}, nothing written.`, "info");
			void vscode.window.showInformationMessage(
				`${formatExtensionId(result.extension.id)} is already at version ${version}.`,
			);
			if (additionalInstalls.length === 0 && !result.additionalInstallFailures) {
				return true;
			}
		}

		if (result.success) {
			if (result.replacedUntracked) {
				logMessage(`${prefix} Replaced a copy that had no install record.`, "info");
				if (outcome) {
					outcome.replacedUntracked = true;
				} else {
					void vscode.window.showInformationMessage(
						`${formatExtensionId(result.extension.id)} had no install record, so Quarto Wizard could not check it for local changes.`,
					);
				}
			}
			if (result.additionalInstallFailures && result.additionalInstallFailures.length > 0) {
				const failed = result.additionalInstallFailures.map((f) => formatExtensionId(f.extensionId)).join(", ");
				logMessage(
					`${prefix} ${result.unchanged ? "Failed" : "Installed, but failed"} to install ${pluralise(result.additionalInstallFailures.length, "additional extension")}: ${failed}.`,
					"warn",
				);
			} else if (!result.unchanged) {
				logMessage(`${prefix} Successfully installed.`, "info");
			}
			if (additionalInstalls.length > 0) {
				const names = additionalInstalls.map((installed) => formatExtensionId(installed.extension.id)).join(", ");
				logMessage(
					`${prefix} Also installed ${pluralise(additionalInstalls.length, "additional extension")}: ${names}.`,
					"info",
				);
			}
			void vscode.commands.executeCommand("quartoWizard.extensionsInstalled.refresh");
			return true;
		} else {
			logMessage(`${prefix} Failed to install.`, "error");
			return false;
		}
	};

	try {
		return await runWithParsedSourceAndAuthRetry(
			resolvedSource,
			auth,
			prefix,
			cancellationToken,
			doInstall,
			false,
			null,
			{
				context,
				offerSessionOnNotFound,
			},
		);
	} finally {
		cancellation?.dispose();
	}
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
	logMessage(`${prefix} Removing ${pluralise(extensions.length, "extension")}: ${extensions.join(", ")}.`, "info");

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
			logMessage(`${prefix} Successfully removed ${pluralise(successCount, "extension")}.`, "info");
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
	const {
		selectFiles,
		selectTargetSubdir,
		auth,
		sourceDisplay,
		cancellationToken,
		sourceType,
		context,
		offerSessionOnNotFound,
	} = options;
	const prefix = `[${sourceDisplay ?? extension}]`;
	logMessage(`${prefix} Using template ...`, "info");

	if (!workspaceFolder) {
		logMessage(`${prefix} No workspace folder specified.`, "error");
		return null;
	}

	// A retry after Replace anyway gives the same answers, so the dialogs open only once.
	const wrappedSelectFiles = selectFiles
		? rememberFirstAnswer(wrapWithCancellation(selectFiles, cancellationToken, null))
		: undefined;
	const wrappedSelectTargetSubdir = selectTargetSubdir
		? rememberFirstAnswer(wrapWithCancellation(selectTargetSubdir, cancellationToken, undefined))
		: undefined;
	const { select: wrappedSelectExtension, chosenIds } = rememberExtensionSelection(
		wrapWithCancellation(showExtensionSelectionQuickPick, cancellationToken, null),
	);
	const confirmExtensionOverwrite = rememberFirstAnswer(showExtensionOverwriteConfirmation);

	const runUse = (source: ParsedInstallSource, authConfig: AuthConfig | undefined, force: boolean) =>
		use(source, {
			projectDir: workspaceFolder,
			selectFiles: wrappedSelectFiles,
			selectTargetSubdir: wrappedSelectTargetSubdir,
			selectFilesFirst: true,
			selectExtension: wrappedSelectExtension,
			confirmExtensionOverwrite,
			auth: authConfig,
			sourceType,
			force,
			onProgress: (progress) => {
				if (progress.file) {
					logMessage(`${prefix} [${progress.phase}] ${progress.message} (${progress.file})`, "debug");
				} else {
					logMessage(`${prefix} [${progress.phase}] ${progress.message}`, "debug");
				}
			},
		});

	const doUse = async (source: ParsedInstallSource, authConfig?: AuthConfig): Promise<UseResult | null> => {
		let result;
		try {
			result = await runUse(source, authConfig, false);
		} catch (error) {
			if (!(error instanceof LocalEditsError)) {
				throw error;
			}
			if (!(await confirmReplaceAfterRefusal(prefix, workspaceFolder, error, chosenIds() ?? []))) {
				return null;
			}
			result = await runUse(source, authConfig, true);
		}

		if (result.cancelled) {
			logMessage(`${prefix} Template usage cancelled by user.`, "info");
			return null;
		}

		if (result.install.success) {
			logMessage(`${prefix} Successfully installed template.`, "info");

			if (result.templateFiles.length > 0) {
				logMessage(`${prefix} Copied ${pluralise(result.templateFiles.length, "template file")}:`, "info");
				result.templateFiles.forEach((file) => logMessage(`${prefix}   - ${file}`, "info"));
			}

			if (result.skippedFiles.length > 0) {
				logMessage(`${prefix} Skipped ${pluralise(result.skippedFiles.length, "existing file")}:`, "info");
				result.skippedFiles.forEach((file) => logMessage(`${prefix}   - ${file}`, "info"));
			}

			void vscode.commands.executeCommand("quartoWizard.extensionsInstalled.refresh");
			return result;
		} else {
			logMessage(`${prefix} Failed to use template.`, "error");
			return null;
		}
	};

	return runWithParsedSourceAndAuthRetry(extension, auth, prefix, cancellationToken, doUse, null, null, {
		context,
		offerSessionOnNotFound,
	});
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
			const message = `${pluralise(files.length, "extra file")} in _brand/ not present in the brand source:\n${fileList}\n\nRemove ${files.length === 1 ? "it" : "them"}?`;
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
			logMessage(`${prefix} Created ${pluralise(result.created.length, "file")}:`, "info");
			result.created.forEach((file) => logMessage(`${prefix}   - ${file}`, "info"));
		}
		if (result.overwritten.length > 0) {
			logMessage(`${prefix} Overwritten ${pluralise(result.overwritten.length, "file")}:`, "info");
			result.overwritten.forEach((file) => logMessage(`${prefix}   - ${file}`, "info"));
		}
		if (result.skipped.length > 0) {
			logMessage(`${prefix} Skipped ${pluralise(result.skipped.length, "file")}:`, "info");
			result.skipped.forEach((file) => logMessage(`${prefix}   - ${file}`, "info"));
		}
		if (result.cleaned.length > 0) {
			logMessage(`${prefix} Removed ${pluralise(result.cleaned.length, "extra file")}:`, "info");
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
		return retryWithFreshAuth(
			prefix,
			error,
			{ hadAuth: Boolean(auth?.githubToken) },
			cancellationToken,
			(freshAuth) => doBrand(freshAuth),
			null,
			null,
		);
	}
}
