import * as assert from "assert";
import * as path from "node:path";
import { findTypstBlocks } from "../../utils/typst/typstBlocks";
import { findTypstPathOptions, resolveTypstPathOption, type TypstPathOption } from "../../utils/typst/typstPathOptions";
import { annotateYaml, yamlRegionOf } from "../../utils/yamlAnnotated";

/** The parse a document holds, the way the document scan hands one to a provider. */
function readYaml(text: string, languageId: string) {
	const region = yamlRegionOf(text, languageId);
	return region === undefined ? undefined : annotateYaml(region.text, region.base);
}

/** Every occurrence as the text it covers, which is what a link is drawn over. */
function covered(text: string, languageId = "quarto"): string[] {
	return findTypstPathOptions(
		text,
		languageId,
		() => findTypstBlocks(text),
		() => readYaml(text, languageId),
	).map((option) => text.slice(option.start, option.end));
}

/** The one occurrence a document holds, which most cases below have. */
function only(text: string, languageId = "quarto"): TypstPathOption {
	const found = findTypstPathOptions(
		text,
		languageId,
		() => findTypstBlocks(text),
		() => readYaml(text, languageId),
	);
	assert.strictEqual(found.length, 1, `expected one occurrence, found ${found.length}`);
	return found[0];
}

suite("Typst Path Options Test Suite", () => {
	suite("Cell options", () => {
		test("Should find a `file:` option", () => {
			const text = "```{typst}\n//| file: _plot.typ\n```\n";
			const option = only(text);
			assert.strictEqual(option.key, "file");
			assert.strictEqual(option.value, "_plot.typ");
			assert.strictEqual(text.slice(option.start, option.end), "_plot.typ");
		});

		test("Should find every path option of a cell", () => {
			const text = "```{typst}\n//| file: _plot.typ\n//| preamble: _pre.typ\n```\n";
			assert.deepStrictEqual(covered(text), ["_plot.typ", "_pre.typ"]);
		});

		test("Should skip a `preamble:` that is inline Typst code", () => {
			// The filter reads an entry ending in `.typ` and treats every other one
			// as code, so a link over the code would point at nothing.
			const text = "```{typst}\n//| preamble: #set text(size: 10pt)\n```\n";
			assert.deepStrictEqual(covered(text), []);
		});

		test("Should skip an option that names no path", () => {
			const text = "```{typst}\n//| label: fig-one\n//| dpi: 300\n```\n";
			assert.deepStrictEqual(covered(text), []);
		});

		test("Should exclude the quotes of a quoted value", () => {
			const text = '```{typst}\n//| file: "_plot.typ"\n```\n';
			const option = only(text);
			assert.strictEqual(option.value, "_plot.typ");
			assert.strictEqual(text.slice(option.start, option.end), "_plot.typ");
		});

		test("Should exclude trailing whitespace", () => {
			const text = "```{typst}\n//| file: _plot.typ   \n```\n";
			assert.strictEqual(text.slice(only(text).start, only(text).end), "_plot.typ");
		});

		test("Should skip an option with an empty value", () => {
			const text = "```{typst}\n//| file: \n```\n";
			assert.deepStrictEqual(covered(text), []);
		});

		test("Should keep a project-rooted path as written", () => {
			const text = "```{typst}\n//| file: /_typst/plot.typ\n```\n";
			assert.strictEqual(only(text).value, "/_typst/plot.typ");
		});

		test("Should stop at the end of the option run", () => {
			// A `//|` line below the code is a warning upstream and never an option,
			// so it is not a path either.
			const text = "```{typst}\n//| file: _plot.typ\n#rect()\n//| preamble: _pre.typ\n```\n";
			assert.deepStrictEqual(covered(text), ["_plot.typ"]);
		});

		test("Should ignore a plain block, whose `//|` line is a comment", () => {
			const text = "```typst\n//| file: _plot.typ\n```\n";
			assert.deepStrictEqual(covered(text), []);
		});

		test("Should ignore a raw block, whose `//|` line is a comment", () => {
			const text = "```{=typst}\n//| file: _plot.typ\n```\n";
			assert.deepStrictEqual(covered(text), []);
		});

		test("Should report the offset of an indented cell", () => {
			const text = "- item\n\n  ```{typst}\n  //| file: _plot.typ\n  ```\n";
			const option = only(text);
			assert.strictEqual(text.slice(option.start, option.end), "_plot.typ");
		});

		test("Should report the offset of a quoted cell", () => {
			const text = "> ```{typst}\n> //| file: _plot.typ\n> ```\n";
			const option = only(text);
			assert.strictEqual(text.slice(option.start, option.end), "_plot.typ");
		});

		test("Should report the offset of a cell below front matter", () => {
			const text = "---\ntitle: One\n---\n\n```{typst}\n//| file: _plot.typ\n```\n";
			const option = only(text);
			assert.strictEqual(text.slice(option.start, option.end), "_plot.typ");
		});

		test("Should read a CRLF document", () => {
			const text = "```{typst}\r\n//| file: _plot.typ\r\n```\r\n";
			const option = only(text);
			assert.strictEqual(option.value, "_plot.typ");
			assert.strictEqual(text.slice(option.start, option.end), "_plot.typ");
		});
	});

	suite("Front matter options", () => {
		test("Should find a `preamble:` scalar", () => {
			const text = "---\ntypst-render:\n  preamble: _pre.typ\n---\n";
			const option = only(text);
			assert.strictEqual(option.key, "preamble");
			assert.strictEqual(text.slice(option.start, option.end), "_pre.typ");
		});

		test("Should find a `preamble:` under `extensions:`", () => {
			const text = "---\nextensions:\n  typst-render:\n    preamble: _pre.typ\n---\n";
			assert.deepStrictEqual(covered(text), ["_pre.typ"]);
		});

		test("Should find every entry of a `preamble:` list", () => {
			const text = "---\ntypst-render:\n  preamble:\n    - _one.typ\n    - _two.typ\n---\n";
			assert.deepStrictEqual(covered(text), ["_one.typ", "_two.typ"]);
		});

		test("Should find an entry written at the indent of its key", () => {
			// A block sequence sits at the indent of its key or deeper, and both are
			// the same document to YAML.
			const text = "---\ntypst-render:\n  preamble:\n  - _one.typ\n  - _two.typ\n---\n";
			assert.deepStrictEqual(covered(text), ["_one.typ", "_two.typ"]);
		});

		test("Should end a sequence at the next key of the same level", () => {
			const text = "---\ntypst-render:\n  preamble:\n  - _one.typ\n  dpi: 300\n---\n";
			assert.deepStrictEqual(covered(text), ["_one.typ"]);
		});

		test("Should find the entries below a key that carries a comment", () => {
			const text = "---\ntypst-render:\n  preamble: # the preamble\n    - _one.typ\n---\n";
			assert.deepStrictEqual(covered(text), ["_one.typ"]);
		});

		test("Should read an entry written with more than one space after the dash", () => {
			const text = "---\ntypst-render:\n  preamble:\n    -   _one.typ\n---\n";
			const option = only(text);
			assert.strictEqual(option.value, "_one.typ");
			assert.strictEqual(text.slice(option.start, option.end), "_one.typ");
		});

		test("Should find every entry of a flow sequence", () => {
			const text = "---\ntypst-render:\n  preamble: [_one.typ, _two.typ]\n---\n";
			assert.deepStrictEqual(covered(text), ["_one.typ", "_two.typ"]);
		});

		test("Should read a quoted entry of a flow sequence", () => {
			const text = "---\ntypst-render:\n  preamble: [\"_one.typ\", '#set page(fill: none)']\n---\n";
			assert.deepStrictEqual(covered(text), ["_one.typ"]);
		});

		test("Should skip a list entry that is inline Typst code", () => {
			const text = "---\ntypst-render:\n  preamble:\n    - _one.typ\n    - '#set page(fill: none)'\n---\n";
			assert.deepStrictEqual(covered(text), ["_one.typ"]);
		});

		test("Should skip a `preamble:` that belongs to another key", () => {
			const text = "---\nother:\n  preamble: _pre.typ\n---\n";
			assert.deepStrictEqual(covered(text), []);
		});

		test("Should skip a `file:` in front matter, which is a block-only option", () => {
			const text = "---\ntypst-render:\n  file: _plot.typ\n---\n";
			assert.deepStrictEqual(covered(text), []);
		});

		test("Should exclude a trailing comment", () => {
			const text = "---\ntypst-render:\n  preamble: _pre.typ # the preamble\n---\n";
			assert.strictEqual(only(text).value, "_pre.typ");
		});

		test("Should exclude the quotes of a quoted value", () => {
			const text = '---\ntypst-render:\n  preamble: "_pre.typ"\n---\n';
			const option = only(text);
			assert.strictEqual(option.value, "_pre.typ");
			assert.strictEqual(text.slice(option.start, option.end), "_pre.typ");
		});
	});

	suite("Configuration files", () => {
		test("Should read the whole of a YAML document", () => {
			const text = "project:\n  type: website\ntypst-render:\n  preamble: _pre.typ\n";
			assert.deepStrictEqual(covered(text, "yaml"), ["_pre.typ"]);
		});

		test("Should find nothing in a YAML document that names no preamble", () => {
			assert.deepStrictEqual(covered("project:\n  type: website\n", "yaml"), []);
		});
	});

	suite("resolveTypstPathOption", () => {
		const root = path.join(path.sep, "project");
		const directory = path.join(root, "posts");

		test("Should resolve a relative path against the directory of a document", () => {
			const target = resolveTypstPathOption("_pre.typ", { directory, projectRoot: root, configuration: false });
			assert.strictEqual(target.path, path.join(directory, "_pre.typ"));
			assert.strictEqual(target.reportable, true);
		});

		test("Should resolve a rooted path against the project root", () => {
			const target = resolveTypstPathOption("/_typst/pre.typ", { directory, projectRoot: root, configuration: false });
			assert.strictEqual(target.path, path.join(root, "_typst", "pre.typ"));
			assert.strictEqual(target.reportable, true);
		});

		test("Should not report a relative path written in a configuration file", () => {
			// Every document below the file resolves it against its own directory,
			// so the file itself cannot say the path leads nowhere.
			const target = resolveTypstPathOption("_pre.typ", { directory: root, projectRoot: root, configuration: true });
			assert.strictEqual(target.path, path.join(root, "_pre.typ"));
			assert.strictEqual(target.reportable, false);
		});

		test("Should report a rooted path written in a configuration file", () => {
			const target = resolveTypstPathOption("/_pre.typ", { directory: root, projectRoot: root, configuration: true });
			assert.strictEqual(target.path, path.join(root, "_pre.typ"));
			assert.strictEqual(target.reportable, true);
		});

		test("Should resolve nothing for a rooted path outside every project", () => {
			const target = resolveTypstPathOption("/_pre.typ", { directory, configuration: false });
			assert.strictEqual(target.path, undefined);
			assert.strictEqual(target.reportable, false);
		});

		test("Should resolve nothing for a document that is not on disk", () => {
			const target = resolveTypstPathOption("_pre.typ", { configuration: false });
			assert.strictEqual(target.path, undefined);
			assert.strictEqual(target.reportable, false);
		});
	});
});
