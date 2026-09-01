import * as vscode from "vscode";
import * as semver from "semver";
import { blockAtOffset, findTypstBlocks, type TypstBlock } from "../../utils/typst/typstBlocks";
import {
	buildPlainSource,
	buildRawSource,
	buildCell,
	isUnavailable,
	type Unavailable,
} from "../../utils/typst/typstSource";
import { TYPST_RENDER, documentBrandMode, type TypstBrandMode } from "../../utils/typst/typstOptions";
import { EMPTY_BRAND, type Brand } from "../../utils/typst/typstBrand";
import { getInstalledExtensionsCached } from "../../utils/installedExtensionsCache";
import { getYamlFrontMatterRange } from "../../utils/yamlPosition";
import { findOwningProjectRoot } from "../../utils/projectRootsRegistry";
import { logMessage } from "../../utils/log";
import { readBrand, readMetadataChain, readSourceText, resolveQuartoPath, type MetadataChain } from "./typstMetadata";

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

/** The owner the extension is published under, beside its bare name. */
const TYPST_RENDER_OWNER = "mcanouil";

/** Everything the compiler and the panel need for one block. */
export interface CompileRequest {
	/** The block under the cursor. */
	block: TypstBlock;
	/**
	 * Where the block sits in the document, counted from the top.
	 *
	 * This is how two requests agree that they mean the same block. Every offset
	 * a block carries moves when the text above it changes, and the place in the
	 * order does not, so the offsets cannot answer that question.
	 *
	 * It is not an identity that survives everything: adding or removing a block
	 * above this one shifts it, and until the cursor moves again a recompile can
	 * take its neighbour. The window is narrow, because adding a block above is
	 * itself an edit at a place the cursor is at, and the cursor moving is what
	 * resolves the block again.
	 */
	blockIndex: number;
	/** The whole source to send to the compiler. */
	source: string;
	/** How many lines sit above the block body, for mapping a diagnostic back. */
	injectedLines: number;
	/** The brand mode a cell resolved with, absent for the other two kinds. */
	brandMode?: TypstBrandMode;
	/**
	 * How many lines of the block body sit above the first compiled line.
	 *
	 * Zero for a plain block and a raw block, whose whole body is compiled. A
	 * cell compiles its code and not its body, so its leading `//|` run counts.
	 */
	bodyLineOffset: number;
	/** The `file:` whose contents replaced a cell body, when one did. */
	externalFile?: string;
	/** What the panel should say about the block beside the image. */
	notes: string[];
}

/** The brand mode the editor theme asks for, when the document names none. */
function themeBrandMode(): TypstBrandMode {
	const kind = vscode.window.activeColorTheme.kind;
	return kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight ? "light" : "dark";
}

/**
 * The installed `typst-render`, or undefined when the project has none.
 *
 * The owning project root is what is asked, not the workspace folder. A project
 * in a subfolder keeps its own `_extensions/`, and asking the folder would miss
 * it and report a cell as unpreviewable in a project that installed the
 * extension.
 *
 * The question is whether the extension is installed, so the installed
 * extensions are what is read. The workspace schema index answers a narrower
 * question: it holds only extensions whose `_schema.yml` parsed, so an install
 * with a missing or broken schema file would read as absent and the preview
 * would tell a user to install something they already have.
 *
 * The owner is matched when the manifest carries one, because an extension
 * installed from a repository records it and one copied by hand may not.
 */
async function installedTypstRender(projectRoot: string | undefined): Promise<{ version?: string } | undefined> {
	if (projectRoot === undefined) {
		return undefined;
	}
	const extensions = await getInstalledExtensionsCached(projectRoot);
	const installed = extensions.find(
		(extension) =>
			extension.id.name === TYPST_RENDER &&
			// Discovery reports `null` and not `undefined` for an ownerless install,
			// so the loose comparison is deliberate: a copy placed by hand straight
			// into `_extensions/typst-render/` has no owner directory to read.
			(extension.id.owner == null || extension.id.owner === TYPST_RENDER_OWNER),
	);
	return installed === undefined ? undefined : { version: installed.manifest.version };
}

/**
 * Whether an installed version is above the one the fixtures were recorded from.
 *
 * A version this cannot read is not a warning. `semver.valid` rejects a version
 * the extension is free to write, and reporting one as drift would send a reader
 * to a refresh procedure that has nothing to do with what they are seeing.
 */
export function isNewerThanPinned(installed: string, pinned: string = PINNED_TYPST_RENDER_VERSION): boolean {
	const left = semver.coerce(installed);
	return left !== null && semver.gt(left, pinned);
}

/** Said once per session, because the version does not change while it runs. */
let reportedDrift = false;

/** Report once that the fixtures may no longer describe the installed filter. */
function reportDrift(version: string | undefined): void {
	if (version === undefined || reportedDrift || !isNewerThanPinned(version)) {
		return;
	}
	reportedDrift = true;
	logMessage(
		`Typst preview: typst-render ${version} is installed and the golden fixtures were recorded from ` +
			`${PINNED_TYPST_RENDER_VERSION}. Refresh them, following src/test/fixtures/typstPreview/README.md.`,
		"warn",
	);
}

/** Everything a cell reads from disk, which no document version predicts. */
export interface CellContext {
	/** The installed `typst-render`, absent when the project has none. */
	installed?: { version?: string };
	/** The metadata the document compiles under. */
	chain: MetadataChain;
	/** The brand the document resolves its `auto` colours against. */
	brand: Brand;
}

/**
 * The disk half of one cell, read together so a caller can cache it whole.
 *
 * The gate comes before the metadata chain, because it needs only the project
 * root and it rejects every cell in a project that never installed the
 * extension. Reading the chain first would spend the whole directory walk to
 * say no.
 */
export async function readCellContext(document: vscode.TextDocument, text: string): Promise<CellContext> {
	const projectRoot = await findOwningProjectRoot(document.uri);
	const installed = await installedTypstRender(projectRoot);
	if (installed === undefined) {
		return { chain: { levels: [], metadata: {} }, brand: EMPTY_BRAND };
	}
	const chain = await readMetadataChain(document, text, projectRoot);
	return { installed, chain, brand: await readBrand(chain) };
}

/**
 * The front matter of a document, which is all the metadata chain reads of it.
 *
 * Everything else in the text reaches the chain through nothing at all, so two
 * versions of a document that share this share their whole metadata.
 */
function frontMatterText(text: string): string {
	const range = getYamlFrontMatterRange(text);
	return range === undefined ? "" : text.slice(range.start, range.end);
}

/**
 * What a request would otherwise read again on every keystroke.
 *
 * The two halves are keyed differently because they depend on different things.
 * The blocks are a function of the whole text, so the document version is the
 * whole key. The metadata chain reads the front matter and then the disk, so it
 * survives every edit that leaves the front matter alone, and a watcher is what
 * forgets it when the disk moves.
 */
export class TypstContextCache {
	private readonly blocks = new Map<string, { version: number; blocks: TypstBlock[] }>();
	private readonly cells = new Map<string, { frontMatter: string; context: Promise<CellContext> }>();

	/**
	 * The blocks of one document version.
	 *
	 * The text is taken as a thunk, because a hit needs none of it. Every surface
	 * asks on its hot path, and `getText()` copies the whole document, so passing
	 * the text itself spent one copy of a large file per hover and per code lens
	 * refresh to return a list that was already built.
	 */
	blocksOf(document: vscode.TextDocument, readText: () => string): TypstBlock[] {
		const key = document.uri.toString();
		const held = this.blocks.get(key);
		if (held?.version === document.version) {
			return held.blocks;
		}
		const blocks = findTypstBlocks(readText());
		this.blocks.set(key, { version: document.version, blocks });
		return blocks;
	}

	/** What one document's cells read from disk. */
	cellContext(document: vscode.TextDocument, text: string): Promise<CellContext> {
		const key = document.uri.toString();
		const frontMatter = frontMatterText(text);
		const held = this.cells.get(key);
		if (held?.frontMatter === frontMatter) {
			return held.context;
		}
		// The promise is held and not its value, so two requests arriving inside one
		// directory walk share it rather than walking twice. A rejected read is
		// forgotten, or one unreadable file would answer every later request.
		const context = readCellContext(document, text).catch((error: unknown) => {
			if (this.cells.get(key)?.context === context) {
				this.cells.delete(key);
			}
			throw error;
		});
		this.cells.set(key, { frontMatter, context });
		return context;
	}

	/** Forget one document, which a closed document no longer needs. */
	forget(uri: vscode.Uri): void {
		const key = uri.toString();
		this.blocks.delete(key);
		this.cells.delete(key);
	}

	/**
	 * Forget everything read from disk.
	 *
	 * Every document is forgotten and not only the one under the changed file. A
	 * `_metadata.yml` reaches every document below it and a `.typ` reaches every
	 * document that names it, so working out which entries a change reaches costs
	 * more than the one directory walk that rebuilds them.
	 */
	forgetFiles(): void {
		this.cells.clear();
	}

	clear(): void {
		this.blocks.clear();
		this.cells.clear();
	}
}

/**
 * The compile one block asks for.
 *
 * `header` is the preview's own theme header, and it applies to a plain block
 * and a raw block alone. A cell keeps the colour contract of `typst-render`:
 * the filter writes the page fill and the text fill itself, from the options in
 * force, and a second set of directives above them would show an image the
 * render does not produce.
 *
 * @param cache - What a caller repeating the request remembers. A caller that
 *   asks once builds an empty one, which reads the document and the disk.
 * @param brandMode - The side of the brand to resolve a cell against. Named by
 *   the reader through the toggle command, and absent for every other caller.
 */
export async function buildCompileRequest(
	document: vscode.TextDocument,
	position: vscode.Position,
	header: string,
	cache: TypstContextCache,
	brandMode?: TypstBrandMode,
): Promise<CompileRequest | Unavailable> {
	const text = document.getText();
	// The whole list is kept, because a raw block compiles with the raw blocks
	// above it and scanning the document a second time would say the same thing
	// twice.
	const blocks = cache.blocksOf(document, () => text);
	const block = blockAtOffset(blocks, document.offsetAt(position));
	if (block === undefined) {
		return { unavailable: "Put the cursor inside a Typst block to preview it." };
	}
	const blockIndex = blocks.indexOf(block);

	if (block.kind !== "cell") {
		const assembled = block.kind === "raw" ? buildRawSource(blocks, block, header) : buildPlainSource(block, header);
		// A raw block reaches Typst through the document template, which contributes
		// imports, show rules and set directives the preview cannot apply. Saying so
		// beside the image is what stops a divergence being read as a defect.
		const notes = block.kind === "raw" ? ["the document template is not applied to a raw passthrough"] : [];
		return { block, blockIndex, ...assembled, notes, bodyLineOffset: 0 };
	}

	const { installed, chain, brand } = await cache.cellContext(document, text);
	if (installed === undefined) {
		// Never previewed with guessed options. A cell compiled without the
		// extension's own defaults would show an image the render does not
		// produce, which is worse than showing none.
		return {
			unavailable: "A `{typst}` cell needs the typst-render extension, and this project does not have it installed.",
		};
	}
	reportDrift(installed.version);

	// The one deliberate deviation from the filter. It always defaults to light,
	// and the preview follows the editor theme instead, so a dark editor shows a
	// dark image. An explicit `brand-mode:` still wins, and a mode the reader
	// named through the toggle command wins over both: it is a question about
	// this preview, asked while looking at it.
	const mode = brandMode ?? documentBrandMode(chain.metadata) ?? themeBrandMode();

	const built = await buildCell(block, {
		levels: chain.levels,
		brand,
		mode,
		readFile: (documentPath) => readTypstFile(documentPath, chain),
	});
	if (isUnavailable(built)) {
		return built;
	}

	return { block, blockIndex, ...built, brandMode: mode };
}

/**
 * A `preamble:` or `file:` path read as text, `_modules/paths.lua:34-48`.
 *
 * A leading `/` means the project root, and every other path is relative to the
 * document directory. This is not the rule `root`, `font-path` and
 * `package-path` follow, and conflating the two would read a preamble from the
 * wrong directory in every project whose documents are not at its root.
 *
 * The path is not confined to the project, because the filter does not confine
 * it either and a preview that refused a path a render accepts would be wrong
 * about the document. The whole feature is gated on a trusted workspace, which
 * is the same boundary a render itself sits behind.
 */
async function readTypstFile(documentPath: string, chain: MetadataChain): Promise<string | undefined> {
	const resolved = resolveQuartoPath(documentPath, chain.documentDirectory, chain.projectRoot);
	return resolved === undefined ? undefined : readSourceText(resolved);
}
