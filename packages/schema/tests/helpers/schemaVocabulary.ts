/**
 * Readers over the Lua reference validator and the meta-schemas.
 *
 * The module keeps its own keyword table, because the `true` or `false`
 * value marks whether the module acts on the keyword. The meta-schema
 * holds no such distinction, so the table cannot be generated from it and
 * the two are compared instead.
 *
 * A regular expression over one line of source used to read the table. It
 * needed a line start, a bare identifier and a trailing comma, so a
 * reformat could hide an entry and the comparison then ran against a short
 * baseline without failing. These readers remove that failure mode.
 */

/** One entry of `M.KEYWORDS`: the name, and whether the module acts on it. */
export function parseKeywordTable(luaSource: string): Map<string, boolean> {
	const block = /^M\.KEYWORDS\s*=\s*\{([\s\S]*?)^\}/m.exec(luaSource);
	if (block === null) {
		throw new Error("M.KEYWORDS table not found");
	}
	const body = block[1].replace(/--[^\n]*/g, "");
	const entry = /(?:\[\s*(['"])([^'"]+)\1\s*\]|([A-Za-z_][A-Za-z0-9_]*))\s*=\s*(true|false)\b/g;
	const entries = new Map<string, boolean>();
	for (const match of body.matchAll(entry)) {
		entries.set(match[2] ?? match[3], match[4] === "true");
	}
	return entries;
}

/** The meta-schema URL that the module declares, or null when absent. */
export function readSchemaVersion(luaSource: string): string | null {
	const declared = /^\s*M\.SCHEMA_VERSION\s*=\s*(['"])([^'"]+)\1/m.exec(luaSource);
	return declared === null ? null : declared[2];
}

/** The property names of `$defs.fieldDescriptor` in a meta-schema. */
export function metaSchemaProperties(metaSchema: unknown): string[] {
	const properties = (metaSchema as { $defs?: { fieldDescriptor?: { properties?: Record<string, unknown> } } })?.$defs
		?.fieldDescriptor?.properties;
	if (properties === undefined) {
		throw new Error("$defs.fieldDescriptor.properties not found in meta-schema");
	}
	return Object.keys(properties);
}

/**
 * Group the spellings of one keyword.
 *
 * v1 carries a camelCase and a kebab-case spelling for most keywords, so a
 * count of property names counts the same keyword twice. The key of the
 * returned map is the keyword, and the value holds every spelling of it.
 */
export function keywordGroups(properties: string[]): Map<string, string[]> {
	const groups = new Map<string, string[]>();
	for (const name of properties) {
		const keyword = name.replace(/-/g, "").toLowerCase();
		groups.set(keyword, [...(groups.get(keyword) ?? []), name]);
	}
	return groups;
}
