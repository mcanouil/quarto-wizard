import * as vscode from "vscode";
import { EXTENSION_MANIFEST_GLOB } from "../../utils/quartoProjectDiscovery";

/**
 * The metadata files a preview reads beside the block.
 *
 * `_quarto` and `_metadata` are the chain, and `_brand` is where an `auto`
 * colour resolves from. The glob and the name test in the controller are both
 * built from this, because two hand-kept lists of one set drift apart in
 * silence.
 */
export const CONTEXT_FILE_NAMES = ["quarto", "metadata", "brand"] as const;

/** Every metadata file of the chain, at any depth, including `_brand/_brand.yml`. */
const CONTEXT_FILE_GLOB = `**/_{${CONTEXT_FILE_NAMES.join(",")}}.{yml,yaml}`;

/** A `preamble:` or a `file:`, which a cell compiles in place of its own body. */
const TYPST_FILE_GLOB = "**/*.typ";

/**
 * The watchers over the files a preview reads beside the block.
 *
 * They are raised by the first request rather than at registration. These are
 * workspace-wide watchers, and until a preview is asked for every event they
 * deliver reaches a `recompile` that has nothing to recompile, so a session
 * that never opens the preview should not pay for them.
 */
export class TypstPreviewWatchers implements vscode.Disposable {
	private readonly disposables: vscode.Disposable[] = [];
	private watching = false;

	/** @param onChange Called when any watched file is created, changed or deleted. */
	constructor(private readonly onChange: () => void) {}

	/**
	 * Watch the files a preview reads beside the block, once.
	 *
	 * A request and not a result, because a cell in a project that has not
	 * installed the extension produces no result, and the manifest watcher is
	 * what lets it start working once the extension is installed.
	 */
	start(): void {
		if (this.watching) {
			return;
		}
		this.watching = true;
		// One glob covers `_brand/_brand.yml` as well, because a leading `**/`
		// matches the directory as readily as any other.
		this.watch(CONTEXT_FILE_GLOB);
		this.watch(TYPST_FILE_GLOB);
		// The gate answer is held with the rest of the context, so a project that
		// installs the extension while the preview is open stops reporting a cell as
		// unpreviewable without waiting for a cache to expire.
		this.watch(EXTENSION_MANIFEST_GLOB);
	}

	dispose(): void {
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		this.disposables.length = 0;
	}

	/** Rebuild the preview when a file it reads beside the block changes. */
	private watch(glob: string): void {
		const watcher = vscode.workspace.createFileSystemWatcher(glob);
		const changed = (): void => this.onChange();
		this.disposables.push(watcher.onDidCreate(changed));
		this.disposables.push(watcher.onDidChange(changed));
		this.disposables.push(watcher.onDidDelete(changed));
		this.disposables.push(watcher);
	}
}
