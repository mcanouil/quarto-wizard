import * as assert from "assert";
import { cellLanguage, cellOptionLineAt, readCellOptions, type CellOptionLine } from "../../utils/cellOptions";
import { findFencedBlocks } from "../../utils/yamlPosition";

function read(text: string): CellOptionLine[] {
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
		test("strips a trailing YAML comment from an unquoted value", () => {
			const text =
				'```{r}\n#| dpi: 300 # note\n#| title: "a # b"\n#| url: a#b\n#| quoted: "x" # n\n#| empty: # n\nx\n```\n';
			const lines = read(text);
			assert.ok(lines);
			assert.strictEqual(lines[0].value, "300");
			assert.strictEqual(slice(text, lines[0].valueRange), "300");
			assert.strictEqual(lines[1].value, "a # b");
			assert.strictEqual(lines[2].value, "a#b");
			assert.strictEqual(lines[3].value, "x");
			assert.strictEqual(slice(text, lines[3].valueRange), '"x"');
			assert.strictEqual(lines[4].value, undefined);
		});

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

		test("reads hash-pipe lines of a language without comment characters", () => {
			const text = "```{elixir}\n#| dpi: 2\n```\n";
			const lines = read(text);
			assert.deepStrictEqual(
				lines.map((line) => [line.key, line.value]),
				[["dpi", "2"]],
			);
		});

		test("does not resolve an inherited name as a language prefix", () => {
			const text = "```{constructor}\n#| a: 1\n```\n";
			const block = findFencedBlocks(text)[0];
			for (const language of ["constructor", "__proto__", "foo"]) {
				assert.deepStrictEqual(
					readCellOptions(text, block, language).map((line) => line.key),
					["a"],
				);
			}
		});

		test("allows whitespace between the prefix and the pipe", () => {
			const text = "```{r}\n# | label: a\n```\n";
			const lines = read(text);
			assert.strictEqual(lines?.[0].key, "label");
			assert.strictEqual(slice(text, lines?.[0].keyRange), "label");
			assert.strictEqual(slice(text, lines?.[0].valueRange), "a");
		});

		test("does not read a line with a margin before the prefix", () => {
			assert.deepStrictEqual(read("```{r}\n  #| label: a\n```\n"), []);
		});

		test("does not read an unclosed paired comment", () => {
			assert.deepStrictEqual(read("```{c}\n/*| label: a\n```\n"), []);
		});

		test("maps offsets in a cell indented with a tab", () => {
			const text = "-\titem\n\n\t```{r}\n\t#| dpi: 2\n\tx\n\t```\n";
			const block = findFencedBlocks(text)[0];
			const lines = readCellOptions(text, block, "r");
			assert.ok(lines);
			assert.strictEqual(lines.length, 1);
			assert.strictEqual(slice(text, lines[0].keyRange), "dpi");
			assert.strictEqual(slice(text, lines[0].valueRange), "2");
		});

		test("treats a pipe line without a space after the colon as no option", () => {
			assert.deepStrictEqual(
				read("```{r}\n#|key:value\n#| dpi: 2\n```\n")?.map((l) => l.key),
				["dpi"],
			);
		});

		test("reads a pipe line without a space after the pipe", () => {
			const text = "```{r}\n#|key: value\n```\n";
			const lines = read(text);
			assert.strictEqual(slice(text, lines?.[0].keyRange), "key");
			assert.strictEqual(slice(text, lines?.[0].valueRange), "value");
		});
	});

	suite("cellOptionLineAt", () => {
		const text = "```{typst}\n//| dpi: 3\n//| \n#let a = 1\n//| \n```\n";
		const block = findFencedBlocks(text)[0];

		test("gives the text typed after the prefix on an option line", () => {
			const offset = text.indexOf("dpi: 3") + 3;
			assert.deepStrictEqual(cellOptionLineAt(text, block, "typst", offset), {
				typed: "dpi",
				start: text.indexOf("dpi: 3"),
			});
		});

		test("gives an empty text right after the prefix", () => {
			const offset = text.indexOf("//| \n#let") + 4;
			assert.strictEqual(cellOptionLineAt(text, block, "typst", offset)?.typed, "");
		});

		test("is undefined inside the prefix", () => {
			assert.strictEqual(cellOptionLineAt(text, block, "typst", text.indexOf("//| dpi") + 2), undefined);
		});

		test("is undefined after the option run", () => {
			assert.strictEqual(cellOptionLineAt(text, block, "typst", text.lastIndexOf("//| ") + 4), undefined);
		});

		test("is undefined for a language with another prefix", () => {
			assert.strictEqual(cellOptionLineAt(text, block, "r", text.indexOf("dpi")), undefined);
		});
	});
});
