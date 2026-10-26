import type { FieldDescriptor } from "@quarto-wizard/schema";

/**
 * The spellings the Lua validator reads for a name: the name itself, then its
 * underscored and hyphenated variants.
 */
export function spellingsOf(name: string): string[] {
	return [name, name.replace(/-/g, "_"), name.replace(/_/g, "-")];
}

/**
 * Find the entry that declares a written key, in the order of the Lua
 * validator: a declared name first, then an alias, each tried in its three
 * spellings.
 */
export function findDeclaredField<T extends { descriptor: FieldDescriptor }>(
	entries: Record<string, T>,
	key: string,
): T | undefined {
	const spellings = spellingsOf(key);
	for (const spelling of spellings) {
		if (Object.hasOwn(entries, spelling)) {
			return entries[spelling];
		}
	}
	for (const entry of Object.values(entries)) {
		if (entry.descriptor.aliases?.some((alias) => spellings.includes(alias))) {
			return entry;
		}
	}
	return undefined;
}
