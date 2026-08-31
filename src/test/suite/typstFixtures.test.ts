import * as assert from "assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { blockAtOffset, findTypstBlocks, type TypstBlock } from "../../utils/typst/typstBlocks";
import { BRAND_CANDIDATES, splitBrand, EMPTY_BRAND, type Brand } from "../../utils/typst/typstBrand";
import { extensionLevel, type TypstBrandMode, type TypstGlobalLevel } from "../../utils/typst/typstOptions";
import { parseFrontMatter } from "../../utils/yamlPosition";
import { buildCell, isUnavailable } from "../../utils/typst/typstSource";
import { PINNED_TYPST_RENDER_VERSION } from "../../providers/typstPreview/typstContext";

/**
 * The recorded fixtures of the `typst-render` cell pipeline.
 *
 * Each `expected.typ` is output of the filter itself, written by its own
 * `output-source: true`, and not an expectation written by hand. That is what
 * makes the comparison a drift guard: when the filter changes what it compiles,
 * a refreshed fixture disagrees with this port and says so.
 *
 * `src/test/fixtures/typstPreview/README.md` holds the refresh procedure and the
 * pinned extension version.
 */

const FIXTURES = path.join(__dirname, "..", "..", "..", "src", "test", "fixtures", "typstPreview");

/** What `meta.json` pins about the render that produced a fixture. */
interface FixtureMeta {
	brandMode: TypstBrandMode;
	extensionVersion: string;
}

/** One YAML file of a fixture directory, or undefined when it is absent. */
function readYaml(directory: string, name: string): unknown {
	const file = path.join(directory, name);
	return fs.existsSync(file) ? yaml.load(fs.readFileSync(file, "utf8")) : undefined;
}

/**
 * The metadata levels of a fixture, lowest first.
 *
 * A fixture is one directory, so the chain is the project `_quarto.yml` and then
 * the document front matter. The `_metadata.yml` walk and the `metadata-files:`
 * targets sit between the two, and the provider is what assembles them from
 * disk; no fixture needs a level the provider alone can find.
 */
function levelsOf(directory: string, metadata: unknown): TypstGlobalLevel[] {
	const levels: TypstGlobalLevel[] = [];
	for (const source of [readYaml(directory, "_quarto.yml"), metadata]) {
		const level = extensionLevel(source);
		if (level !== undefined) {
			levels.push(level);
		}
	}
	return levels;
}

/** The brand of a fixture, from the first candidate path that exists. */
function brandOf(directory: string): Brand {
	for (const candidate of BRAND_CANDIDATES) {
		const document = readYaml(directory, candidate);
		if (document !== undefined) {
			return splitBrand(document);
		}
	}
	return EMPTY_BRAND;
}

/** The one cell of a fixture document. */
function cellOf(text: string): TypstBlock {
	const blocks = findTypstBlocks(text);
	const block = blockAtOffset(blocks, blocks[0].bodyStart);
	assert.ok(block !== undefined && block.kind === "cell", "the fixture must hold one executable cell");
	return block;
}

suite("Typst Fixtures Test Suite", () => {
	const names = fs
		.readdirSync(FIXTURES, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();

	test("Should find the recorded fixtures", () => {
		// A path that stopped resolving would otherwise turn every comparison below
		// into a suite that silently asserts nothing.
		assert.ok(names.length > 0, `no fixture directory under ${FIXTURES}`);
	});

	for (const name of names) {
		const directory = path.join(FIXTURES, name);

		test(`Should compile the ${name} fixture byte for byte`, async () => {
			const meta = JSON.parse(fs.readFileSync(path.join(directory, "meta.json"), "utf8")) as FixtureMeta;
			// The constant is what the runtime drift warning compares against, so a
			// fixture recorded from another version would make that warning lie.
			assert.strictEqual(meta.extensionVersion, PINNED_TYPST_RENDER_VERSION);
			const text = fs.readFileSync(path.join(directory, "block.qmd"), "utf8");
			const metadata = parseFrontMatter(text);

			const built = await buildCell(cellOf(text), {
				levels: levelsOf(directory, metadata),
				brand: brandOf(directory),
				// `meta.json` pins the side of the recording, which is what the fixture
				// compares against. It is not always the mode the document asks for: a
				// document whose colours differ between the two is rendered twice, and
				// each side is one fixture.
				mode: meta.brandMode,
				readFile: async (documentPath) => {
					const file = path.join(directory, documentPath);
					return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
				},
			});

			assert.ok(!isUnavailable(built), `the fixture did not assemble: ${JSON.stringify(built)}`);
			// Line endings are normalised on both sides. The filter writes the source
			// it compiled, which Typst reads with either ending, and a fixture
			// recorded on one platform must not fail on another.
			const expected = fs.readFileSync(path.join(directory, "expected.typ"), "utf8");
			assert.strictEqual(built.source.replace(/\r\n/g, "\n"), expected.replace(/\r\n/g, "\n"));
		});
	}
});
