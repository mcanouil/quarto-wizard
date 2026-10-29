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
	return !root.quartoIgnored && !root.readOnly;
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
	private settingCache = new Map<string, VisibilityMap>();
	private overridesCache: VisibilityMap | undefined;

	readonly onDidChange: vscode.Event<void> = this.emitter.event;

	constructor(private readonly workspaceState: vscode.Memento) {
		this.configurationListener = vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration(`${CONFIGURATION_SECTION}.${PROJECT_VISIBILITY_SETTING}`)) {
				this.clearCaches();
				this.emitter.fire();
			}
		});
	}

	isVisible(root: QuartoProjectRoot): boolean {
		return resolveVisibility(root, this.readSetting(root.workspaceFolder), this.readOverrides());
	}

	async setVisible(roots: readonly QuartoProjectRoot[], visible: boolean): Promise<void> {
		await this.writeOverrides((overrides) => {
			for (const root of roots) {
				overrides[visibilityKey(root)] = visible;
			}
		});
	}

	/**
	 * Writes the visibility of the given roots that differs from their default to the settings of their workspace folder, then clears their overrides.
	 * The setting is replaced, so keys for projects that no longer exist are dropped.
	 */
	async saveToWorkspaceSettings(roots: readonly QuartoProjectRoot[]): Promise<void> {
		const byFolder = new Map<string, QuartoProjectRoot[]>();
		for (const root of roots) {
			const key = root.workspaceFolder.uri.toString();
			byFolder.set(key, [...(byFolder.get(key) ?? []), root]);
		}

		await Promise.all(
			[...byFolder.values()].map((folderRoots) => {
				const folder = folderRoots[0].workspaceFolder;
				const effective: Record<string, boolean> = {};
				for (const root of folderRoots) {
					const visible = this.isVisible(root);
					if (visible !== defaultVisibility(root)) {
						effective[root.relativePath] = visible;
					}
				}
				return vscode.workspace
					.getConfiguration(CONFIGURATION_SECTION, folder.uri)
					.update(PROJECT_VISIBILITY_SETTING, effective, vscode.ConfigurationTarget.WorkspaceFolder);
			}),
		);

		await this.writeOverrides((overrides) => {
			for (const root of roots) {
				delete overrides[visibilityKey(root)];
			}
		});
	}

	dispose(): void {
		this.configurationListener.dispose();
		this.emitter.dispose();
	}

	private async writeOverrides(mutate: (overrides: Record<string, boolean>) => void): Promise<void> {
		const overrides = { ...this.readOverrides() };
		mutate(overrides);
		this.clearCaches();
		await this.workspaceState.update(OVERRIDES_KEY, overrides);
		this.clearCaches();
		this.emitter.fire();
	}

	private clearCaches(): void {
		this.settingCache.clear();
		this.overridesCache = undefined;
	}

	private readSetting(folder: vscode.WorkspaceFolder): VisibilityMap {
		const key = folder.uri.toString();
		let setting = this.settingCache.get(key);
		if (!setting) {
			setting =
				vscode.workspace
					.getConfiguration(CONFIGURATION_SECTION, folder.uri)
					.get<VisibilityMap>(PROJECT_VISIBILITY_SETTING) ?? {};
			this.settingCache.set(key, setting);
		}
		return setting;
	}

	private readOverrides(): VisibilityMap {
		this.overridesCache ??= this.workspaceState.get<VisibilityMap>(OVERRIDES_KEY) ?? {};
		return this.overridesCache;
	}
}
