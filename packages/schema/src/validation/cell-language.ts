/**
 * The key under which a cell language is compared.
 * Lua matches a language case-insensitively and with a hyphen or an underscore alike, so the key is lower case with hyphens.
 *
 * @param language - The language as written.
 * @returns The comparison key.
 */
export function normaliseCellLanguage(language: string): string {
	return language.toLowerCase().replaceAll("_", "-");
}
