/**
 * Readers over the Lua reference validator and the meta-schemas.
 *
 * The module keeps its own keyword table, because the `true` or `false`
 * value marks whether the module acts on the keyword. The meta-schema
 * holds no such distinction, so the table cannot be generated from it and
 * the two are compared instead.
 *
 * A regular expression over one line of source used to read the table. It
 * needed a line start, a bare identifier and a trailing comma, so a reformat
 * could hide an entry and the comparison then ran against a short baseline.
 *
 * That hole was one-directional. A hidden entry that the meta-schema also
 * holds still failed the "every meta-schema property is named by the module"
 * check, because the name dropped out of the module side. A hidden entry that
 * the meta-schema does not hold passed both checks in silence, which is the
 * divergence these readers close.
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
	const declared = /^[ \t]*M\.SCHEMA_VERSION\s*=\s*(['"])([^'"]+)\1/m.exec(luaSource);
	return declared === null ? null : declared[2];
}

type MetaSchemaShape = { $defs?: { fieldDescriptor?: { properties?: Record<string, unknown> } } };

/** The property names of `$defs.fieldDescriptor` in a meta-schema. */
export function metaSchemaProperties(metaSchema: unknown): string[] {
	const properties = (metaSchema as MetaSchemaShape).$defs?.fieldDescriptor?.properties;
	if (properties === undefined) {
		throw new Error("$defs.fieldDescriptor.properties not found in meta-schema");
	}
	return Object.keys(properties);
}

/**
 * Group the camelCase and the kebab-case spelling of one keyword.
 *
 * v1 carries both spellings for most keywords, so a count of property names
 * counts the same keyword twice. The key of the returned map is the name with
 * the hyphens removed and the case dropped, and the value holds every spelling
 * that maps onto that key.
 *
 * This groups a pair that differs by a hyphen only, such as `minLength` and
 * `min-length`. It does not group a short alias with its long name, because
 * `min` and `minimum` differ by more than a hyphen. `FIELD_ALIAS_PAIRS` in
 * `src/types/schema.ts` holds those pairs, and a caller that needs them has to
 * read it. v1 therefore yields 34 groups from 48 property names, and `min`,
 * `minimum`, `max` and `maximum` are four of those groups and not two.
 */
export function keywordGroups(properties: string[]): Map<string, string[]> {
	const groups = new Map<string, string[]>();
	for (const name of properties) {
		const keyword = name.replace(/-/g, "").toLowerCase();
		const spellings = groups.get(keyword) ?? [];
		spellings.push(name);
		groups.set(keyword, spellings);
	}
	return groups;
}
