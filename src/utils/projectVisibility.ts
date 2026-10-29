import * as vscode from "vscode";
import type { QuartoProjectRoot } from "./quartoProjectDiscovery";

export const PROJECT_VISIBILITY_SETTING = "projectVisibility";

const CONFIGURATION_SECTION = "quartoWizard";
const OVERRIDES_KEY = `${CONFIGURATION_SECTION}.${PROJECT_VISIBILITY_SETTING}.overrides`;

type VisibilityMap = Readonly<Record<string, boolean>>;

/**
 * Visibility of a project when neither the setting nor the user says otherwise.
 * A project that `.quartoignore` excludes, or that an installed extension ships from a source, is hidden.
 */
export function defaultVisibility(root: QuartoProjectRoot): boolean {
	return !root.quartoIgnored && !root.embeddedIn?.source;
}

/** Visibility of a project: a per-user override, then the workspace setting, then the default. */
export function resolveVisibility(root: QuartoProjectRoot, setting: VisibilityMap, overrides: VisibilityMap): boolean {
	return overrides[visibilityKey(root)] ?? setting[root.relativePath] ?? defaultVisibility(root);
}

/** Key of a project in the per-user overrides, unique across workspace folders. */
export function visibilityKey(root: QuartoProjectRoot): string {
	return `${root.workspaceFolder.uri.toString()}#${root.relativePath}`;
}

/**
 * Decides which detected projects are shown.
 * Per-user overrides live in the workspace state; the shared choice lives in the `quartoWizard.projectVisibility` setting.
 */
export class ProjectVisibility implements vscode.Disposable {
	private readonly emitter = new vscode.EventEmitter<void>();
	private readonly configurationListener: vscode.Disposable;

	readonly onDidChange: vscode.Event<void> = this.emitter.event;

	constructor(private readonly workspaceState: vscode.Memento) {
		this.configurationListener = vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration(`${CONFIGURATION_SECTION}.${PROJECT_VISIBILITY_SETTING}`)) {
				this.emitter.fire();
			}
		});
	}

	isVisible(root: QuartoProjectRoot): boolean {
		return resolveVisibility(root, this.readSetting(root.workspaceFolder), this.readOverrides());
	}

	async setVisible(roots: readonly QuartoProjectRoot[], visible: boolean): Promise<void> {
		const overrides = { ...this.readOverrides() };
		for (const root of roots) {
			overrides[visibilityKey(root)] = visible;
		}
		await this.workspaceState.update(OVERRIDES_KEY, overrides);
		this.emitter.fire();
	}

	/**
	 * Writes the effective visibility of the given roots to the settings of their workspace folder, then clears their overrides.
	 * The setting is replaced, so keys for projects that no longer exist are dropped.
	 */
	async saveToWorkspaceSettings(roots: readonly QuartoProjectRoot[]): Promise<void> {
		const byFolder = new Map<string, QuartoProjectRoot[]>();
		for (const root of roots) {
			const key = root.workspaceFolder.uri.toString();
			byFolder.set(key, [...(byFolder.get(key) ?? []), root]);
		}

		for (const folderRoots of byFolder.values()) {
			const folder = folderRoots[0].workspaceFolder;
			const effective: Record<string, boolean> = {};
			for (const root of folderRoots) {
				effective[root.relativePath] = this.isVisible(root);
			}
			await vscode.workspace
				.getConfiguration(CONFIGURATION_SECTION, folder.uri)
				.update(PROJECT_VISIBILITY_SETTING, effective, vscode.ConfigurationTarget.WorkspaceFolder);
		}

		const overrides = { ...this.readOverrides() };
		for (const root of roots) {
			delete overrides[visibilityKey(root)];
		}
		await this.workspaceState.update(OVERRIDES_KEY, overrides);
		this.emitter.fire();
	}

	dispose(): void {
		this.configurationListener.dispose();
		this.emitter.dispose();
	}

	private readSetting(folder: vscode.WorkspaceFolder): VisibilityMap {
		return (
			vscode.workspace
				.getConfiguration(CONFIGURATION_SECTION, folder.uri)
				.get<VisibilityMap>(PROJECT_VISIBILITY_SETTING) ?? {}
		);
	}

	private readOverrides(): VisibilityMap {
		return this.workspaceState.get<VisibilityMap>(OVERRIDES_KEY) ?? {};
	}
}
