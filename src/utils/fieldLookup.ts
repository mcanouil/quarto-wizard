import type { FieldDescriptor } from "@quarto-wizard/schema";

/**
 * The spellings the Lua validator reads for a name: the name itself, then its
 * underscored and hyphenated variants.
 */
export function spellingsOf(name: string): string[] {
	return [name, name.replace(/-/g, "_"), name.replace(/_/g, "-")];
}

function findByName<T>(
	entries: Record<string, T>,
	key: string,
	aliasesOf: (entry: T) => readonly string[] | undefined,
): T | undefined {
	const spellings = spellingsOf(key);
	for (const spelling of spellings) {
		if (Object.hasOwn(entries, spelling)) {
			return entries[spelling];
		}
	}
	return Object.values(entries).find((entry) => aliasesOf(entry)?.some((alias) => spellings.includes(alias)));
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
	return findByName(entries, key, (entry) => entry.descriptor.aliases);
}

/**
 * Find the descriptor that declares a written key, as `findDeclaredField` does.
 */
export function findFieldDescriptor(fields: Record<string, FieldDescriptor>, key: string): FieldDescriptor | undefined {
	return findByName(fields, key, (descriptor) => descriptor.aliases);
}

/**
 * The descriptors of a map of entries that carry one, by declared name.
 */
export function descriptorsOf(
	entries: Record<string, { descriptor: FieldDescriptor }>,
): Record<string, FieldDescriptor> {
	return Object.fromEntries(Object.entries(entries).map(([name, { descriptor }]) => [name, descriptor]));
}

/**
 * The field that a deprecated descriptor forwards its value to.
 */
export function replaceWithOf(descriptor: FieldDescriptor): string | undefined {
	return typeof descriptor.deprecated === "object" && descriptor.deprecated !== null
		? descriptor.deprecated.replaceWith
		: undefined;
}

/**
 * Tell whether a name is written, under either separator.
 */
export function isWrittenAs(written: Record<string, unknown>, name: string): boolean {
	return spellingsOf(name).some((spelling) => Object.hasOwn(written, spelling));
}

/**
 * Tell whether a required field is present, as the Lua validator counts it.
 * The field is present when it is written under its name or an alias, in
 * either hyphen or underscore spelling, or when a deprecated field that
 * names it exactly in `replaceWith` is written, because the value moves to it.
 * A required field that is itself deprecated with `replaceWith` and written
 * is not present, because the validator clears it, defaults included.
 * Otherwise a default fills the field before the check.
 *
 * @param name - The declared name of the required field.
 * @param descriptor - The descriptor of the required field.
 * @param written - The names written in the document.
 * @param descriptors - Every descriptor that applies, by declared name.
 */
export function isRequiredPresent(
	name: string,
	descriptor: FieldDescriptor,
	written: Record<string, unknown>,
	descriptors: Record<string, FieldDescriptor>,
): boolean {
	const ownWritten = [name, ...(descriptor.aliases ?? [])].some((n) => isWrittenAs(written, n));
	const cleared = replaceWithOf(descriptor) !== undefined && ownWritten;
	if (!cleared && (ownWritten || descriptor.default !== undefined)) {
		return true;
	}
	return Object.entries(descriptors).some(
		([other, candidate]) =>
			replaceWithOf(candidate) === name && [other, ...(candidate.aliases ?? [])].some((n) => isWrittenAs(written, n)),
	);
}
