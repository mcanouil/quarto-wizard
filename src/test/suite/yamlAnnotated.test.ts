import * as assert from "assert";
import { annotateYaml, keyPathOf, sentinelPath, yamlRegionHolds, yamlRegionOf } from "../../utils/yamlAnnotated";

/** The text a range covers, which is what every position assertion is about. */
function at(text: string, range: { start: number; end: number } | undefined): string | undefined {
	return range === undefined ? undefined : text.slice(range.start, range.end);
}

suite("Annotated YAML Test Suite", () => {
	suite("annotateYaml values", () => {
		test("Should carry the value the loader builds", () => {
			const annotated = annotateYaml("title: A\ncount: 2\nflag: true\n");
			assert.deepStrictEqual(annotated?.value, { title: "A", count: 2, flag: true });
		});

		test("Should resolve an anchor and its alias", () => {
			const annotated = annotateYaml("base: &b\n  a: 1\nsame: *b\n");
			assert.deepStrictEqual(annotated?.value, { base: { a: 1 }, same: { a: 1 } });
		});

		test("Should leave the value undefined for an empty document", () => {
			const annotated = annotateYaml("");
			assert.strictEqual(annotated?.value, undefined);
		});
	});

	suite("annotateYaml positions", () => {
		test("Should point a key at the key and a value at the value", () => {
			const text = "title: A\n";
			const annotated = annotateYaml(text);
			const node = annotated?.nodeAt(["title"]);
			assert.strictEqual(at(text, node?.keyRange), "title");
			assert.strictEqual(at(text, node?.range), "A");
		});

		test("Should point at a nested key", () => {
			const text = "extensions:\n  modal:\n    size: large\n";
			const annotated = annotateYaml(text);
			const node = annotated?.nodeAt(["extensions", "modal", "size"]);
			assert.strictEqual(at(text, node?.keyRange), "size");
			assert.strictEqual(at(text, node?.range), "large");
		});

		test("Should report the content of a quoted value, without its quotes", () => {
			const text = 'preamble: "a b.typ"\n';
			const annotated = annotateYaml(text);
			assert.strictEqual(at(text, annotated?.nodeAt(["preamble"])?.range), "a b.typ");
		});

		test("Should index a sequence entry by its position", () => {
			const text = "items:\n  - first\n  - second\n";
			const annotated = annotateYaml(text);
			assert.strictEqual(at(text, annotated?.nodeAt(["items", 1])?.range), "second");
		});

		test("Should keep the key of a value that is not written", () => {
			// An unwritten value reports offsets of -1, which is not a range.
			const text = "extensions:\n  modal:\n";
			const annotated = annotateYaml(text);
			const node = annotated?.nodeAt(["extensions", "modal"]);
			assert.strictEqual(at(text, node?.keyRange), "modal");
			assert.strictEqual(node?.range, undefined);
		});

		test("Should span a mapping from its start to the end of its last child", () => {
			const text = "extensions:\n  modal:\n    size: large\n";
			const annotated = annotateYaml(text);
			assert.strictEqual(at(text, annotated?.nodeAt(["extensions"])?.range), "modal:\n    size: large");
		});

		test("Should report the offsets of a CRLF document", () => {
			const text = "title: A\r\nother: B\r\n";
			const annotated = annotateYaml(text);
			assert.strictEqual(at(text, annotated?.nodeAt(["other"])?.keyRange), "other");
			assert.strictEqual(at(text, annotated?.nodeAt(["other"])?.range), "B");
		});

		test("Should add the base offset to every range", () => {
			const body = "title: A\n";
			const document = `---\n${body}---\n`;
			const annotated = annotateYaml(body, 4);
			assert.strictEqual(at(document, annotated?.nodeAt(["title"])?.keyRange), "title");
			assert.strictEqual(at(document, annotated?.nodeAt(["title"])?.range), "A");
		});
	});

	suite("annotateYaml failures of the line walk", () => {
		test("Should resolve a duplicated key to its last occurrence", () => {
			const text = "dup: 1\nother: x\ndup: 2\n";
			const annotated = annotateYaml(text);
			const node = annotated?.nodeAt(["dup"]);
			assert.strictEqual(node?.keyRange?.start, text.lastIndexOf("dup"));
			assert.strictEqual(at(text, node?.range), "2");
		});

		test("Should keep positions when a duplicated key stops the value being built", () => {
			const text = "dup: 1\ndup: 2\n";
			const annotated = annotateYaml(text);
			assert.notStrictEqual(annotated, undefined);
			assert.strictEqual(annotated?.value, undefined);
			assert.strictEqual(at(text, annotated?.nodeAt(["dup"])?.range), "2");
		});

		test("Should read a flow style mapping the line walk never matched", () => {
			const text = "format: {html: {toc: true}}\n";
			const annotated = annotateYaml(text);
			const node = annotated?.nodeAt(["format", "html", "toc"]);
			assert.strictEqual(at(text, node?.keyRange), "toc");
			assert.strictEqual(at(text, node?.range), "true");
		});

		test("Should treat a key spelled inside a block scalar as content", () => {
			const text = "note: |\n  size: large\nsize: small\n";
			const annotated = annotateYaml(text);
			// The `size:` inside the scalar is text, so the only `size` is the real one.
			assert.strictEqual(annotated?.nodeAt(["size"])?.keyRange?.start, text.lastIndexOf("size"));
			assert.strictEqual(at(text, annotated?.nodeAt(["size"])?.range), "small");
		});

		test("Should report nothing for YAML that does not parse", () => {
			assert.strictEqual(annotateYaml("a:\n\tb: 1\n"), undefined);
		});

		test("Should keep reading the keys below a mapping used as a key", () => {
			// An explicit complex key is legal YAML and names nothing a reader can
			// address. It is read so that the pairs after it still line up: without
			// that, every key below one would take the position of its neighbour.
			const text = "? [a, b]\n: first\nsize: large\n";
			const annotated = annotateYaml(text);
			assert.strictEqual(at(text, annotated?.nodeAt(["size"])?.keyRange), "size");
			assert.strictEqual(at(text, annotated?.nodeAt(["size"])?.range), "large");
		});

		test("Should read JSON, because JSON is flow style YAML", () => {
			const text = '{\n  "options": {\n    "size": {"type": "string"}\n  }\n}\n';
			const annotated = annotateYaml(text);
			const node = annotated?.nodeAt(["options", "size", "type"]);
			assert.strictEqual(at(text, node?.range), "string");
			assert.deepStrictEqual(annotated?.value, { options: { size: { type: "string" } } });
		});
	});

	suite("pathAt", () => {
		test("Should report a key and say the offset is on a key", () => {
			const text = "extensions:\n  modal:\n    size: large\n";
			const found = annotateYaml(text)?.pathAt(text.indexOf("size") + 1);
			assert.deepStrictEqual(found, { path: ["extensions", "modal", "size"], on: "key" });
		});

		test("Should report a value and say the offset is on a value", () => {
			const text = "extensions:\n  modal:\n    size: large\n";
			const found = annotateYaml(text)?.pathAt(text.indexOf("large") + 1);
			assert.deepStrictEqual(found, { path: ["extensions", "modal", "size"], on: "value" });
		});

		test("Should tell a colon inside a value from the separator", () => {
			// `isCursorOnValue` compared the cursor against the first colon, which
			// this line puts inside the value.
			const text = 'title: "a: b"\n';
			const found = annotateYaml(text)?.pathAt(text.indexOf("a: b") + 1);
			assert.deepStrictEqual(found, { path: ["title"], on: "value" });
		});

		test("Should index a sequence entry", () => {
			const text = "items:\n  - name: first\n";
			const found = annotateYaml(text)?.pathAt(text.indexOf("first") + 1);
			assert.deepStrictEqual(found, { path: ["items", 0, "name"], on: "value" });
		});

		test("Should report nothing in the whitespace between nodes", () => {
			const text = "a: 1\n\nb: 2\n";
			assert.strictEqual(annotateYaml(text)?.pathAt(text.indexOf("\n\n") + 1), undefined);
		});

		test("Should report the path after the reader returns to the parent level", () => {
			const text = "extensions:\n  modal:\n    size: large\nformat:\n  html:\n    theme: cosmo\n";
			const found = annotateYaml(text)?.pathAt(text.indexOf("cosmo") + 1);
			assert.deepStrictEqual(found, { path: ["format", "html", "theme"], on: "value" });
		});

		test("Should report nothing below the front matter of a Quarto document", () => {
			const text = "---\ntitle: A\n---\n\ntitle: not front matter\n";
			const region = yamlRegionOf(text, "quarto");
			const annotated = annotateYaml(region?.text ?? "", region?.base ?? 0);
			assert.strictEqual(annotated?.pathAt(text.lastIndexOf("title") + 1), undefined);
		});
	});

	suite("keyPathOf", () => {
		test("Should drop the index of a sequence entry", () => {
			assert.deepStrictEqual(keyPathOf(["items", 0, "name"]), ["items", "name"]);
		});

		test("Should leave a path of keys alone", () => {
			assert.deepStrictEqual(keyPathOf(["extensions", "modal"]), ["extensions", "modal"]);
		});
	});

	suite("keysAt", () => {
		test("Should return the root keys", () => {
			const annotated = annotateYaml("title: Test\nauthor: Me\nformat: html\n");
			assert.deepStrictEqual(annotated?.keysAt([]), new Set(["title", "author", "format"]));
		});

		test("Should return the children of a path and not its grandchildren", () => {
			const text = "extensions:\n  modal:\n    style:\n      background: blue\n    size: large\n";
			assert.deepStrictEqual(annotateYaml(text)?.keysAt(["extensions", "modal"]), new Set(["style", "size"]));
		});

		test("Should ignore comments and blank lines", () => {
			const text = "extensions:\n  # A comment\n\n  modal:\n  iconify:\n";
			assert.deepStrictEqual(annotateYaml(text)?.keysAt(["extensions"]), new Set(["modal", "iconify"]));
		});

		test("Should return an empty set for a path that is not written", () => {
			const text = "extensions:\n  modal:\n    size: large\n";
			assert.deepStrictEqual(annotateYaml(text)?.keysAt(["extensions", "nowhere"]), new Set());
		});

		test("Should return an empty set for a path that is not a mapping", () => {
			assert.deepStrictEqual(annotateYaml("title: A\n")?.keysAt(["title"]), new Set());
		});

		test("Should return the root keys of the front matter of a Quarto document", () => {
			const text = "---\ntitle: Test\nauthor: Me\n---\nBody text\n";
			const region = yamlRegionOf(text, "quarto");
			const annotated = annotateYaml(region?.text ?? "", region?.base ?? 0);
			assert.deepStrictEqual(annotated?.keysAt([]), new Set(["title", "author"]));
		});

		test("Should find a path written after other siblings at the same level", () => {
			const text = "extensions:\n  other:\n    x: 1\n  another:\n    y: 2\n  modal:\n    size: large\n";
			assert.deepStrictEqual(annotateYaml(text)?.keysAt(["extensions", "modal"]), new Set(["size"]));
		});
	});

	suite("sentinelPath", () => {
		test("Should give the parent path of a blank child line", () => {
			const text = "extensions:\n  ";
			assert.deepStrictEqual(sentinelPath(text, text.length, 2)?.path, ["extensions"]);
		});

		test("Should give the parent path of a blank line at the root", () => {
			const text = "extensions:\n  iconify:\n";
			assert.deepStrictEqual(sentinelPath(text + "", text.length, 0)?.path, []);
		});

		test("Should give the parent path when a sibling follows the blank line", () => {
			const text = "extensions:\n  \nformat: html\n";
			assert.deepStrictEqual(sentinelPath(text, text.indexOf("\n") + 3, 2)?.path, ["extensions"]);
		});

		test("Should give the parent path of a partly typed key", () => {
			// The column is the cursor, which sits after the characters already
			// typed, so the key is placed at the indent of the line and not there.
			const text = "extensions:\n  mod";
			assert.deepStrictEqual(sentinelPath(text, text.length, 5)?.path, ["extensions"]);
		});

		test("Should give the parent path when the sibling above has children", () => {
			// Placing the key at the cursor column would put it at the indent of
			// `type`, making it a child of `size` rather than a sibling of it.
			const text = "options:\n  size:\n    type: string\n  co";
			assert.deepStrictEqual(sentinelPath(text, text.length, 4)?.path, ["options"]);
		});

		test("Should give the parent path when the sibling above has a value", () => {
			// Placing the key at the cursor column here indents past a scalar, which
			// is not valid YAML, so the parse would fail and offer nothing.
			const text = "extensions:\n  iconify: x\n  mo";
			assert.deepStrictEqual(sentinelPath(text, text.length, 4)?.path, ["extensions"]);
		});

		test("Should patch the first line when the cursor is at the start of the text", () => {
			// A search back from an offset of zero finds the newline at that offset
			// when the text opens with one, which takes the line below instead.
			const text = "\nformat: html\n";
			const found = sentinelPath(text, 0, 0);
			assert.deepStrictEqual(found?.path, []);
			assert.deepStrictEqual(found?.keys, new Set(["format"]));
		});

		test("Should report nothing when the rest of the document does not parse", () => {
			// The patch replaces the line the cursor is on, so the break has to be
			// somewhere else for the parse to fail.
			const text = "a:\n\tb: 1\nc:\n  ";
			assert.strictEqual(sentinelPath(text, text.length, 2), undefined);
		});
	});

	suite("yamlRegionOf", () => {
		test("Should take the whole document for YAML", () => {
			const text = "title: A\n";
			assert.deepStrictEqual(yamlRegionOf(text, "yaml"), { text, base: 0 });
		});

		test("Should take the front matter body of a Quarto document", () => {
			const text = "---\ntitle: A\n---\n\nBody\n";
			assert.deepStrictEqual(yamlRegionOf(text, "quarto"), { text: "title: A\n", base: 4 });
		});

		test("Should report nothing for a Quarto document with no front matter", () => {
			assert.strictEqual(yamlRegionOf("Body only.\n", "quarto"), undefined);
		});

		test("Should take the whole document for JSON", () => {
			const text = '{"name": "x"}\n';
			assert.deepStrictEqual(yamlRegionOf(text, "json"), { text, base: 0 });
		});

		test("Should take the front matter of a document opened as Markdown", () => {
			// A `.qmd` is read as Markdown when the Quarto language extension is not
			// installed, and its body is prose rather than YAML.
			const text = "---\ntitle: A\n---\n\nBody\n";
			assert.deepStrictEqual(yamlRegionOf(text, "markdown"), { text: "title: A\n", base: 4 });
			assert.strictEqual(yamlRegionHolds(text, "markdown", text.indexOf("Body")), false);
		});

		test("Should report nothing when the two delimiters are thematic breaks", () => {
			// `extractYamlText` read this as front matter while the scanner did not.
			assert.strictEqual(yamlRegionOf("---\n\n---\nBody\n", "quarto"), undefined);
		});
	});

	suite("yamlRegionHolds", () => {
		test("Should hold every offset of a YAML document", () => {
			const text = "key: value\nother: stuff\n";
			assert.strictEqual(yamlRegionHolds(text, "yaml", 0), true);
			assert.strictEqual(yamlRegionHolds(text, "yaml", text.length - 1), true);
		});

		test("Should hold the front matter of a Quarto document", () => {
			const text = "---\ntitle: Test\nformat: html\n---\nBody text\n";
			assert.strictEqual(yamlRegionHolds(text, "quarto", text.indexOf("title")), true);
			assert.strictEqual(yamlRegionHolds(text, "quarto", text.indexOf("format")), true);
		});

		test("Should not hold the body of a Quarto document", () => {
			const text = "---\ntitle: Test\n---\nBody text\n";
			assert.strictEqual(yamlRegionHolds(text, "quarto", text.indexOf("Body")), false);
		});

		test("Should not hold either delimiter line", () => {
			const text = "---\ntitle: Test\n---\nBody text\n";
			assert.strictEqual(yamlRegionHolds(text, "quarto", 0), false);
			assert.strictEqual(yamlRegionHolds(text, "quarto", text.lastIndexOf("---")), false);
		});

		test("Should hold nothing when no closing delimiter exists", () => {
			const text = "---\ntitle: Test\nBody text\n";
			assert.strictEqual(yamlRegionHolds(text, "quarto", text.indexOf("title")), false);
		});

		test("Should hold nothing when the second line is blank", () => {
			// The two `---` lines are thematic breaks, so what sits between them is
			// body text and not front matter.
			const text = "---\n\n---\nBody text\n";
			assert.strictEqual(yamlRegionHolds(text, "quarto", 4), false);
		});

		test("Should hold nothing when a CRLF second line is blank", () => {
			const text = "---\r\n\r\n---\r\nBody text\r\n";
			assert.strictEqual(yamlRegionHolds(text, "quarto", 5), false);
		});

		test("Should hold nothing when the document has no delimiters at all", () => {
			const text = "Some text\nMore text\n";
			assert.strictEqual(yamlRegionHolds(text, "quarto", 0), false);
		});
	});
});
