import * as path from "node:path";
import { readFileSync } from "node:fs";
import * as vscode from "vscode";
import type { SchemaCache } from "@quarto-wizard/schema";
import { blockAtOffset, findTypstBlocks, type TypstBlock } from "../../utils/typst/typstBlocks";
import { buildPlainSource, buildRawSource, buildCell, isUnavailable } from "../../utils/typst/typstSource";
import { TYPST_RENDER, documentBrandMode, type TypstBrandMode } from "../../utils/typst/typstOptions";
import { getWorkspaceSchemaIndex } from "../../utils/workspaceSchemaIndex";
import { logMessage } from "../../utils/log";
import { readBrand, readMetadataChain } from "./typstMetadata";

/**
 * One document and one position turned into a compile.
 *
 * This is where the three block kinds stop being interchangeable. A plain block
 * and a raw block are assembled by the preview, under the preview's own theme
 * header. A ```` ```{typst} ```` cell belongs to the `typst-render` extension,
 * and it is assembled under the extension's options and colours instead, so the
 * image matches the render rather than the editor.
 */

/**
 * The version of `typst-render` the golden fixtures were recorded from.
 *
 * `src/test/fixtures/typstPreview/README.md` states the refresh procedure. A
 * newer installed version is not an error: it is a hint that the fixtures are
 * due a refresh, and a log line is what turns silent drift into something a bug
 * report can name.
 */
export const PINNED_TYPST_RENDER_VERSION = "0.21.0";

/** The full identifier the schema index registers beside the short name. */
const TYPST_RENDER_ID = `mcanouil/${TYPST_RENDER}`;

/** Everything the compiler and the panel need for one block. */
export interface CompileRequest {
	/** The block under the cursor. */
	block: TypstBlock;
	/** The whole source to send to the compiler. */
	source: string;
	/** How many lines sit above the block body, for mapping a diagnostic back. */
	injectedLines: number;
	/** The brand mode a cell resolved with, absent for the other two kinds. */
	brandMode?: TypstBrandMode;
	/** What the panel should say about the block beside the image. */
	notes: string[];
}

/** A block that cannot be previewed, and the one line that says why. */
export interface UnavailableRequest {
	unavailable: string;
}

/** Whether building a request reported why it could not be done. */
export function isUnavailableRequest(result: CompileRequest | UnavailableRequest): result is UnavailableRequest {
	return "unavailable" in result;
}

/** The brand mode the editor theme asks for, when the document names none. */
function themeBrandMode(): TypstBrandMode {
	const kind = vscode.window.activeColorTheme.kind;
	return kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight ? "light" : "dark";
}

/**
 * The installed `typst-render`, when the owning project has one.
 *
 * The owning project root is what is asked, not the workspace folder. A project
 * in a subfolder keeps its own `_extensions/`, and asking the folder would miss
 * it and report a cell as unpreviewable in a project that installed the
 * extension.
 */
async function installedTypstRender(
	projectRoot: string | undefined,
	schemaCache: SchemaCache,
): Promise<{ installed: false } | { installed: true; version?: string }> {
	if (projectRoot === undefined) {
		return { installed: false };
	}
	const index = await getWorkspaceSchemaIndex(projectRoot, schemaCache);
	// The index registers the full identifier and the short name, and a project
	// can have installed the extension under either.
	if (index.schemaMap.get(TYPST_RENDER_ID) === undefined && index.schemaMap.get(TYPST_RENDER) === undefined) {
		return { installed: false };
	}
	return {
		installed: true,
		version: (index.extMap.get(TYPST_RENDER_ID) ?? index.extMap.get(TYPST_RENDER))?.manifest.version,
	};
}

/** Whether an installed version is above the version the fixtures were recorded from. */
export function isNewerThanPinned(installed: string, pinned: string = PINNED_TYPST_RENDER_VERSION): boolean {
	const parts = (value: string): number[] => value.split(/[.+-]/).map((part) => Number.parseInt(part, 10));
	const left = parts(installed);
	const right = parts(pinned);
	for (let index = 0; index < Math.max(left.length, right.length); index++) {
		const a = left[index];
		const b = right[index];
		// A part that is not a number ends the comparison rather than deciding it.
		// A pre-release suffix is not worth a warning of its own.
		if (Number.isNaN(a) || Number.isNaN(b) || a === undefined || b === undefined) {
			return false;
		}
		if (a !== b) {
			return a > b;
		}
	}
	return false;
}

/** Said once per session, because the version does not change while it runs. */
let reportedDrift = false;

/**
 * What the first version of the preview does not reproduce about a cell.
 *
 * Each of these compiles to something, so refusing them would be worse than
 * showing the image and saying what is missing from it.
 *
 * Exported for its tests: the panel is what shows these, and reaching them
 * through a compile would need the extension installed and Typst running.
 */
export function limitations(block: TypstBlock): string[] {
	const notes: string[] = [];
	const format = block.options.format;
	if (format === "pdf" || format === "html") {
		// The preview always compiles to SVG, because that is what a webview, a
		// hover and a decoration can all show.
		notes.push(`the preview compiles to SVG, not to ${format}`);
	}
	if (block.options.output === "asis") {
		// An `asis` cell is emitted into the document Typst is already laying out,
		// so it inherits a page the preview has no way to reproduce.
		notes.push("an `output: asis` cell inherits the document page, which the preview cannot apply");
	}
	if (typeof block.options.pages === "string" && block.options.pages !== "all") {
		notes.push("the preview shows the first page only");
	}
	return notes;
}

/**
 * The compile one block asks for.
 *
 * `header` is the preview's own theme header, and it applies to a plain block
 * and a raw block alone. A cell keeps the colour contract of `typst-render`:
 * the filter writes the page fill and the text fill itself, from the options in
 * force, and a second set of directives above them would show an image the
 * render does not produce.
 */
export async function buildCompileRequest(
	document: vscode.TextDocument,
	position: vscode.Position,
	header: string,
	schemaCache: SchemaCache,
): Promise<CompileRequest | UnavailableRequest> {
	// The whole list is kept, because a raw block compiles with the raw blocks
	// above it and scanning the document a second time would say the same thing
	// twice.
	const blocks = findTypstBlocks(document.getText());
	const block = blockAtOffset(blocks, document.offsetAt(position));
	if (block === undefined) {
		return { unavailable: "Put the cursor inside a Typst block to preview it." };
	}

	if (block.kind !== "cell") {
		const assembled = block.kind === "raw" ? buildRawSource(blocks, block, header) : buildPlainSource(block, header);
		return { block, ...assembled, notes: [] };
	}

	const chain = await readMetadataChain(document);
	const installed = await installedTypstRender(chain.projectRoot, schemaCache);
	if (!installed.installed) {
		// Never previewed with guessed options. A cell compiled without the
		// extension's own defaults would show an image the render does not
		// produce, which is worse than showing none.
		return {
			unavailable: "A `{typst}` cell needs the typst-render extension, and this project does not have it installed.",
		};
	}
	if (installed.version !== undefined && !reportedDrift && isNewerThanPinned(installed.version)) {
		reportedDrift = true;
		logMessage(
			`Typst preview: typst-render ${installed.version} is installed and the golden fixtures were recorded from ` +
				`${PINNED_TYPST_RENDER_VERSION}. Refresh them, following src/test/fixtures/typstPreview/README.md.`,
			"warn",
		);
	}

	const documentDirectory = document.uri.scheme === "file" ? path.dirname(document.uri.fsPath) : undefined;
	const brand = await readBrand(chain, documentDirectory);
	// The one deliberate deviation from the filter. It always defaults to light,
	// and the preview follows the editor theme instead, so a dark editor shows a
	// dark image. An explicit `brand-mode:` still wins.
	const brandMode = documentBrandMode(chain.metadata) ?? themeBrandMode();

	const built = buildCell(block, {
		levels: chain.levels,
		brand,
		mode: brandMode,
		readFile: (documentPath) => readTypstFile(documentPath, documentDirectory, chain.projectRoot),
	});
	if (isUnavailable(built)) {
		return { unavailable: built.unavailable };
	}

	return { block, ...built, brandMode, notes: limitations(block) };
}

/**
 * A `preamble:` or `file:` path read as text, `_modules/paths.lua:34-48`.
 *
 * A leading `/` means the project root, and every other path is relative to the
 * document directory. This is not the rule `root`, `font-path` and
 * `package-path` follow, and conflating the two would read a preamble from the
 * wrong directory in every project whose documents are not at its root.
 *
 * Synchronous, because the pure assembler takes the read as a plain callback and
 * an asynchronous one would push the whole pipeline into a second pass.
 *
 * The path is not confined to the project, because the filter does not confine
 * it either and a preview that refused a path a render accepts would be wrong
 * about the document. The whole feature is gated on a trusted workspace, which
 * is the same boundary a render itself sits behind.
 */
function readTypstFile(
	documentPath: string,
	documentDirectory: string | undefined,
	projectRoot: string | undefined,
): string | undefined {
	const fromProjectRoot = documentPath.startsWith("/");
	const base = fromProjectRoot ? projectRoot : documentDirectory;
	if (base === undefined) {
		return undefined;
	}
	const resolved = path.join(base, fromProjectRoot ? documentPath.slice(1) : documentPath);

	// The open document wins, so a `.typ` being edited beside the block previews
	// before it is saved.
	for (const open of vscode.workspace.textDocuments) {
		if (open.uri.scheme === "file" && path.normalize(open.uri.fsPath) === path.normalize(resolved)) {
			return open.getText();
		}
	}
	try {
		return readFileSync(resolved, "utf8");
	} catch {
		return undefined;
	}
}
