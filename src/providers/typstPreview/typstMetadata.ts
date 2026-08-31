import * as path from "node:path";
import * as vscode from "vscode";
import * as yaml from "js-yaml";
import { getMetadataFiles } from "../../utils/metadataFilesRegistry";
import { findOwningProjectRoot } from "../../utils/projectRootsRegistry";
import { parseFrontMatter } from "../../utils/yamlPosition";
import {
	BRAND_CANDIDATES,
	EMPTY_BRAND,
	joinBrands,
	readBrandOverride,
	splitBrand,
	type Brand,
} from "../../utils/typst/typstBrand";
import { extensionLevel, mapping, type TypstGlobalLevel } from "../../utils/typst/typstOptions";

/**
 * The Quarto metadata chain of one document, read from disk.
 *
 * This is the impure half of the cell pipeline. Everything it produces is plain
 * data, so the assembly under `src/utils/typst/` stays pure and testable without
 * a workspace.
 */

/** The metadata one document compiles under. */
export interface MetadataChain {
	/** The `typst-render` mapping of each level, lowest first. */
	levels: TypstGlobalLevel[];
	/** Every level's own metadata, merged shallowly, lowest first. */
	metadata: Record<string, unknown>;
	/** The project root that owns the document, when one does. */
	projectRoot?: string;
	/** The directory holding the document, when it is a file on disk. */
	documentDirectory?: string;
	/**
	 * The directory a relative `brand:` path resolves from.
	 *
	 * Quarto splits the two cases at `src/project/project-shared.ts:597` and
	 * `:665`: a `brand:` in the project configuration resolves from the project
	 * root, and one reaching the file metadata resolves from the directory of the
	 * document. So this is the project root when `_quarto.yml` is the only level
	 * that names the key, and the document directory when any higher level does.
	 */
	brandBase?: string;
}

/**
 * A file read as text, preferring a copy open in the editor.
 *
 * An unsaved edit to `_quarto.yml` or to a `.typ` beside the block drives the
 * preview the way an unsaved edit to the document itself already does.
 */
export async function readSourceText(fsPath: string): Promise<string | undefined> {
	const target = path.normalize(fsPath);
	for (const open of vscode.workspace.textDocuments) {
		if (open.uri.scheme === "file" && path.normalize(open.uri.fsPath) === target) {
			return open.getText();
		}
	}
	try {
		const buffer = await vscode.workspace.fs.readFile(vscode.Uri.file(fsPath));
		return Buffer.from(buffer).toString("utf8");
	} catch {
		return undefined;
	}
}

/** A YAML document read from disk, or undefined when it is absent or invalid. */
async function readYaml(fsPath: string): Promise<unknown> {
	const text = await readSourceText(fsPath);
	if (text === undefined) {
		return undefined;
	}
	try {
		return yaml.load(text);
	} catch {
		return undefined;
	}
}

/**
 * The first of a set of candidate file names that reads.
 *
 * The candidates are read together and the first defined one wins, because a
 * directory carrying neither is the common case in the `_metadata.yml` walk and
 * reading them one after another would pay two misses per directory.
 */
async function readFirst(directory: string, names: readonly string[]): Promise<unknown> {
	const documents = await Promise.all(names.map((name) => readYaml(path.join(directory, name))));
	return documents.find((document) => document !== undefined);
}

/**
 * A path Quarto resolves against a document or a project,
 * `_modules/paths.lua:34-48` and `src/project/project-shared.ts:574-584`.
 *
 * A leading `/` means the project root, and every other path is relative to the
 * directory passed in. Undefined when there is no directory to resolve against,
 * which is a document that lives outside every project root.
 */
export function resolveQuartoPath(
	quartoPath: string,
	from: string | undefined,
	projectRoot: string | undefined,
): string | undefined {
	const fromProjectRoot = quartoPath.startsWith("/");
	const base = fromProjectRoot ? projectRoot : from;
	return base === undefined ? undefined : path.join(base, fromProjectRoot ? quartoPath.slice(1) : quartoPath);
}

/**
 * Every directory from a project root down to a document, root first.
 *
 * This is what the `_metadata.yml` walk visits, and the order is the precedence
 * order: a file deeper in the tree is nearer the document and wins.
 */
function directoriesDownTo(projectRoot: string, documentDirectory: string): string[] {
	const relative = path.relative(projectRoot, documentDirectory);
	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		return [];
	}
	const directories = [projectRoot];
	let current = projectRoot;
	for (const segment of relative.split(path.sep).filter((part) => part.length > 0)) {
		current = path.join(current, segment);
		directories.push(current);
	}
	return directories;
}

/** One level of the chain, and where a `brand:` path it names would resolve from. */
interface Level {
	source: unknown;
	brandBase?: string;
}

/**
 * The metadata chain of a document, lowest level first.
 *
 * The order is Quarto's own: the project `_quarto.yml`, the files it reaches
 * through `metadata-files:`, the `_metadata.yml` walk from the project root down
 * to the document directory, and the document front matter last.
 *
 * Every level is read at once. None of them depends on another's value, and a
 * document three directories deep otherwise pays a dozen serial reads on every
 * request. `Promise.all` keeps the index order, which is the precedence order.
 *
 * `getMetadataFiles` is not itself the chain. It returns only the files reached
 * through `metadata-files:`, and it returns them as a set, so they are read in
 * path order rather than in declaration order. Two of them setting the same key
 * is the only case where that differs, and Quarto is the authority on it, not
 * this preview.
 *
 * @param text - The document text, when the caller already has it.
 * @param projectRoot - The owning root, when the caller has already found it.
 */
export async function readMetadataChain(
	document: vscode.TextDocument,
	text = document.getText(),
	projectRoot?: string,
): Promise<MetadataChain> {
	const owningRoot = projectRoot ?? (await findOwningProjectRoot(document.uri));
	const documentDirectory = document.uri.scheme === "file" ? path.dirname(document.uri.fsPath) : undefined;

	// The project configuration is its own case for `brand:`, so each level says
	// which directory a relative path it names would resolve from. Every level
	// above `_quarto.yml` reaches Quarto through the file metadata, which resolves
	// from the directory of the document rather than from the level's own.
	const pending: Promise<Level>[] = [];
	const level = async (source: Promise<unknown>, brandBase?: string): Promise<Level> => ({
		source: await source,
		brandBase,
	});

	if (owningRoot !== undefined) {
		pending.push(level(readFirst(owningRoot, ["_quarto.yml", "_quarto.yaml"]), owningRoot));

		for (const file of [...(await getMetadataFiles(owningRoot))].sort()) {
			pending.push(level(readYaml(file), documentDirectory));
		}

		if (documentDirectory !== undefined) {
			for (const directory of directoriesDownTo(owningRoot, documentDirectory)) {
				pending.push(level(readFirst(directory, ["_metadata.yml", "_metadata.yaml"]), documentDirectory));
			}
		}
	}

	const levels: TypstGlobalLevel[] = [];
	const metadata: Record<string, unknown> = {};
	let brandBase: string | undefined;
	for (const { source, brandBase: base } of [
		...(await Promise.all(pending)),
		{ source: parseFrontMatter(text), brandBase: documentDirectory },
	]) {
		const map = mapping(source);
		if (map === undefined) {
			continue;
		}
		Object.assign(metadata, map);
		if (map.brand !== undefined) {
			brandBase = base;
		}
		const extension = extensionLevel(map);
		if (extension !== undefined) {
			levels.push(extension);
		}
	}

	return { levels, metadata, projectRoot: owningRoot, documentDirectory, brandBase };
}

/**
 * The brand a document resolves against.
 *
 * The four candidate paths and their order are Quarto's, and so is the rule that
 * the last one that exists wins rather than the first: the loop upstream does
 * not stop at its first hit.
 *
 * A document outside every project root has no brand, because a brand is a
 * property of a project and there is no root to resolve a path against.
 */
export async function readBrand(chain: MetadataChain): Promise<Brand> {
	const projectRoot = chain.projectRoot;
	if (projectRoot === undefined) {
		return EMPTY_BRAND;
	}

	const override = readBrandOverride(chain.metadata.brand);
	// The chain recorded which level wrote the key, because the project
	// configuration resolves a relative path from the project root and every level
	// above it resolves from the directory of the document.
	const from = chain.brandBase ?? projectRoot;
	const read = async (brandPath: string | undefined): Promise<unknown> => {
		const resolved = brandPath === undefined ? undefined : resolveQuartoPath(brandPath, from, projectRoot);
		return resolved === undefined ? undefined : readYaml(resolved);
	};

	if (override.kind === "disabled") {
		return EMPTY_BRAND;
	}
	if (override.kind === "unified") {
		return splitBrand(await read(override.path));
	}
	if (override.kind === "split") {
		const [light, dark] = await Promise.all([read(override.light), read(override.dark)]);
		return joinBrands(light, dark);
	}

	// All four are read together, because the last one that exists wins and every
	// one of them has to be looked at to know which that is.
	const documents = await Promise.all(BRAND_CANDIDATES.map((candidate) => readYaml(path.join(projectRoot, candidate))));
	const last = documents.filter((document) => document !== undefined).pop();
	return last === undefined ? EMPTY_BRAND : splitBrand(last);
}
