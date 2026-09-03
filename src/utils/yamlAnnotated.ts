/**
 * One parse of a YAML region that carries each value together with where it is
 * written.
 *
 * Every YAML surface used to read the same document twice. Values came from
 * `yaml.load`, and positions came from a raw line walk that matched a key with a
 * regular expression and tracked indentation by hand. The two disagreed, and the
 * line walk lost in every disagreement: it reported a duplicated key against its
 * first occurrence, it never matched a flow style mapping at all, and it read a
 * key spelled inside a block scalar as a real key.
 *
 * `js-yaml` version 5 replaced the `listener` option of version 4 with an event
 * API, which is what this module is built on. `parseEvents` returns a flat
 * stream in which every scalar carries its own offsets, and `constructFromEvents`
 * turns that same stream into the value `yaml.load` would have returned. One
 * parse therefore answers both questions, and the two answers cannot drift.
 *
 * The two halves fail differently, and the split is deliberate. `parseEvents`
 * tolerates a half-typed line and a duplicated key, so positions survive a
 * document whose value cannot be built. `constructFromEvents` is the strict half
 * and rejects a duplicated key exactly as `yaml.load` did, so no reader of a
 * value sees a behaviour it did not see before.
 *
 * JSON parses as flow style YAML, so one annotated parse serves `_schema.json`
 * as well as `_schema.yml`.
 *
 * No `vscode` here, so the whole module is testable from a string.
 */

import * as yaml from "js-yaml";
import { getYamlFrontMatterRange, type TextRange } from "./yamlPosition";

/**
 * One step of a path: a key of a mapping, or the position of a sequence entry.
 */
export type YamlPathSegment = string | number;

/** One node of the parse, with the places a reader can point at. */
export interface AnnotatedNode {
	/** What the node is. */
	kind: "scalar" | "mapping" | "sequence";
	/**
	 * Where the node itself is written.
	 *
	 * Absent when nothing is written, which is what `key:` on a line of its own
	 * produces. The source reports offsets of -1 for such a value, and a reader
	 * that needs a place for it falls back to {@link AnnotatedNode.keyRange}.
	 */
	range?: TextRange;
	/** Where the key that names it is written, absent at the root and in a sequence. */
	keyRange?: TextRange;
}

/** Where an offset sits, and on which half of the pair it sits. */
export interface AnnotatedLocation {
	/** The path of the node under the offset. */
	path: YamlPathSegment[];
	/** Whether the offset is on the key or on the value. */
	on: "key" | "value";
}

/** One annotated parse of one YAML region. */
export interface AnnotatedYaml {
	/**
	 * What `yaml.load` returns for the region.
	 *
	 * Undefined when the region holds no document, holds more than one, or
	 * cannot be built, which is every case in which `yaml.load` threw before.
	 */
	value: unknown;
	/**
	 * The node at a path, or undefined when nothing is written there.
	 *
	 * A duplicated key resolves to its last occurrence, which is the one whose
	 * value a loader keeps. The line walk reported the first, which is the one
	 * the document does not use.
	 *
	 * @param path - The path to look up.
	 */
	nodeAt(path: readonly YamlPathSegment[]): AnnotatedNode | undefined;
	/**
	 * The path at an offset, or undefined when no node is written there.
	 *
	 * @param offset - An offset into the document the parse was based on.
	 */
	pathAt(offset: number): AnnotatedLocation | undefined;
	/**
	 * The keys already written under a path.
	 *
	 * Empty when the path names nothing, or names something that is not a
	 * mapping.
	 *
	 * @param path - The path of the parent.
	 */
	keysAt(path: readonly YamlPathSegment[]): Set<string>;
}

/**
 * The path with its sequence positions removed.
 *
 * A schema is addressed by keys alone, so a reader that walks one drops the
 * position of a sequence entry. The offset readers keep it, because a position
 * is what tells two entries of a sequence apart.
 *
 * @param path - The path to reduce.
 * @returns The keys of the path, in order.
 */
export function keyPathOf(path: readonly YamlPathSegment[]): string[] {
	return path.filter((segment): segment is string => typeof segment === "string");
}

/** A node while it is still being built, before its children are known. */
interface BuildingNode extends AnnotatedNode {
	/** The children by segment, holding the last of a duplicated key. */
	byKey: Map<YamlPathSegment, BuildingNode>;
	/** Every child in the order it was written, including a duplicate. */
	items: { segment: YamlPathSegment; node: BuildingNode }[];
}

/** A collection whose closing event has not been read yet. */
interface Frame {
	node: BuildingNode;
	/** Whether the next scalar of a mapping is a key rather than a value. */
	expectKey: boolean;
	/** The key read but not yet used, for a mapping. */
	pendingKey?: { segment: YamlPathSegment; keyRange?: TextRange };
	/** How many entries a sequence has taken. */
	index: number;
	/** Whether this collection is itself the key of the mapping below it. */
	asKey: boolean;
}

/** The offset a source reports when nothing is written. */
const NOT_WRITTEN = -1;

/**
 * A range from a pair of source offsets, moved onto the document.
 *
 * @param start - The offset the source reported for the start.
 * @param end - The offset the source reported for the end.
 * @param base - Where the parsed region starts in the document.
 * @returns The range, or undefined when the source wrote nothing.
 */
function rangeOf(start: number, end: number, base: number): TextRange | undefined {
	if (start === NOT_WRITTEN || end === NOT_WRITTEN) {
		return undefined;
	}
	return { start: start + base, end: end + base };
}

/**
 * Create a node.
 *
 * @param kind - What the node is.
 * @param range - Where it is written.
 * @param keyRange - Where the key that names it is written.
 */
function node(kind: AnnotatedNode["kind"], range: TextRange | undefined, keyRange?: TextRange): BuildingNode {
	return { kind, range, keyRange, byKey: new Map(), items: [] };
}

/**
 * Close a collection, whose end is the end of the last thing inside it.
 *
 * The source closes a collection with an event that carries no offset, so the
 * end has to come from the children. A key counts as well as a value, because a
 * mapping whose last entry has no value still reaches to the end of that key.
 *
 * @param collection - The collection being closed.
 */
function closeCollection(collection: BuildingNode): void {
	let end = collection.range?.end;
	for (const item of collection.items) {
		for (const range of [item.node.keyRange, item.node.range]) {
			if (range !== undefined && (end === undefined || range.end > end)) {
				end = range.end;
			}
		}
	}
	if (collection.range !== undefined && end !== undefined) {
		collection.range = { start: collection.range.start, end };
	}
}

/**
 * Attach a node to the collection it was written in.
 *
 * @param frame - The collection being filled, or undefined at the root.
 * @param built - The node to attach.
 */
function attach(frame: Frame | undefined, built: BuildingNode): void {
	if (frame === undefined) {
		return;
	}
	let segment: YamlPathSegment;
	if (frame.node.kind === "mapping") {
		segment = frame.pendingKey?.segment ?? "";
		built.keyRange = frame.pendingKey?.keyRange;
		frame.pendingKey = undefined;
		frame.expectKey = true;
	} else {
		segment = frame.index++;
	}
	frame.node.byKey.set(segment, built);
	frame.node.items.push({ segment, node: built });
}

/**
 * Build the tree of one document from the event stream.
 *
 * @param events - Every event of the region.
 * @param text - The text the events were read from.
 * @param base - Where that text starts in the document.
 * @returns The root of the first document, or undefined when there is none.
 */
function buildTree(events: readonly yaml.Event[], text: string, base: number): BuildingNode | undefined {
	const stack: Frame[] = [];
	let root: BuildingNode | undefined;
	let documents = 0;

	for (const event of events) {
		if (event.type === yaml.EVENT_DOCUMENT) {
			documents++;
			if (documents > 1) {
				break;
			}
			continue;
		}

		if (event.type === yaml.EVENT_POP) {
			const frame = stack.pop();
			if (frame === undefined) {
				continue;
			}
			closeCollection(frame.node);
			if (frame.asKey) {
				// A collection used as a key names nothing a reader can address, so
				// it takes an empty segment. It is read at all to keep the stack
				// balanced, because the value below it is a real entry.
				const below = stack[stack.length - 1];
				if (below !== undefined) {
					below.pendingKey = { segment: "", keyRange: frame.node.range };
					below.expectKey = false;
				}
			} else {
				attach(stack[stack.length - 1], frame.node);
			}
			continue;
		}

		const frame = stack[stack.length - 1];
		const inKeyPosition = frame !== undefined && frame.node.kind === "mapping" && frame.expectKey;

		if (event.type === yaml.EVENT_SCALAR || event.type === yaml.EVENT_ALIAS) {
			const range =
				event.type === yaml.EVENT_SCALAR
					? rangeOf(event.valueStart, event.valueEnd, base)
					: rangeOf(event.anchorStart, event.anchorEnd, base);
			if (inKeyPosition) {
				// The key is taken from the source rather than from the constructed
				// value. Every key of a Quarto configuration is a plain or quoted
				// scalar, whose source text and value are the same.
				const segment = range === undefined ? "" : text.slice(range.start - base, range.end - base);
				frame.pendingKey = { segment, keyRange: range };
				frame.expectKey = false;
				continue;
			}
			const built = node("scalar", range);
			if (frame === undefined) {
				root ??= built;
			} else {
				attach(frame, built);
			}
			continue;
		}

		// A mapping or a sequence opens a collection. It is attached to its parent
		// when it closes and not here, because its end is only known by then.
		const kind = event.type === yaml.EVENT_MAPPING ? "mapping" : "sequence";
		const built = node(kind, rangeOf(event.start, event.start, base));
		if (frame === undefined) {
			root ??= built;
		} else if (inKeyPosition) {
			frame.expectKey = false;
		}
		stack.push({ node: built, expectKey: kind === "mapping", index: 0, asKey: inKeyPosition });
	}

	// An unclosed collection ends where the text does.
	while (stack.length > 0) {
		const frame = stack.pop();
		if (frame === undefined) {
			break;
		}
		closeCollection(frame.node);
		attach(stack[stack.length - 1], frame.node);
	}

	return root;
}

/**
 * Whether an offset falls inside a range.
 *
 * The end is inclusive, because a cursor sitting immediately after the last
 * character of a key is still on that key while it is being typed.
 *
 * @param range - The range to test, which may be absent.
 * @param offset - The offset to test.
 */
function covers(range: TextRange | undefined, offset: number): boolean {
	return range !== undefined && offset >= range.start && offset <= range.end;
}

/**
 * Walk down to the innermost node written at an offset.
 *
 * @param from - The node to search inside.
 * @param offset - The offset to find.
 * @param path - The path of `from`.
 * @returns The location, or undefined when nothing is written there.
 */
function locate(from: BuildingNode, offset: number, path: YamlPathSegment[]): AnnotatedLocation | undefined {
	for (const item of from.items) {
		if (covers(item.node.keyRange, offset)) {
			return { path: [...path, item.segment], on: "key" };
		}
		if (!covers(item.node.range, offset)) {
			continue;
		}
		if (item.node.kind === "scalar") {
			return { path: [...path, item.segment], on: "value" };
		}
		return locate(item.node, offset, [...path, item.segment]);
	}
	return undefined;
}

/**
 * Read a path down the tree.
 *
 * @param root - The root of the parse.
 * @param path - The path to follow.
 */
function follow(root: BuildingNode, path: readonly YamlPathSegment[]): BuildingNode | undefined {
	let found: BuildingNode | undefined = root;
	for (const segment of path) {
		found = found.byKey.get(segment);
		if (found === undefined) {
			return undefined;
		}
	}
	return found;
}

/**
 * Parse a YAML region, keeping the value and the positions together.
 *
 * @param text - The text of the region alone.
 * @param base - Where that text starts in the document, so that every range is a
 *   document range. Zero for a configuration file, and the offset of the front
 *   matter body for a Quarto document.
 * @returns The parse, or undefined when the text is not YAML at all.
 */
export function annotateYaml(text: string, base = 0): AnnotatedYaml | undefined {
	let events: yaml.Event[];
	try {
		events = yaml.parseEvents(text, {});
	} catch {
		// A syntax error such as a tab used for indentation. The document is not
		// YAML, so there is nothing to point at and nothing to complete.
		return undefined;
	}

	const root = buildTree(events, text, base);

	let value: unknown;
	try {
		const documents = yaml.constructFromEvents(events, { source: text });
		value = documents.length === 1 ? documents[0] : undefined;
	} catch {
		// A duplicated key, which `yaml.load` rejected as well. The positions
		// above are still good, so a reader that only needs a place still has one.
		value = undefined;
	}

	return {
		value,
		nodeAt(path) {
			if (root === undefined) {
				return undefined;
			}
			const found = follow(root, path);
			return found === undefined ? undefined : { kind: found.kind, range: found.range, keyRange: found.keyRange };
		},
		pathAt(offset) {
			if (root === undefined || root.kind === "scalar") {
				return undefined;
			}
			return locate(root, offset, []);
		},
		keysAt(path) {
			const keys = new Set<string>();
			const found = root === undefined ? undefined : follow(root, path);
			if (found === undefined || found.kind !== "mapping") {
				return keys;
			}
			for (const item of found.items) {
				if (typeof item.segment === "string" && item.segment !== "") {
					keys.add(item.segment);
				}
			}
			return keys;
		},
	};
}

/**
 * A key that no document writes, put where the cursor is so that it parses.
 *
 * Plain, so it needs no quoting, and spelled so that nothing collides with it.
 */
const CURSOR_KEY = "qwCursorKey";

/**
 * The path of the parent of the cursor, for a cursor that names no node yet.
 *
 * A parser reads what is written, and a cursor on a blank line or in the middle
 * of a half-typed key has written nothing to read. The old line walk answered
 * this with a `cursorIndent` argument that trimmed its own stack, which is a
 * second rule about indentation. This replaces it with one transformation: write
 * a key where the cursor is, parse that, and read the path of what was written.
 *
 * The column and not the offset places the key, because the indent is what says
 * which mapping the cursor is inside.
 *
 * @param text - The text of the region alone.
 * @param offset - The offset of the cursor within that text.
 * @param column - The column of the cursor on its line.
 * @returns The path of the mapping the cursor sits in, or undefined when the
 *   patched text does not parse. The position of a sequence entry is kept, so
 *   that the path still reads on the parse of the unpatched document.
 */
export function sentinelPath(text: string, offset: number, column: number): YamlPathSegment[] | undefined {
	const lineStart = text.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
	const lineEnd = text.indexOf("\n", lineStart);
	const patchedLine = " ".repeat(column) + CURSOR_KEY + ":";
	const patched = text.slice(0, lineStart) + patchedLine + (lineEnd === NOT_WRITTEN ? "" : text.slice(lineEnd));

	const annotated = annotateYaml(patched);
	const found = annotated?.pathAt(lineStart + column + 1);
	if (found === undefined || found.path[found.path.length - 1] !== CURSOR_KEY) {
		return undefined;
	}
	return found.path.slice(0, -1);
}

/**
 * The YAML of a document, and where it starts.
 *
 * A configuration file is YAML throughout. A Quarto document carries its YAML in
 * front matter, and the range of that comes from `getYamlFrontMatterRange`, so
 * the reader and the block scanner agree about where it ends. The rule this
 * replaces opened front matter on any `---` first line, which reads the two
 * delimiters of `---\n\n---` as front matter where the scanner reads two
 * thematic breaks.
 *
 * @param text - The full document text.
 * @param languageId - The language of the document.
 * @returns The YAML and its offset in the document, or undefined when the
 *   document holds none.
 */
export function yamlRegionOf(text: string, languageId: string): { text: string; base: number } | undefined {
	if (languageId !== "quarto") {
		return { text, base: 0 };
	}

	const range = getYamlFrontMatterRange(text);
	if (range === undefined) {
		return undefined;
	}
	const bodyStart = text.indexOf("\n") + 1;
	const bodyEnd = text.lastIndexOf("\n", range.end - 1) + 1;
	if (bodyEnd <= bodyStart) {
		return undefined;
	}
	return { text: text.slice(bodyStart, bodyEnd), base: bodyStart };
}
