/**
 * Writes a count with its noun, in the singular for one and in the plural otherwise.
 *
 * @param count - The number of items.
 * @param singular - The noun for one item.
 * @param plural - The noun for any other count, the singular with an `s` by default.
 * @returns The count and the noun, for example `2 extensions`.
 */
export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : plural}`;
}
