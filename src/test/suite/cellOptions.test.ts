import * as assert from "assert";
import { cellLanguage, readCellOptions, type CellOptionLine } from "../../utils/cellOptions";
import { findFencedBlocks } from "../../utils/yamlPosition";

function read(text: string): CellOptionLine[] | undefined {
	const block = findFencedBlocks(text)[0];
	const language = cellLanguage(block.info);
	assert.ok(language !== undefined, "the fixture must open a cell");
	return readCellOptions(text, block, language);
}

function slice(text: string, range: { start: number; end: number } | undefined): string | undefined {
	return range === undefined ? undefined : text.slice(range.start, range.end);
}

suite("cellOptions Test Suite", () => {
	suite("cellLanguage", () => {
		const cases: [string, string | undefined][] = [
			["{r}", "r"],
			["{r, echo=FALSE}", "r"],
			[" {Python} ", "python"],
			["{typst}", "typst"],
			["{=typst}", undefined],
			["{.typst}", undefined],
			['{.typst include="x"}', undefined],
			["typst", undefined],
			["", undefined],
		];
		for (const [info, expected] of cases) {
			test(`${JSON.stringify(info)} gives ${expected}`, () => {
				assert.strictEqual(cellLanguage(info), expected);
			});
		}
	});

	suite("readCellOptions", () => {
		test("reads keys and values with document offsets", () => {
			const text = '```{r}\n#| label: fig-a\n#| dpi: "300"\nplot()\n```\n';
			const lines = read(text);
			assert.ok(lines);
			assert.deepStrictEqual(
				lines.map((l) => l.key),
				["label", "dpi"],
			);
			assert.strictEqual(lines[1].value, "300");
			assert.strictEqual(slice(text, lines[1].keyRange), "dpi");
			assert.strictEqual(slice(text, lines[1].valueRange), '"300"');
			assert.strictEqual(slice(text, lines[0].valueRange), "fig-a");
		});

		test("uses the typst prefix only", () => {
			assert.deepStrictEqual(
				read("```{typst}\n//| format: svg\n```\n")?.map((l) => l.key),
				["format"],
			);
			assert.deepStrictEqual(read("```{typst}\n#| format: svg\n```\n"), []);
		});

		test("reads a paired comment and drops the close token", () => {
			const text = "```{c}\n/*| label: a */\n```\n";
			const lines = read(text);
			assert.ok(lines);
			assert.strictEqual(lines[0].key, "label");
			assert.strictEqual(lines[0].value, "a");
			assert.strictEqual(slice(text, lines[0].valueRange), "a");
		});

		test("stops at the first non-option line", () => {
			const lines = read("```{r}\n#| a: 1\nplot()\n#| x: 1\n```\n");
			assert.deepStrictEqual(
				lines?.map((l) => l.key),
				["a"],
			);
		});

		test("maps offsets inside a blockquote and a list item", () => {
			const quoted = "> ```{r}\n> #| dpi: 2\n> x\n> ```\n";
			const listed = "- item\n\n   ```{r}\n   #| dpi: 2\n   x\n   ```\n";
			for (const text of [quoted, listed]) {
				const block = findFencedBlocks(text)[0];
				const lines = readCellOptions(text, block, "r");
				assert.ok(lines);
				assert.strictEqual(lines.length, 1);
				assert.strictEqual(slice(text, lines[0].keyRange), "dpi");
				assert.strictEqual(slice(text, lines[0].valueRange), "2");
			}
		});

		test("gives the same result on a CRLF document", () => {
			const text = '```{r}\r\n#| label: a\r\n#| dpi: "300"\r\nx\r\n```\r\n';
			const lines = read(text);
			assert.ok(lines);
			assert.deepStrictEqual(
				lines.map((l) => l.key),
				["label", "dpi"],
			);
			assert.strictEqual(slice(text, lines[0].valueRange), "a");
			assert.strictEqual(slice(text, lines[1].valueRange), '"300"');
		});

		test("skips a key with a block value and keeps its continuation in the run", () => {
			const text = "```{r}\n#| fig-cap:\n#|   - a\n#|   - b\n#| dpi: 2\nx\n```\n";
			const lines = read(text);
			assert.ok(lines);
			assert.deepStrictEqual(
				lines.map((l) => [l.key, l.value]),
				[
					["fig-cap", undefined],
					["dpi", "2"],
				],
			);
			assert.strictEqual(lines[0].valueRange, undefined);
		});

		test("returns undefined for a language without a prefix", () => {
			const text = "```{foo}\n#| a: 1\n```\n";
			assert.strictEqual(readCellOptions(text, findFencedBlocks(text)[0], "foo"), undefined);
		});
	});
});
