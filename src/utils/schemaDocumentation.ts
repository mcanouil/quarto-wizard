import * as vscode from "vscode";
import type { FieldDescriptor, DeprecatedSpec } from "@quarto-wizard/core";

/**
 * Extract the word at a given offset in the text.
 * Scans backward and forward for `[a-zA-Z0-9_-]` characters, which
 * covers standard attribute names including hyphenated ones like
 * `border-color`.
 */
export function getWordAtOffset(text: string, offset: number): string | null {
	let start = offset;
	while (start > 0 && /[\w-]/.test(text[start - 1])) {
		start--;
	}
	let end = offset;
	while (end < text.length && /[\w-]/.test(text[end])) {
		end++;
	}
	return start === end ? null : text.slice(start, end);
}

/**
 * Whether a descriptor has values that can be completed (enum, boolean, completion spec values, or file paths).
 */
export function hasCompletableValues(descriptor: FieldDescriptor): boolean {
	return !!(
		descriptor.enum ||
		descriptor.type === "boolean" ||
		descriptor.completion?.values ||
		descriptor.completion?.type === "file"
	);
}

/**
 * Build a markdown documentation string for an attribute descriptor.
 *
 * @param descriptor - The field descriptor.
 * @param source - Optional extension name that provides this attribute.
 */
export function buildAttributeDoc(descriptor: FieldDescriptor, source?: string): vscode.MarkdownString | undefined {
	const parts: string[] = [];

	if (source) {
		parts.push(`*From extension:* **${source}**`);
	}

	if (descriptor.description) {
		parts.push(descriptor.description);
	}

	const meta: string[] = [];
	if (descriptor.type) {
		meta.push(`Type: \`${descriptor.type}\``);
	}
	if (descriptor.required) {
		meta.push("Required");
	}
	if (descriptor.default !== undefined) {
		meta.push(`Default: \`${String(descriptor.default)}\``);
	}
	if (descriptor.enum) {
		meta.push(`Values: ${descriptor.enum.map((v) => `\`${String(v)}\``).join(", ")}`);
	}
	if (descriptor.deprecated) {
		meta.push(formatDeprecatedMeta(descriptor.deprecated));
	}

	if (meta.length > 0) {
		parts.push(meta.join(" | "));
	}

	if (parts.length === 0) {
		return undefined;
	}

	return new vscode.MarkdownString(parts.join("\n\n"));
}

/**
 * Format a deprecation value for display in attribute metadata.
 */
function formatDeprecatedMeta(deprecated: boolean | string | DeprecatedSpec): string {
	if (typeof deprecated === "string") {
		return `Deprecated: ${deprecated}`;
	}
	if (typeof deprecated === "object") {
		const parts = ["Deprecated"];
		if (deprecated.since) {
			parts[0] += ` (since ${deprecated.since})`;
		}
		if (deprecated.message) {
			return `${parts[0]}: ${deprecated.message}`;
		}
		if (deprecated.replaceWith) {
			return `${parts[0]}: Use \`${deprecated.replaceWith}\` instead.`;
		}
		return parts[0];
	}
	return "Deprecated";
}
