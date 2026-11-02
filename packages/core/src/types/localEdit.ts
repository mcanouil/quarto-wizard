/** One difference between an installed extension and its install record. */
export interface LocalEdit {
	/** Path relative to the extension folder, `/`-separated. */
	path: string;
	/** Type of the difference. */
	change: "modified" | "missing" | "added" | "unreadable install record";
}

/**
 * Format one local edit as `<path> (<change>)`.
 *
 * @param edit - Difference between an installed extension and its install record
 * @returns For example "a.lua (modified)"
 */
export function formatLocalEdit(edit: LocalEdit): string {
	return `${edit.path} (${edit.change})`;
}
