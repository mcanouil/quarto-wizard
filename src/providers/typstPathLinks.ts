import * as path from "node:path";
import * as vscode from "vscode";
import { debounce } from "../utils/debounce";
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
	private readonly validateLater: ReturnType<typeof debounce>;

	constructor() {
		this.validateLater = debounce((document: vscode.TextDocument) => {
			void this.refresh(document);
		}, DEBOUNCE_MS);

		this.disposables.push(
			vscode.workspace.onDidOpenTextDocument((document) => void this.refresh(document)),
			vscode.workspace.onDidChangeTextDocument((event) => this.validateLater(event.document)),
			vscode.workspace.onDidCloseTextDocument((document) => this.diagnostics.delete(document.uri)),
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
		this.validateLater.cancel();
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

	/** Read every open document again, after something outside them changed. */
	private validateOpen(): void {
		for (const document of vscode.workspace.textDocuments) {
			void this.refresh(document);
		}
	}

	/**
	 * Read one document again, and set the warnings it carries.
	 *
	 * Public so that a test can wait for the reading it starts. Every caller
	 * inside the class starts it and does not wait.
	 */
	async refresh(document: vscode.TextDocument): Promise<void> {
		const resolved = await this.resolve(document);
		if (document.isClosed) {
			return;
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
	}

	/** Every path option of a document, with the file each one leads to. */
	private async resolve(document: vscode.TextDocument): Promise<ResolvedPathOption[]> {
		// A document that is not on disk resolves no relative path, and a YAML file
		// that is no part of the metadata chain carries no option of this kind.
		if (document.uri.scheme !== "file" || !isRelevantYaml(document)) {
			return [];
		}

		const options = findTypstPathOptions(document.getText(), document.languageId);
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
