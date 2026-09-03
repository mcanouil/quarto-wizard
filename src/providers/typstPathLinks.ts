import * as path from "node:path";
import * as vscode from "vscode";
import { debounce } from "../utils/debounce";
import { getDocumentTypstBlocks, getDocumentYaml } from "../utils/documentScan";
import { logMessage } from "../utils/log";
import { isRelevantYaml } from "../utils/metadataFilesRegistry";
import { findOwningProjectRoot } from "../utils/projectRootsRegistry";
import { isFile } from "../utils/quartoProjectDiscovery";
import {
	findTypstPathOptions,
	resolveTypstPathOption,
	type TypstPathOption,
	type TypstPathTarget,
} from "../utils/typst/typstPathOptions";

/**
 * The documents an option can be written in.
 *
 * A `.qmd` carries a cell and a front matter, and a YAML file carries a level
 * of the metadata chain. Which YAML files those are is
 * {@link isRelevantYaml}'s answer, because a `metadata-files:` target holds a
 * `typst-render` mapping the same way `_quarto.yml` does.
 */
const SELECTOR: vscode.DocumentSelector = [
	{ language: "quarto", scheme: "file" },
	{ language: "yaml", scheme: "file" },
];

/** How long an edit settles before the paths of a document are read again. */
const DEBOUNCE_MS = 500;

/** The diagnostic put on a path that leads to no file. */
const MISSING_PATH = "typst-missing-path";

/** One option, and the file it leads to. */
interface ResolvedPathOption {
	option: TypstPathOption;
	target: TypstPathTarget;
	/** Whether a file is there to open. */
	present: boolean;
}

/**
 * The `file:` and `preamble:` paths of a Quarto document, as links to follow
 * and as a diagnostic when they lead nowhere.
 *
 * The two surfaces share one reader, because a link and a warning are two
 * answers to the same question and reading the document twice would let them
 * disagree.
 */
export class TypstPathLinks implements vscode.DocumentLinkProvider, vscode.Disposable {
	private readonly diagnostics = vscode.languages.createDiagnosticCollection("quarto-typst-paths");
	private readonly disposables: vscode.Disposable[] = [];
	/**
	 * The pending reading of each document, one per document.
	 *
	 * A single debounced function holds the arguments of its last call alone, so
	 * two documents edited inside one window would leave the first of them with
	 * the warnings of the text it no longer holds.
	 */
	private readonly pending = new Map<string, ReturnType<typeof debounce>>();
	/**
	 * How many readings of each document have started.
	 *
	 * A watcher and an edit can read the same text at the same time, and the
	 * slower of the two would write its result over the newer one.
	 */
	private readonly readings = new Map<string, number>();

	constructor() {
		this.disposables.push(
			vscode.workspace.onDidOpenTextDocument((document) => void this.refresh(document)),
			vscode.workspace.onDidChangeTextDocument((event) => this.refreshLater(event.document)),
			vscode.workspace.onDidCloseTextDocument((document) => this.forget(document)),
		);

		// A path that led nowhere leads somewhere once the file is written, and
		// nothing about the document itself changed when that happened.
		const watcher = vscode.workspace.createFileSystemWatcher("**/*.typ");
		this.disposables.push(
			watcher,
			watcher.onDidCreate(() => this.validateOpen()),
			watcher.onDidDelete(() => this.validateOpen()),
		);

		this.validateOpen();
	}

	dispose(): void {
		for (const later of this.pending.values()) {
			later.cancel();
		}
		this.pending.clear();
		this.readings.clear();
		this.diagnostics.dispose();
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}

	async provideDocumentLinks(document: vscode.TextDocument): Promise<vscode.DocumentLink[]> {
		const resolved = await this.resolve(document);
		const links: vscode.DocumentLink[] = [];
		for (const { option, target, present } of resolved) {
			// Only a file that is there is offered. A link to a path that leads
			// nowhere opens an empty editor, which says less than the warning the
			// same reading writes.
			if (!present || target.path === undefined) {
				continue;
			}
			const uri = vscode.Uri.file(target.path);
			const link = new vscode.DocumentLink(this.rangeOf(document, option), uri);
			link.tooltip = vscode.workspace.asRelativePath(uri);
			links.push(link);
		}
		return links;
	}

	/** Read one document again once its edits settle. */
	private refreshLater(document: vscode.TextDocument): void {
		const key = document.uri.toString();
		let later = this.pending.get(key);
		if (later === undefined) {
			// The editor holds one document object per open URI, so the one captured
			// here is the one the key names for as long as it is open.
			later = debounce(() => void this.refresh(document), DEBOUNCE_MS);
			this.pending.set(key, later);
		}
		later();
	}

	/** Drop everything held for a document that is closed. */
	private forget(document: vscode.TextDocument): void {
		const key = document.uri.toString();
		this.pending.get(key)?.cancel();
		this.pending.delete(key);
		this.readings.delete(key);
		this.diagnostics.delete(document.uri);
	}

	/** Read every open document again, after something outside them changed. */
	private validateOpen(): void {
		for (const document of vscode.workspace.textDocuments) {
			void this.refresh(document);
		}
	}

	/**
	 * Read one document again, and set the warnings it carries.
	 *
	 * Public, and it answers with what it wrote, so that a test can wait for the
	 * reading it starts and read the result of that reading alone. Every caller
	 * inside the class starts it and does not wait.
	 *
	 * The answer is empty when the document moved on while the paths were read.
	 * The offsets were taken in the older text, so writing them now would put a
	 * warning on characters that no longer carry the path, and an older reading
	 * that finishes last would undo a newer one.
	 */
	async refresh(document: vscode.TextDocument): Promise<vscode.Diagnostic[]> {
		const key = document.uri.toString();
		const reading = (this.readings.get(key) ?? 0) + 1;
		this.readings.set(key, reading);
		const version = document.version;

		const resolved = await this.resolve(document);
		// The text moved on, or another reading of the same text started after
		// this one and has already written what it found.
		if (document.isClosed || document.version !== version || this.readings.get(key) !== reading) {
			return [];
		}

		const diagnostics: vscode.Diagnostic[] = [];
		for (const { option, target, present } of resolved) {
			if (present || !target.reportable || target.path === undefined) {
				continue;
			}
			const diagnostic = new vscode.Diagnostic(
				this.rangeOf(document, option),
				`The \`${option.key}\` option names \`${option.value}\`, and there is no file at \`${target.path}\`.`,
				vscode.DiagnosticSeverity.Warning,
			);
			diagnostic.code = MISSING_PATH;
			diagnostic.source = "quarto-wizard";
			diagnostics.push(diagnostic);
		}
		this.diagnostics.set(document.uri, diagnostics);
		return diagnostics;
	}

	/** Every path option of a document, with the file each one leads to. */
	private async resolve(document: vscode.TextDocument): Promise<ResolvedPathOption[]> {
		// A document that is not on disk resolves no relative path, and a YAML file
		// that is no part of the metadata chain carries no option of this kind.
		if (document.uri.scheme !== "file" || !isRelevantYaml(document)) {
			return [];
		}

		const text = document.getText();
		const options = findTypstPathOptions(
			text,
			document.languageId,
			() => getDocumentTypstBlocks(document, () => text),
			() => getDocumentYaml(document, text),
		);
		if (options.length === 0) {
			return [];
		}

		const context = {
			directory: path.dirname(document.uri.fsPath),
			projectRoot: await findOwningProjectRoot(document.uri),
			configuration: document.languageId === "yaml",
		};

		return Promise.all(
			options.map(async (option) => {
				const target = resolveTypstPathOption(option.value, context);
				const present = target.path !== undefined && (await isFile(vscode.Uri.file(target.path)));
				return { option, target, present };
			}),
		);
	}

	private rangeOf(document: vscode.TextDocument, option: TypstPathOption): vscode.Range {
		return new vscode.Range(document.positionAt(option.start), document.positionAt(option.end));
	}
}

/**
 * Register the links and the warning that the `file:` and `preamble:` options
 * of a document carry.
 */
export function registerTypstPathLinks(context: vscode.ExtensionContext): void {
	const provider = new TypstPathLinks();
	context.subscriptions.push(provider);
	context.subscriptions.push(vscode.languages.registerDocumentLinkProvider(SELECTOR, provider));
	logMessage("Typst path links registered.", "debug");
}
