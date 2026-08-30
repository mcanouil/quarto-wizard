import * as path from "node:path";
import * as vscode from "vscode";
import * as yaml from "js-yaml";
import { getMetadataFiles } from "../../utils/metadataFilesRegistry";
import { findOwningProjectRoot } from "../../utils/projectRootsRegistry";
import {
	BRAND_CANDIDATES,
	EMPTY_BRAND,
	joinBrands,
	readBrandOverride,
	splitBrand,
	type Brand,
} from "../../utils/typst/typstBrand";
import { extensionLevel, type TypstGlobalLevel } from "../../utils/typst/typstOptions";

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
}

/** A YAML document read from disk, or undefined when it is absent or invalid. */
async function readYaml(fsPath: string): Promise<unknown> {
	// The open document wins, so an unsaved edit to `_quarto.yml` drives the
	// preview the way an unsaved edit to the document itself already does.
	for (const open of vscode.workspace.textDocuments) {
		if (open.uri.scheme === "file" && path.normalize(open.uri.fsPath) === path.normalize(fsPath)) {
			return parse(open.getText());
		}
	}
	try {
		const buffer = await vscode.workspace.fs.readFile(vscode.Uri.file(fsPath));
		return parse(Buffer.from(buffer).toString("utf8"));
	} catch {
		return undefined;
	}
}

/** A YAML string parsed, or undefined when it does not parse. */
function parse(text: string): unknown {
	try {
		return yaml.load(text);
	} catch {
		return undefined;
	}
}

/** The first of a set of candidate file names that reads, in the given order. */
async function readFirst(directory: string, names: readonly string[]): Promise<unknown> {
	for (const name of names) {
		const document = await readYaml(path.join(directory, name));
		if (document !== undefined) {
			return document;
		}
	}
	return undefined;
}

/**
 * The front matter of a Quarto document.
 *
 * Deliberately its own reader rather than `getYamlFrontMatterRange`, which
 * answers a range in a document that may be open and edited. Here the text is
 * already in hand and only the parsed mapping is wanted.
 */
export function readFrontMatter(text: string): unknown {
	const normalised = text.replace(/\r\n/g, "\n");
	if (!normalised.startsWith("---\n")) {
		return undefined;
	}
	const end = normalised.indexOf("\n---", 3);
	return end === -1 ? undefined : parse(normalised.slice(4, end + 1));
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

/**
 * The metadata chain of a document, lowest level first.
 *
 * The order is Quarto's own: the project `_quarto.yml`, the files it reaches
 * through `metadata-files:`, the `_metadata.yml` walk from the project root down
 * to the document directory, and the document front matter last.
 *
 * `getMetadataFiles` is not itself the chain. It returns only the files reached
 * through `metadata-files:`, and it returns them as a set, so they are read in
 * path order rather than in declaration order. Two of them setting the same key
 * is the only case where that differs, and Quarto is the authority on it, not
 * this preview.
 */
export async function readMetadataChain(document: vscode.TextDocument): Promise<MetadataChain> {
	const documents: unknown[] = [];
	const projectRoot = await findOwningProjectRoot(document.uri);
	const documentDirectory = document.uri.scheme === "file" ? path.dirname(document.uri.fsPath) : undefined;

	if (projectRoot !== undefined) {
		documents.push(await readFirst(projectRoot, ["_quarto.yml", "_quarto.yaml"]));

		for (const file of [...(await getMetadataFiles(projectRoot))].sort()) {
			documents.push(await readYaml(file));
		}

		if (documentDirectory !== undefined) {
			for (const directory of directoriesDownTo(projectRoot, documentDirectory)) {
				documents.push(await readFirst(directory, ["_metadata.yml", "_metadata.yaml"]));
			}
		}
	}

	documents.push(readFrontMatter(document.getText()));

	const levels: TypstGlobalLevel[] = [];
	const metadata: Record<string, unknown> = {};
	for (const source of documents) {
		if (source === null || typeof source !== "object" || Array.isArray(source)) {
			continue;
		}
		Object.assign(metadata, source as Record<string, unknown>);
		const level = extensionLevel(source);
		if (level !== undefined) {
			levels.push(level);
		}
	}

	return { levels, metadata, projectRoot };
}

/**
 * A `brand:` path resolved the way Quarto resolves one,
 * `src/project/project-shared.ts:574-584`.
 *
 * A leading `/` means the project root. Every other path is relative to the
 * directory of the level that wrote the key, which is the document directory for
 * a document-level `brand:` and the project root for a project-level one.
 */
function resolveBrandPath(brandPath: string, from: string, projectRoot: string): string {
	return brandPath.startsWith("/") ? path.join(projectRoot, brandPath.slice(1)) : path.join(from, brandPath);
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
export async function readBrand(chain: MetadataChain, documentDirectory: string | undefined): Promise<Brand> {
	const projectRoot = chain.projectRoot;
	if (projectRoot === undefined) {
		return EMPTY_BRAND;
	}

	const override = readBrandOverride(chain.metadata.brand);
	// The key is read from the merged chain, so the level that wrote it is the
	// highest one that names it. The document directory is where a document-level
	// path resolves from, and the project root is the fallback.
	const from = documentDirectory ?? projectRoot;

	if (override.kind === "disabled") {
		return EMPTY_BRAND;
	}
	if (override.kind === "unified") {
		return splitBrand(await readYaml(resolveBrandPath(override.path, from, projectRoot)));
	}
	if (override.kind === "split") {
		const read = async (brandPath: string | undefined): Promise<unknown> =>
			brandPath === undefined ? undefined : readYaml(resolveBrandPath(brandPath, from, projectRoot));
		return joinBrands(await read(override.light), await read(override.dark));
	}

	let brand = EMPTY_BRAND;
	for (const candidate of BRAND_CANDIDATES) {
		const document = await readYaml(path.join(projectRoot, candidate));
		if (document !== undefined) {
			brand = splitBrand(document);
		}
	}
	return brand;
}
